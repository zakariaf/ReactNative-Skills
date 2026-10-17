// scripts/art/render-icon-sheet.ts
// Renders every ICON_PATHS entry into one contact sheet PNG (black on white, 8 per row, in
// ICON_PATHS order) with headless Skia, so a human or Claude can look at the generated paths.
// Run from the repo root: node scripts/art/render-icon-sheet.ts [--out file] [--size pt]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { failInput, readCliOrExit } from './art-cli.ts';
import { loadHeadlessSkia } from './load-headless-skia.ts';
import { ICON_PATHS } from '../../src/ui/icons/icon-paths.ts';

import type { CliSpec } from './art-cli.ts';

const GRID = 24;
const COLUMNS = 8;
const SCALE = 3;
const PADDING_PT = 12;
const DEFAULT_OUT = 'reports/art/icon-sheet.png';
const DEFAULT_SIZE_PT = 24;
const CLI: CliSpec = {
  command: 'node scripts/art/render-icon-sheet.ts',
  summary: 'Renders every ICON_PATHS entry into one contact sheet PNG (8 per row) to look at.',
  options: {
    out: {
      type: 'string',
      value: '<file.png>',
      help: `Where to write the sheet (default ${DEFAULT_OUT})`,
    },
    size: {
      type: 'string',
      value: '<pt>',
      help: `Icon size in points, 8-96 (default ${String(DEFAULT_SIZE_PT)})`,
    },
  },
  notes: ['Exit codes: 0 written, 2 bad input.'],
};

async function main(): Promise<void> {
  const values = readCliOrExit(CLI);
  if (values === null) return;
  const out = typeof values['out'] === 'string' ? values['out'] : DEFAULT_OUT;
  const sizePt = typeof values['size'] === 'string' ? Number(values['size']) : DEFAULT_SIZE_PT;
  if (!Number.isInteger(sizePt) || sizePt < 8 || sizePt > 96) {
    failInput(
      CLI,
      `--size must be a whole number of points from 8 to 96, got ${String(values['size'])}`,
    );
    return;
  }
  const skia = await loadHeadlessSkia();
  const names = Object.keys(ICON_PATHS) as (keyof typeof ICON_PATHS)[];
  const cell = (sizePt + PADDING_PT * 2) * SCALE;
  const rows = Math.ceil(names.length / COLUMNS);
  const surface = skia.Surface.Make(cell * COLUMNS, cell * rows);
  if (surface === null) throw new Error('No offscreen surface');
  const canvas = surface.getCanvas();
  canvas.drawColor(skia.Color('#FFFFFF'));
  const ink = skia.Paint();
  ink.setColor(skia.Color('#15171C'));
  ink.setAntiAlias(true);
  names.forEach((name, index) => {
    const path = skia.Path.MakeFromSVGString(ICON_PATHS[name]);
    if (path === null) throw new Error(`Bad path: ${name}`);
    canvas.save();
    canvas.translate(
      (index % COLUMNS) * cell + PADDING_PT * SCALE,
      Math.floor(index / COLUMNS) * cell + PADDING_PT * SCALE,
    );
    canvas.scale((sizePt * SCALE) / GRID, (sizePt * SCALE) / GRID);
    canvas.drawPath(path, ink);
    canvas.restore();
  });
  surface.flush();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, surface.makeImageSnapshot().encodeToBytes());
  console.log(`wrote ${out}: ${String(names.length)} icons, ${String(COLUMNS)} per row`);
}

await main();
