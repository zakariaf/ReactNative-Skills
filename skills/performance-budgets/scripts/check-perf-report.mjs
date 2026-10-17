#!/usr/bin/env node
// check-perf-report.mjs: judges a performance report exported from a test build (debug menu >
// Performance > "Share performance report", or the perf log read from a simulator or emulator)
// against the budgets: cold start, frame times, hitch rate and the storage benchmark.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-perf-report.mjs <report.json> [repo-root] [--sim-baseline-file <file>] [--memory <file>]

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, run, toPosix } from './check-lib.mjs';
import { loadBudgets, median } from './lib/budgets.mjs';

const BENCHMARK_WRITES = 300;
/** Mirrors STALE_PROCESS_START_MS of src/core/perf/cold-start.ts: a process start this long before the JS entry is not this launch's. */
const STALE_PROCESS_START_MS = 10_000;
const BENCHMARK_KINDS = new Set(['storage-benchmark', 'save-benchmark']);

const SPEC = {
  name: 'check-perf-report',
  summary: 'Checks an exported performance report ({ appId, appVersion, buildNumber, platform, osVersion, deviceModel, entries } or a bare entries array) against quality-gates.json "perf" (or the starting values).',
  usage: '<report.json> [repo-root] [--sim-baseline-file <file> [--write-sim-baseline] | --sim-baseline <ms>] [--memory <file>] [--build <n>] [--min-launches <n>]',
  options: {
    'sim-baseline-file': { type: 'string', value: 'file', help: 'Simulator/emulator run against a committed baseline JSON ({ "medianMs": n }, repo-relative, e.g. perf-baselines/cold-start-sim-ios.json): drop the first of the latest n+1 launches (warm-up), compare their median with medianMs x coldStartSimRegressionFactor, and need no frames or benchmark entry' },
    'write-sim-baseline': { type: 'boolean', help: 'With --sim-baseline-file, when the file does not exist yet: write this run\'s median as the baseline (the first accepted run) instead of comparing' },
    'sim-baseline': { type: 'string', value: 'ms', help: 'Like --sim-baseline-file with the baseline median given as a number' },
    memory: { type: 'string', value: 'file', help: 'The memory reading after the smoke flow: `footprint -j` JSON (iOS, phys_footprint) or saved `adb -s <serial> shell dumpsys meminfo <app id>` text (Android, TOTAL PSS); judged against memoryFootprintMbMax' },
    build: { type: 'string', value: 'n', help: 'Judge only entries stamped with this build number (default: the report header\'s buildNumber; a bare entries array without --build judges every entry)' },
    'min-launches': { type: 'string', default: '5', value: 'n', help: 'Cold-start launches in the median: the latest n entries of this build' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 1, max: 2 },
  details: [
    'Builds: the perf log survives app updates, so every entry carries the build number that recorded it. With a',
    'header (or --build) only that build\'s entries are judged; the checker prints how many earlier-build entries it',
    'left out. Entries without a stamp (written before stamping) are judged as this build\'s, with a note.',
    '',
    'Rules:',
    '  report-shape        entries must be { kind, label, atEpochMs, data } objects; a frames entry has a numeric hitch rate',
    '  cold-start-runs     fewer counted cold-start entries than --min-launches (+1 with --sim-baseline), none at all',
    '                      included (a device report without a cold start means the first-screen mark is not wired or',
    '                      the relaunches were skipped). Not counted: entries without a numeric totalMs, and launches',
    `                      whose process started before the launch (prewarmed: true, or nativeMs over ${STALE_PROCESS_START_MS} ms:`,
    '                      iOS prewarming, an Android start by a push, broadcast or job); the checker prints how many it left out',
    '  cold-start          the median totalMs of the latest launches is over the budget (device: at or over',
    '                      coldStartHomeMsMax; simulator: over the baseline x coldStartSimRegressionFactor)',
    '  frame-data          no "frames" entry: record frame times while using the app (device reports only)',
    '  hitch-rate          a frames entry has hitchMsPerS over hitchMsPerSecondMax',
    '  frame-p95           a frames entry has p95UpToMs over frameP95MsMax (null means above 100 ms: it fails)',
    '  storage-write-p95   a storage-benchmark entry has p95 at or over saveWriteP95MsMax',
    '  storage-write-runs  a device report has no storage-benchmark entry, or one timed no or fewer than 300 writes (its',
    '                      percentiles prove nothing); a simulator/emulator log (--sim-baseline) needs none',
    '  memory-footprint    with --memory: the reading is over memoryFootprintMbMax (iOS phys_footprint, Android TOTAL PSS)',
    '',
    'Examples: node check-perf-report.mjs reports/perf/ios-1.0.0-12.json . --memory reports/perf/ios-1.0.0-12-footprint.json',
    '          node check-perf-report.mjs reports/perf/sim-ios.json . --sim-baseline-file perf-baselines/cold-start-sim-ios.json',
  ].join('\n'),
};

function readReport(path, given) {
  if (!existsSync(path)) fail(`nothing to check: report ${given} does not exist`, 'Pass the JSON the debug menu shared, or the perf log read from the simulator or emulator.');
  if (!statSync(path).isFile()) fail(`nothing to check: ${given} is a folder, pass the exported report JSON`, 'Pass the file, for example reports/perf/ios-1.0.0-12.json, then the repo root.');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`the report is not valid JSON: ${error.message}`, 'Pass the exported JSON unchanged.');
  }
  const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
  if (!Array.isArray(entries)) fail('the report has no entries array', 'Pass { ..., "entries": [...] } or a bare array of entries.');
  return { parsed, entries };
}

function checkColdStart(valid, ctx) {
  const { isSim, minLaunches, budgets, baseline, problem } = ctx;
  // The perf log is a ring buffer that survives app updates: judge only the latest launches, in time order.
  const timed = valid.filter((e) => e.kind === 'cold-start' && typeof e.data.totalMs === 'number').sort((a, b) => (a.atEpochMs ?? 0) - (b.atEpochMs ?? 0));
  const isStale = (e) => e.data.prewarmed === true || (typeof e.data.nativeMs === 'number' && e.data.nativeMs > STALE_PROCESS_START_MS);
  const runs = timed.filter((e) => !isStale(e));
  const dropped = timed.length - runs.length;
  if (dropped > 0) console.log(`cold start: left out ${dropped} launch${dropped === 1 ? '' : 'es'} whose process started before the launch (prewarmed, or nativeMs over ${STALE_PROCESS_START_MS} ms)`);
  const needed = isSim ? minLaunches + 1 : minLaunches;
  if (runs.length < needed) {
    problem('cold-start-runs', `${runs.length} cold-start runs with a process-start time (need ${needed})`, isSim ? `Launch ${needed} times (terminate, launch, wait for the cold-start entry); the first is dropped as warm-up.` : `${runs.length === 0 && timed.length === 0 ? 'Wire the first-screen mark (useColdStartMark with isReady, contracts/perf.json layer.firstScreenFiles) and rebuild; then f' : 'F'}orce-quit and relaunch the app until it has ${needed} cold starts (leave out launches that restarted for a direction change).`);
    return;
  }
  const used = runs.slice(-needed).slice(isSim ? 1 : 0).map((e) => e.data.totalMs);
  const med = median(used);
  if (ctx.writeBaseline) {
    ctx.writeBaseline(med, used.length);
    return;
  }
  const limit = isSim ? baseline * budgets.coldStartSimRegressionFactor : budgets.coldStartHomeMsMax;
  const note = runs.length > needed ? ` (the latest ${used.length} of ${runs.length} recorded${isSim ? ', first of the run dropped' : ''})` : '';
  console.log(`cold start: median ${Math.round(med)} ms of ${used.length} launches${note} (limit ${Math.round(limit)} ms)`);
  if (isSim ? med > limit : med >= limit) {
    problem('cold-start', `median cold start ${Math.round(med)} ms is over ${Math.round(limit)} ms`, 'Move work out of module scope and the startup path (ads, consent, purchases, prefetches start after the first screen); compare nativeMs and jsMs to see which side grew.');
  }
}

/** The entries of the build being judged: the header's (or --build's); unstamped entries stay, with a note. */
function entriesOfBuild(valid, build) {
  if (build === null) return valid;
  const isStamped = (e) => typeof e.build === 'string' || typeof e.build === 'number';
  const earlier = valid.filter((e) => isStamped(e) && String(e.build) !== build);
  const unstamped = valid.filter((e) => !isStamped(e) && e.kind !== 'trace');
  if (earlier.length > 0) {
    const builds = [...new Set(earlier.map((e) => String(e.build)))].join(', ');
    console.log(`build ${build}: left out ${earlier.length} entr${earlier.length === 1 ? 'y' : 'ies'} from earlier builds (${builds})`);
  }
  if (unstamped.length > 0) console.log(`note: ${unstamped.length} entr${unstamped.length === 1 ? 'y carries' : 'ies carry'} no build stamp (written before entries were stamped) and ${unstamped.length === 1 ? 'is' : 'are'} judged as build ${build}'s`);
  return valid.filter((e) => !isStamped(e) || String(e.build) === build);
}

/** Megabytes from `footprint -j` JSON (phys_footprint) or `dumpsys meminfo` text (TOTAL PSS, kB). */
function readMemoryMb(path, given) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(`nothing to check: memory reading ${given} does not exist`, 'iOS: footprint -j <file> <pid> after the smoke flow (simulator: the app process on the Mac); Android: adb -s <serial> shell dumpsys meminfo <app id> > <file>.');
  const text = readFileSync(path, 'utf8');
  if (text.trimStart().startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      fail(`the memory reading is not valid JSON: ${error.message}`, 'Pass the file footprint -j wrote, unchanged.');
    }
    const processes = Array.isArray(parsed?.processes) ? parsed.processes : [];
    if (processes.length !== 1) fail(`the footprint reading holds ${processes.length} processes, not 1`, 'Run footprint -j <file> <pid> for the app process only.');
    const bytes = processes[0]?.auxiliary?.phys_footprint ?? processes[0]?.footprint;
    const perUnit = typeof parsed['bytes per unit'] === 'number' ? parsed['bytes per unit'] : 1;
    if (typeof bytes !== 'number') fail('the footprint reading has no phys_footprint', 'Run footprint -j <file> <pid> (macOS footprint), without --format pages.');
    return { mb: (bytes * perUnit) / (1024 * 1024), what: `phys_footprint of ${processes[0].name ?? 'the process'}` };
  }
  const pss = text.match(/TOTAL PSS:\s+(\d+)/) ?? text.match(/^\s*TOTAL\s+(\d+)/m);
  if (pss === null) fail('the memory reading is neither footprint JSON nor dumpsys meminfo text', 'Pass footprint -j JSON (iOS) or the output of adb -s <serial> shell dumpsys meminfo <app id> (Android).');
  return { mb: Number(pss[1]) / 1024, what: 'TOTAL PSS' };
}

function checkMemory(path, given, { budgets, problem }) {
  const { mb, what } = readMemoryMb(path, given);
  console.log(`memory: ${what} ${mb.toFixed(1)} MB (limit ${budgets.memoryFootprintMbMax} MB)`);
  if (mb > budgets.memoryFootprintMbMax) problem('memory-footprint', `${what} ${mb.toFixed(1)} MB is over ${budgets.memoryFootprintMbMax} MB`, 'Look for images decoded at full size, caches without a bound, Skia pictures or atlases kept per item, and lists that render every row; compare with the previous build\'s reading.');
}

/** The baseline median from --sim-baseline (a number) or --sim-baseline-file (JSON with medianMs). */
function simBaseline(options, root) {
  if (options['sim-baseline'] !== undefined && options['sim-baseline-file'] !== undefined) fail('pass --sim-baseline or --sim-baseline-file, not both', 'Use --sim-baseline-file perf-baselines/cold-start-sim-<platform>.json.');
  if (options['write-sim-baseline'] && options['sim-baseline-file'] === undefined) fail('--write-sim-baseline needs --sim-baseline-file <file>', 'Pass the repo-relative file to write, e.g. perf-baselines/cold-start-sim-ios.json.');
  if (options['sim-baseline'] !== undefined) {
    const value = Number(options['sim-baseline']);
    if (!(value > 0)) fail(`--sim-baseline must be a positive number of ms, got ${options['sim-baseline']}`, 'Pass the medianMs of the committed simulator or emulator baseline, or use --sim-baseline-file.');
    return { isSim: true, baseline: value, writeTo: null };
  }
  const given = options['sim-baseline-file'];
  if (given === undefined) return { isSim: false, baseline: Number.NaN, writeTo: null };
  if (given.startsWith('/') || given.split(/[\\/]/).includes('..')) fail(`--sim-baseline-file must be repo-relative, got ${given}`, 'Pass e.g. perf-baselines/cold-start-sim-ios.json.');
  const file = join(root, given);
  if (!existsSync(file)) {
    if (options['write-sim-baseline']) return { isSim: true, baseline: Number.NaN, writeTo: { file, given } };
    fail(`nothing to compare: the baseline ${given} does not exist yet`, 'On the first accepted run add --write-sim-baseline (it writes this run\'s median), then commit the file.');
  }
  if (options['write-sim-baseline']) fail(`the baseline ${given} already exists; --write-sim-baseline never overwrites it`, 'Drop --write-sim-baseline to compare, or delete the file deliberately (a reviewed change) to re-baseline.');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`the baseline ${given} is not valid JSON: ${error.message}`, 'Restore it from git, or delete it and rerun with --write-sim-baseline.');
  }
  if (!(typeof parsed?.medianMs === 'number' && parsed.medianMs > 0)) fail(`the baseline ${given} has no positive medianMs`, 'It holds { "medianMs": <n>, ... }; restore it from git.');
  console.log(`baseline: ${given} medianMs ${parsed.medianMs}`);
  return { isSim: true, baseline: parsed.medianMs, writeTo: null };
}

function checkFrames(valid, { isSim, budgets, problem }) {
  const frames = valid.filter((e) => e.kind === 'frames');
  if (frames.length === 0 && !isSim) problem('frame-data', 'no frame-time recording in the report', 'Debug menu > Performance > "Record frame times", then use the busiest screens (scroll the longest list, play every animation) for at least 60 s before sharing.');
  for (const entry of frames) {
    const { hitchMsPerS, p95UpToMs, frames: count, refreshHz } = entry.data;
    console.log(`frames ${entry.label}: ${count} frames at ${refreshHz} Hz, p95 <= ${p95UpToMs} ms, hitch ${hitchMsPerS} ms/s`);
    if (typeof hitchMsPerS !== 'number') problem('report-shape', `${entry.label}: hitchMsPerS is ${JSON.stringify(hitchMsPerS)}, not a number`, 'Export the report again from the debug menu; do not edit it by hand.');
    else if (hitchMsPerS > budgets.hitchMsPerSecondMax) problem('hitch-rate', `${entry.label}: hitch rate ${hitchMsPerS} ms/s is over ${budgets.hitchMsPerSecondMax} ms/s`, 'Find the per-frame work: React state per frame, Skia allocations in a worklet, unbatched draws (an atlas), frame callbacks that never stop, JS work during a scroll.');
    // A p95 in the slowest bucket (> 100 ms) is Infinity in the app, which JSON writes as null.
    if (typeof p95UpToMs !== 'number' || p95UpToMs > budgets.frameP95MsMax) {
      const shown = typeof p95UpToMs === 'number' ? `up to ${p95UpToMs} ms` : 'above 100 ms (null = the slowest bucket)';
      problem('frame-p95', `${entry.label}: p95 frame time ${shown} is over ${budgets.frameP95MsMax} ms`, 'Reduce the busiest frame: re-record only the dynamic layer, cache static layers as a picture, keep the draw-call budget, virtualize long lists.');
    }
  }
}

function checkBenchmarks(valid, { isSim, budgets, problem }) {
  const benchmarks = valid.filter((e) => BENCHMARK_KINDS.has(e.kind));
  if (benchmarks.length === 0 && !isSim) problem('storage-write-runs', 'no storage benchmark in the report', 'Debug menu > Performance > "Run storage benchmark" once on this build, then share the report again.');
  for (const entry of benchmarks) {
    const { p95, writes } = entry.data;
    console.log(`storage write: p95 ${p95} ms over ${writes ?? 'an unrecorded number of'} writes`);
    if (typeof writes !== 'number' || writes < BENCHMARK_WRITES) problem('storage-write-runs', `the storage benchmark timed ${typeof writes === 'number' ? writes : 'an unrecorded number of'} writes, not at least ${BENCHMARK_WRITES}`, 'Run the benchmark from the current build (runStorageBenchmark records writes: 300 after 20 warm-ups).');
    if (typeof p95 === 'number' && p95 >= budgets.saveWriteP95MsMax) problem('storage-write-p95', `storage write p95 ${p95} ms is not under ${budgets.saveWriteP95MsMax} ms`, 'Check that one change is one transaction, that no write runs per row or per frame, and that the serialized size does not grow with the data; compare with the Jest storage-write guard.');
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const path = resolve(positionals[0]);
  const root = requireDir(resolve(positionals[1] ?? '.'), 'repo root');
  const { parsed, entries } = readReport(path, positionals[0]);
  const { isSim, baseline, writeTo } = simBaseline(options, root);
  const minLaunches = Number(options['min-launches']);
  if (!(Number.isInteger(minLaunches) && minLaunches >= 1)) fail(`--min-launches must be a positive whole number, got ${options['min-launches']}`, 'Pass --min-launches 5.');
  const { budgets } = loadBudgets(root);
  const shown = toPosix(positionals[0]);
  const report = createReporter({ name: 'check-perf-report', json: options.json });
  const problem = (rule, message, fix) => report.problem({ file: shown, line: 0, rule, message, fix });
  const valid = [];
  entries.forEach((entry, index) => {
    const isEntry = entry && typeof entry === 'object' && typeof entry.kind === 'string' && typeof entry.data === 'object' && entry.data !== null;
    if (isEntry) valid.push(entry);
    else problem('report-shape', `entry ${index} is not { kind, label, atEpochMs, data }`, 'Export the report again from the debug menu; do not edit it by hand.');
  });
  if (!Array.isArray(parsed)) console.log(`report: ${parsed.appId ?? '?'} ${parsed.appVersion ?? '?'} (${parsed.buildNumber ?? '?'}) on ${parsed.deviceModel ?? '?'} (${parsed.platform ?? '?'} ${parsed.osVersion ?? '?'})`);
  const headerBuild = !Array.isArray(parsed) && (typeof parsed.buildNumber === 'string' || typeof parsed.buildNumber === 'number') ? String(parsed.buildNumber) : null;
  const judged = entriesOfBuild(valid, options.build ?? headerBuild);
  const writeBaseline = writeTo === null ? null : (medianMs, launches) => {
    mkdirSync(dirname(writeTo.file), { recursive: true });
    const deviceModel = Array.isArray(parsed) ? undefined : parsed.deviceModel;
    writeFileSync(writeTo.file, `${JSON.stringify({ medianMs: Math.round(medianMs), launches, build: options.build ?? headerBuild ?? undefined, deviceModel }, null, 2)}\n`);
    console.log(`baseline: wrote ${writeTo.given} with medianMs ${Math.round(medianMs)} (${launches} launches); commit it, later runs compare against it`);
  };
  const ctx = { isSim, minLaunches, budgets, baseline, problem, writeBaseline };
  checkColdStart(judged, ctx);
  checkFrames(judged, ctx);
  checkBenchmarks(judged, ctx);
  if (options.memory !== undefined) checkMemory(resolve(options.memory), options.memory, ctx);
  return report.finish({ checked: valid.length, unit: 'report entries' });
});
