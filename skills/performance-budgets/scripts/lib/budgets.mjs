// budgets.mjs: the performance budgets this skill knows (the starting values of quality-gates.json
// "perf") and a loader that reads the app's own values. Not an entry point.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from '../check-lib.mjs';

export const GATES_FILE = 'quality-gates.json';

/**
 * key -> [starting value, direction, what it limits]. 'max': the app's value may not rise above the
 * starting value without --allow (tightening is always fine). The values are starting defaults
 * from probes and one production app; tighten them after the first device report.
 */
export const PERF_BUDGETS = {
  coldStartHomeMsMax: [1000, 'max', 'cold start, process start to the first screen drawn with data, median of 5 launches on a mid-range target device (ms)'],
  coldStartSimRegressionFactor: [1.2, 'max', 'a simulator or emulator cold start may be at most this times its committed baseline'],
  hitchMsPerSecondMax: [10, 'max', 'hitch rate while something animates (ms of hitch per second; Apple rates <= 10 good)'],
  frameP95MsMax: [17, 'max', 'p95 frame time while something animates (ms, a bucket upper bound)'],
  saveWriteP95MsMax: [5, 'max', 'p95 of the per-change storage write: one repository transaction or one document save (ms)'],
  drawCallsPerFrameMax: [1000, 'max', 'ceiling for every custom drawing\'s per-frame draw-call budget'],
  bundleJsBytesMax: [6000000, 'max', 'minified JS of a production export per platform, expo export --no-bytecode (bytes)'],
  bundleGrowthMaxRatio: [1.1, 'max', 'the bundle may grow at most this times its committed baseline'],
  memoryFootprintMbMax: [150, 'max', 'memory after the smoke flow: iOS phys_footprint, Android TOTAL PSS (MB)'],
  skiaCanvasesPerScreenMax: [8, 'max', 'Skia canvases in one screen file outside the canvas kit and surface folders'],
};

/** The starting values, key -> number. */
export function defaultBudgets() {
  return Object.fromEntries(Object.entries(PERF_BUDGETS).map(([key, [value]]) => [key, value]));
}

/** Parses quality-gates.json under root; null when it does not exist, exit 2 when it is not JSON. */
export function readGates(root) {
  const file = join(root, GATES_FILE);
  if (!existsSync(file)) return null;
  try {
    return { file, text: readFileSync(file, 'utf8'), gates: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (error) {
    return fail(`${GATES_FILE} is not valid JSON: ${error.message}`, 'Fix the JSON (quality-gates owns the file; a change needs its Gate-Change: trailer).');
  }
}

/** The app's perf budgets (quality-gates.json "perf"), each falling back to its starting value. */
export function loadBudgets(root) {
  const budgets = defaultBudgets();
  const read = readGates(root);
  const perf = read?.gates?.perf ?? {};
  for (const key of Object.keys(budgets)) if (typeof perf[key] === 'number' && perf[key] > 0) budgets[key] = perf[key];
  return { budgets, file: read ? GATES_FILE : null };
}

/** Median of numbers (NaN for none). */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
