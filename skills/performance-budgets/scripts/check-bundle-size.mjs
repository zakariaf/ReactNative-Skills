#!/usr/bin/env node
// check-bundle-size.mjs: checks the minified JS of a production export (npx expo export --platform
// <ios|android> --no-bytecode) against the size cap and the committed baseline of that platform.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-bundle-size.mjs <export-dir> [repo-root] [--platform ios|android] [--baseline <file>] [--write-baseline]

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, run, toPosix, walk } from './check-lib.mjs';
import { loadBudgets } from './lib/budgets.mjs';

const PLATFORMS = ['ios', 'android'];

const SPEC = {
  name: 'check-bundle-size',
  summary: 'Checks the JavaScript bundle of one platform in an expo export (--no-bytecode) against perf.bundleJsBytesMax and against the committed baseline x perf.bundleGrowthMaxRatio.',
  usage: '<export-dir> [repo-root] [--platform ios|android] [--baseline <file>] [--write-baseline]',
  options: {
    platform: { type: 'string', default: 'ios', value: 'ios|android', help: 'Which platform\'s bundle to measure (default ios)' },
    baseline: { type: 'string', value: 'file', help: 'Baseline JSON { "bundleJsBytes": n } of that platform (the growth check), relative to the repo root (default perf-baselines/bundle-<platform>.json)' },
    'write-baseline': { type: 'boolean', help: 'Write the measured size to the baseline after the checks pass (first run, or an approved growth)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 1, max: 2 },
  details: [
    'Rules:',
    '  bundle-cap      the platform\'s .js bundle is larger than perf.bundleJsBytesMax (starting value 6,000,000 bytes)',
    '  bundle-growth   it is more than perf.bundleGrowthMaxRatio (starting value 1.1) times the baseline',
    '',
    'The baseline is always read: a missing baseline is exit 2 unless --write-baseline creates it (the first run).',
    '',
    'Produce the input with a production variant, one platform per baseline:',
    '  APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform android --no-bytecode --output-dir reports/perf/export-android',
    'Hermes bytecode (.hbc) is not measured: export with --no-bytecode.',
  ].join('\n'),
};

function readBaseline(file) {
  let bytes;
  try {
    bytes = JSON.parse(readFileSync(file, 'utf8')).bundleJsBytes;
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`, 'Write it again with --write-baseline.');
  }
  if (typeof bytes !== 'number' || bytes <= 0) fail(`${file} has no positive bundleJsBytes`, 'Write it again with --write-baseline.');
  return bytes;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const { platform } = options;
  if (!PLATFORMS.includes(platform)) fail(`--platform must be ios or android, got ${platform}`, 'Pass --platform ios or --platform android.');
  const dist = resolve(positionals[0]);
  if (!existsSync(dist) || !statSync(dist).isDirectory()) fail(`nothing to check: ${positionals[0]} is not a folder`, `Pass the --output-dir of npx expo export --platform ${platform} --no-bytecode.`);
  const root = requireDir(resolve(positionals[1] ?? '.'), 'repo root');
  const files = walk(dist, { include: ['*.js', '*.hbc'] }).filter((rel) => rel.split('/').includes(platform));
  const js = files.filter((rel) => rel.endsWith('.js'));
  if (js.length === 0) {
    const isBytecode = files.some((rel) => rel.endsWith('.hbc'));
    fail(isBytecode ? `the ${platform} export holds Hermes bytecode (.hbc), not minified JS` : `no ${platform} .js bundle under ${positionals[0]}`, `Export again with: npx expo export --platform ${platform} --no-bytecode --output-dir <dir>`);
  }
  // Rule 10: the growth check always runs against a committed baseline, resolved against the repo root.
  const baselineGiven = options.baseline ?? `perf-baselines/bundle-${platform}.json`;
  const baselineFile = resolve(root, baselineGiven);
  const bytes = js.reduce((sum, rel) => sum + statSync(resolve(dist, rel)).size, 0);
  const { budgets } = loadBudgets(root);
  const report = createReporter({ name: 'check-bundle-size', json: options.json });
  const shown = toPosix(positionals[0]);
  let problems = 0;
  const problem = (entry) => {
    problems += 1;
    report.problem(entry);
  };
  console.log(`bundle (${platform}): ${bytes.toLocaleString('en-US')} bytes of minified JS in ${js.length} file(s) (cap ${budgets.bundleJsBytesMax.toLocaleString('en-US')})`);
  if (bytes > budgets.bundleJsBytesMax) {
    problem({ file: shown, line: 0, rule: 'bundle-cap', message: `${bytes} bytes of ${platform} JS is over the ${budgets.bundleJsBytesMax}-byte cap`, fix: 'Find the new weight (compare exports before and after the change), drop or replace the dependency, and load locale data only for the app\'s languages.' });
  }
  if (existsSync(baselineFile)) {
    const baselineBytes = readBaseline(baselineFile);
    const ratio = bytes / baselineBytes;
    console.log(`baseline: ${baselineBytes.toLocaleString('en-US')} bytes (x${ratio.toFixed(3)}, limit x${budgets.bundleGrowthMaxRatio})`);
    if (ratio > budgets.bundleGrowthMaxRatio) {
      problem({ file: shown, line: 0, rule: 'bundle-growth', message: `the ${platform} bundle grew x${ratio.toFixed(3)} over the baseline (${baselineBytes} bytes)`, fix: 'Explain the growth to the reviewer; after approval, commit the new baseline (--write-baseline) with the Gate-Change: trailer (perf-baselines/ is a gated path).' });
    }
  } else if (!options['write-baseline']) {
    fail(`baseline ${baselineGiven} does not exist`, 'Create it once with --write-baseline (the first run), then commit it; the growth check is never skipped.');
  }
  if (problems === 0 && options['write-baseline']) {
    // First run: perf-baselines/ does not exist yet.
    mkdirSync(dirname(baselineFile), { recursive: true });
    writeFileSync(baselineFile, `${JSON.stringify({ bundleJsBytes: bytes }, null, 2)}\n`);
    report.note(`wrote ${baselineGiven}`);
  }
  return report.finish({ checked: js.length, unit: 'bundle files' });
});
