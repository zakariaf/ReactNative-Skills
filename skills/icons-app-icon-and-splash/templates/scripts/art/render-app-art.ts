// scripts/art/render-app-art.ts
// Renders the app icon (iOS light, dark and tinted; Android adaptive foreground, background and
// themed monochrome), the splash images (light, dark) and the Google Play icon with headless Skia
// from the brand mark (src/ui/icons/brand-mark.ts) and the theme palette (src/theme/palette.ts),
// to the paths in contracts/app-art.json. The PNGs are committed; --check re-renders in memory and
// exits 1 when a committed file is stale (run it in the verify gate).
// Run from the repo root: node scripts/art/render-app-art.ts [--check] (--help for more)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { outputsToDraw, readAppArt } from './app-art-contract.ts';
import { failInput, readCliOrExit } from './art-cli.ts';
import { loadHeadlessSkia } from './load-headless-skia.ts';
import { PALETTE } from '../../src/theme/palette.ts';
import { drawMark, markOps, monoOps } from '../../src/ui/icons/brand-mark-art.ts';
import { BRAND_MARK } from '../../src/ui/icons/brand-mark.ts';

import type { AppArt, ArtOutput } from './app-art-contract.ts';
import type { CliSpec } from './art-cli.ts';
import type { ColorScheme } from '../../src/theme/theme-types.ts';
import type { MarkOp, SkiaApi } from '../../src/ui/icons/brand-mark-art.ts';
import type { SkCanvas } from '@shopify/react-native-skia';

/** One image: its canvas, its pixel size and the share of an iOS icon the mark may cover. */
type Frame = {
  readonly skia: SkiaApi;
  readonly canvas: SkCanvas;
  readonly size: number;
  readonly glyphArea: number;
};
type Job = {
  readonly output: ArtOutput;
  readonly size: number;
  readonly paint: (frame: Frame) => void;
  readonly isGray?: boolean;
};

const CLI: CliSpec = {
  command: 'node scripts/art/render-app-art.ts',
  summary:
    'Renders the app icon (iOS light/dark/tinted, Android adaptive and themed), the splash images and the Play icon from the brand mark and palette, to the paths in contracts/app-art.json. Run from the repo root.',
  options: {
    check: { type: 'boolean', help: 'Write nothing; exit 1 when a committed image is stale' },
  },
  notes: ['Exit codes: 0 written or current, 1 stale (--check), 2 bad input.'],
};
const ICON_PX = 1024;
const PLAY_PX = 512;
/**
 * Android adaptive layers: launchers keep only the 66 dp circle of the 108 dp layer (radius 30.6 %).
 * A mark whose rounded corners reach its own half-width needs at most 0.6; 0.55 leaves room for the
 * edge stroke. check-app-art measures the farthest drawn pixel (art-safe-area).
 */
const ANDROID_AREA = 0.55;
/**
 * The splash image: on Android 12+ expo-splash-screen centres it at imageWidth dp on the 288 dp window
 * icon, masked to a 192 dp circle, so its safe radius is 96 / imageWidth of the image: at least 1/3
 * for any imageWidth up to 288 (0.48 at the default 200). The mark fills 62 %, inside even the 1/3
 * bound; iOS shows the whole image imageWidth wide.
 */
const SPLASH_AREA = 0.62;
/** Rec. 709 luma: the tinted icon must be grayscale. */
const GRAYSCALE = [
  0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0, 0, 0,
  1, 0,
];

function centred(frame: Frame, ops: readonly MarkOp[], area: number): void {
  const inset = (frame.size * (1 - area)) / 2;
  frame.canvas.save();
  frame.canvas.translate(inset, inset);
  drawMark(frame.skia, frame.canvas, { ops, size: frame.size * area });
  frame.canvas.restore();
}

function opsIn(scheme: ColorScheme): readonly MarkOp[] {
  return markOps(BRAND_MARK, PALETTE[scheme]);
}

function fill(frame: Frame, color: string): void {
  frame.canvas.drawColor(frame.skia.Color(color));
}

/** Opaque full-bleed tile with the mark: iOS masks the corners, Play applies its own 30 % radius. */
function paintLight(frame: Frame): void {
  fill(frame, PALETTE.light[BRAND_MARK.tile]);
  centred(frame, opsIn('light'), frame.glyphArea);
}

/** A paint step that draws the mark (in a scheme, or as the monochrome silhouette) at a share of the image. */
function mark(ops: () => readonly MarkOp[], area: number | 'glyph'): Job['paint'] {
  return (frame) => {
    centred(frame, ops(), area === 'glyph' ? frame.glyphArea : area);
  };
}

const LIGHT = (): readonly MarkOp[] => opsIn('light');
const DARK = (): readonly MarkOp[] => opsIn('dark');
/** Android 13+ themed icons read only alpha; the silhouette is drawn white, as Android's guidelines show it. */
const MONO_INK = '#FFFFFF';
const MONO = (): readonly MarkOp[] => monoOps(BRAND_MARK, MONO_INK);

/** The tinted icon: the dark appearance over the dark ground, made gray by the luma filter. */
function paintTinted(frame: Frame): void {
  fill(frame, PALETTE.dark.background);
  centred(frame, DARK(), frame.glyphArea);
}

function paintTile(frame: Frame): void {
  fill(frame, PALETTE.light[BRAND_MARK.tile]);
}

const JOBS: readonly Job[] = [
  { output: 'light', size: ICON_PX, paint: paintLight },
  { output: 'dark', size: ICON_PX, paint: mark(DARK, 'glyph') },
  { output: 'tinted', size: ICON_PX, paint: paintTinted, isGray: true },
  { output: 'androidForeground', size: ICON_PX, paint: mark(LIGHT, ANDROID_AREA) },
  { output: 'androidBackground', size: ICON_PX, paint: paintTile },
  { output: 'androidMonochrome', size: ICON_PX, paint: mark(MONO, ANDROID_AREA) },
  { output: 'splash', size: ICON_PX, paint: mark(LIGHT, SPLASH_AREA) },
  { output: 'splashDark', size: ICON_PX, paint: mark(DARK, SPLASH_AREA) },
  { output: 'playIcon', size: PLAY_PX, paint: paintLight },
];

function render(skia: SkiaApi, job: Job, glyphArea: number): Uint8Array {
  const surface = skia.Surface.Make(job.size, job.size);
  if (surface === null) throw new Error('No offscreen surface');
  const canvas = surface.getCanvas();
  canvas.clear(skia.Color('transparent'));
  if (job.isGray === true) {
    const gray = skia.Paint();
    gray.setColorFilter(skia.ColorFilter.MakeMatrix(GRAYSCALE));
    canvas.saveLayer(gray);
  }
  job.paint({ skia, canvas, size: job.size, glyphArea });
  if (job.isGray === true) canvas.restore();
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes();
}

/**
 * Writes every rendered image, or (check) returns the paths whose committed bytes differ. An image
 * listed in the contract's `optional` is made by hand (an Icon Composer folder's dark and tinted art):
 * it is neither written nor compared.
 */
function renderAll(skia: SkiaApi, contract: AppArt, isCheck: boolean): string[] {
  const stale: string[] = [];
  const wanted = new Set(outputsToDraw(contract));
  for (const job of JOBS.filter(({ output }) => wanted.has(output))) {
    const path = contract.outputs[job.output];
    const png = render(skia, job, contract.glyphArea);
    if (isCheck) {
      if (!existsSync(path) || !Buffer.from(png).equals(readFileSync(path))) stale.push(path);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    console.log(`wrote ${path}`);
  }
  return stale;
}

async function main(): Promise<void> {
  const values = readCliOrExit(CLI);
  if (values === null) return;
  let contract: AppArt;
  try {
    contract = readAppArt('.');
  } catch (error) {
    failInput(CLI, error instanceof Error ? error.message : String(error));
    return;
  }
  // The headless build declares its own copy of the Skia types; the runtime API is the same.
  const skia = (await loadHeadlessSkia()) as unknown as SkiaApi;
  const stale = renderAll(skia, contract, values['check'] === true);
  if (stale.length > 0) {
    console.error(`Stale app art (run without --check, look, commit):\n${stale.join('\n')}`);
    process.exitCode = 1;
  }
}

await main();
