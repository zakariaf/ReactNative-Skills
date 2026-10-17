// scripts/e2e/screenshot-compare.ts
// One screenshot against its baseline. The tolerances are gated values: 0.2 % of the pixels may
// differ (anti-aliasing noise of a still screen; an animating screen differed by about 1 % between
// two captures a second apart), and a pixel counts as changed past pixelmatch's 0.1 distance. Raising
// either needs the reviewer's agreement and a Gate-Change trailer; a diff is fixed, never tolerated.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { decodePng, diffImages, encodePng } from './png-diff.ts';

/** The share of pixels that may differ from the baseline (0.2 %). */
export const MAX_DIFF_RATIO = 0.002;
/** The per-pixel colour distance (pixelmatch's threshold) above which a pixel counts as changed. */
export const PIXEL_THRESHOLD = 0.1;

export type PngComparison =
  | { readonly kind: 'match'; readonly diffRatio: number }
  | { readonly kind: 'mismatch'; readonly diffRatio: number; readonly diffPath: string }
  | { readonly kind: 'size-changed'; readonly expected: string; readonly actual: string }
  | { readonly kind: 'missing-baseline'; readonly baselinePath: string };

export type CompareOptions = {
  readonly baselinePath: string;
  /** Where the diff PNG goes when the screenshot differs (reports/screenshots/<platform>/diff/). */
  readonly diffPath: string;
};

export function compareScreenshot(actual: Buffer, options: CompareOptions): PngComparison {
  if (!existsSync(options.baselinePath)) {
    return { kind: 'missing-baseline', baselinePath: options.baselinePath };
  }
  const expected = decodePng(readFileSync(options.baselinePath));
  const shot = decodePng(actual);
  if (shot.width !== expected.width || shot.height !== expected.height) {
    return {
      kind: 'size-changed',
      expected: `${String(expected.width)}x${String(expected.height)}`,
      actual: `${String(shot.width)}x${String(shot.height)}`,
    };
  }
  const { ratio, diff } = diffImages(expected, shot, PIXEL_THRESHOLD);
  if (ratio <= MAX_DIFF_RATIO) return { kind: 'match', diffRatio: ratio };
  mkdirSync(dirname(options.diffPath), { recursive: true });
  writeFileSync(options.diffPath, encodePng(diff));
  return { kind: 'mismatch', diffRatio: ratio, diffPath: options.diffPath };
}
