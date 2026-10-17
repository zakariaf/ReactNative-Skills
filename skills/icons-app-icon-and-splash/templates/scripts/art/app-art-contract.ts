// scripts/art/app-art-contract.ts
// Reads contracts/app-art.json: where each generated icon, splash and store image lives and how much
// of an iOS icon the mark covers. render-app-art.ts writes these files, app-art-config.ts points the
// Expo config at them, and the skill's check-app-art.mjs proves them. Every key is optional.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const APP_ART_CONTRACT = 'contracts/app-art.json';

/** Every image the art pipeline knows; featureGraphic is designed by hand, never rendered. */
export const DEFAULT_OUTPUTS = {
  light: 'assets/icons/production/icon.png',
  dark: 'assets/icons/production/icon-dark.png',
  tinted: 'assets/icons/production/icon-tinted.png',
  androidForeground: 'assets/icons/production/android-foreground.png',
  androidBackground: 'assets/icons/production/android-background.png',
  androidMonochrome: 'assets/icons/production/android-monochrome.png',
  splash: 'assets/images/splash-icon.png',
  splashDark: 'assets/images/splash-icon-dark.png',
  playIcon: 'assets/store/play-icon.png',
  featureGraphic: 'assets/store/feature-graphic.png',
} as const;

export type ArtOutput = keyof typeof DEFAULT_OUTPUTS;

export type AppArt = {
  readonly outputs: Readonly<Record<ArtOutput, string>>;
  /**
   * Outputs made by hand or left out (by default only the feature graphic; an app with an Icon
   * Composer .icon folder adds dark and tinted): never rendered, never required, never wired.
   */
  readonly optional: readonly ArtOutput[];
  /** Share of an iOS icon's width the mark may cover, centred (default 0.62). */
  readonly glyphArea: number;
};

/** Keys of the contract; `icons` holds check-icons' allow-lists, which the art scripts do not read. */
const CONTRACT_KEYS = ['$schema', '$comment', 'outputs', 'optional', 'glyphArea', 'icons'];
const DEFAULT_GLYPH_AREA = 0.62;
const MIN_GLYPH_AREA = 0.4;
const MAX_GLYPH_AREA = 0.9;

function isOutput(key: string): key is ArtOutput {
  return Object.hasOwn(DEFAULT_OUTPUTS, key);
}

function outputsOf(value: unknown): Record<ArtOutput, string> {
  const outputs: Record<ArtOutput, string> = { ...DEFAULT_OUTPUTS };
  if (value === undefined) return outputs;
  if (typeof value !== 'object' || value === null) throw new Error('"outputs" must be an object');
  for (const [key, path] of Object.entries(value)) {
    if (!isOutput(key)) throw new Error(`"outputs.${key}" is not a known image`);
    if (typeof path !== 'string' || !path.endsWith('.png')) {
      throw new Error(`"outputs.${key}" must be a repo-relative .png path`);
    }
    outputs[key] = path;
  }
  return outputs;
}

function optionalOf(value: unknown): ArtOutput[] {
  if (value === undefined) return ['featureGraphic'];
  if (!Array.isArray(value)) throw new Error('"optional" must be a list of image names');
  return value.map((key: unknown) => {
    if (typeof key !== 'string' || !isOutput(key)) {
      throw new Error(`"optional" names an unknown image: ${String(key)}`);
    }
    return key;
  });
}

function glyphAreaOf(value: unknown): number {
  if (value === undefined) return DEFAULT_GLYPH_AREA;
  if (typeof value !== 'number' || value < MIN_GLYPH_AREA || value > MAX_GLYPH_AREA) {
    throw new Error(`"glyphArea" must be a number from ${String(MIN_GLYPH_AREA)} to 0.9`);
  }
  return value;
}

/** Every image render-app-art.ts can draw (the feature graphic is always made by hand). */
const RENDERABLE: readonly ArtOutput[] = [
  'light',
  'dark',
  'tinted',
  'androidForeground',
  'androidBackground',
  'androidMonochrome',
  'splash',
  'splashDark',
  'playIcon',
];

/** The images the renderer writes (and --check compares): every renderable one not listed optional. */
export function outputsToDraw(art: AppArt): ArtOutput[] {
  return RENDERABLE.filter((output) => !art.optional.includes(output));
}

/** The contract of the repo at `root`, with defaults for every key it leaves out. */
export function readAppArt(root: string): AppArt {
  const file = join(root, APP_ART_CONTRACT);
  const data: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (typeof data !== 'object' || data === null)
    throw new Error(`${APP_ART_CONTRACT}: not an object`);
  const unknown = Object.keys(data).find((key) => !CONTRACT_KEYS.includes(key));
  if (unknown !== undefined) throw new Error(`${APP_ART_CONTRACT}: unknown key "${unknown}"`);
  return {
    outputs: outputsOf(Reflect.get(data, 'outputs')),
    optional: optionalOf(Reflect.get(data, 'optional')),
    glyphArea: glyphAreaOf(Reflect.get(data, 'glyphArea')),
  };
}
