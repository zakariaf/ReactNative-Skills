#!/usr/bin/env node
// selftest-all.mjs: runs the maintainer tools' own self-test (tools/tests/selftest.mjs), every
// tools/shared/scripts/**/*.selftest.mjs, and every skill's scripts/selftest.mjs, then prints one
// table and the RESULT line. --shard i/n splits the rows for CI; --skills-root runs an installed copy.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMON_OPTIONS, TOOLS_DIR, defaultTargets, displayPath, resolveRoots, resolveTargets, targetLabel } from './lib/library.mjs';
import { RESULT_PATTERN, UsageError, createReporter, parseArgs, run, toPosix, walk } from './shared/scripts/check-lib.mjs';

const SPEC = {
  name: 'selftest-all',
  summary: 'Runs every skill\'s scripts/selftest.mjs, plus the tools\' own tests/selftest.mjs and every tools/shared/scripts/**/*.selftest.mjs, and prints a table. A skill without scripts is skipped; a skill with scripts but no selftest.mjs fails.',
  usage: '[options] [skill-name-or-path...]',
  options: {
    ...COMMON_OPTIONS,
    'skip-library': { type: 'boolean', help: 'Do not run the tools\' own self-test and the shared self-tests (for an installed copy)' },
    shard: { type: 'string', value: 'i/n', help: 'Run only shard i of n (1-based), for parallel CI jobs' },
    timeout: { type: 'string', value: 'seconds', default: '600', help: 'Time limit per self-test' },
  },
  positionals: { min: 0, max: Infinity },
  details: [
    'Examples:',
    '  node tools/selftest-all.mjs                                   everything',
    '  node tools/selftest-all.mjs --shard 2/4                       the second quarter of the rows',
    '  node tools/selftest-all.mjs --skills-root /tmp/app/.claude/skills --skip-library',
    '                                                                the skills as an installer copied them',
    'When the CI environment variable is set, every failure is also printed as a GitHub',
    '"::error file=...,title=...::message" annotation.',
  ].join('\n'),
};

function hasScripts(dir) {
  const scripts = join(dir, 'scripts');
  return existsSync(scripts) && readdirSync(scripts).some((name) => name.endsWith('.mjs') && name !== 'check-lib.mjs');
}

/** "i/n" -> { index (0-based), count }. */
export function parseShard(text) {
  const match = /^(\d+)\/(\d+)$/.exec(text ?? '');
  const index = match ? Number(match[1]) : NaN;
  const count = match ? Number(match[2]) : NaN;
  if (!match || count < 1 || index < 1 || index > count) throw new UsageError(`--shard "${text}" is not i/n with 1 <= i <= n`, 'Pass for example --shard 1/4.');
  return { index: index - 1, count };
}

/** A GitHub Actions annotation line (values escaped as the workflow-command format requires). */
export function annotation({ file, title, message }) {
  const escapeData = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const escapeProperty = (value) => escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
  return `::error file=${escapeProperty(file)},title=${escapeProperty(title)}::${escapeData(message)}`;
}

/**
 * The rows to run: the tools' self-test and every shared *.selftest.mjs (unless skipLibrary or skill
 * arguments are given), then one row per skill. A shard keeps every n-th row.
 */
export function collectRows({ roots, positionals = [], skipLibrary = false, shard = null }) {
  const targets = positionals.length ? resolveTargets(positionals, roots) : defaultTargets(roots);
  let rows = [];
  if (!skipLibrary && positionals.length === 0) {
    rows.push({ label: '(tools)', script: join(TOOLS_DIR, 'tests', 'selftest.mjs'), shown: 'tools/tests/selftest.mjs' });
    // Shared helpers keep their own self-test next to them: shared/scripts/**/<name>.selftest.mjs.
    const sharedScripts = join(roots.shared, 'scripts');
    if (existsSync(sharedScripts)) {
      for (const rel of walk(sharedScripts, { include: ['*.selftest.mjs'] })) {
        rows.push({ label: `(shared) ${rel.replace(/\.selftest\.mjs$/, '')}`, script: join(sharedScripts, rel), shown: `shared/scripts/${rel}` });
      }
    }
  }
  for (const target of targets) {
    const script = join(target.dir, 'scripts', 'selftest.mjs');
    if (existsSync(script)) rows.push({ label: targetLabel(target), script, shown: 'scripts/selftest.mjs' });
    else if (hasScripts(target.dir)) rows.push({ label: targetLabel(target), script: null, file: join(target.dir, 'scripts'), shown: '(missing)', error: 'has scripts but no scripts/selftest.mjs' });
    else rows.push({ label: targetLabel(target), script: null, shown: '-', skip: 'no scripts' });
  }
  if (shard) rows = rows.filter((_, index) => index % shard.count === shard.index);
  return rows;
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const roots = resolveRoots(options);
  const cwd = dirname(roots.skillsRoot);
  const timeoutMs = Number(options.timeout) * 1000;
  if (!(timeoutMs > 0)) throw new UsageError(`--timeout "${options.timeout}" is not a positive number of seconds`, 'Pass for example --timeout 600.');
  const shard = options.shard ? parseShard(options.shard) : null;
  const rows = collectRows({ roots, positionals, skipLibrary: options['skip-library'], shard });
  const ci = Boolean(process.env.CI);
  const report = createReporter({ name: 'selftest-all' });
  const results = [];
  const fail = (row, rule, message, fix) => {
    report.problem({ file: row.label, rule, message, fix });
    if (ci) console.log(annotation({ file: toPosix(displayPath(row.script ?? row.file ?? roots.skillsRoot)), title: `${rule}: ${row.label}`, message }));
  };
  for (const row of rows) {
    if (row.skip) {
      results.push({ ...row, status: 'SKIP', time: '', note: row.skip });
      continue;
    }
    if (row.error) {
      results.push({ ...row, status: 'FAIL', time: '', note: row.error });
      fail(row, 'selftest-missing', row.error, 'Add scripts/selftest.mjs that calls runSelftest() on tests/fixtures.');
      continue;
    }
    if (!existsSync(row.script)) {
      results.push({ ...row, status: 'FAIL', time: '', note: 'self-test file not found' });
      fail(row, 'selftest-missing', 'self-test file not found', 'Restore it.');
      continue;
    }
    const started = Date.now();
    const child = spawnSync(process.execPath, [row.script], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    const final = (child.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
    const passed = child.status === 0 && final === 'RESULT: PASS';
    const note = child.error?.code === 'ETIMEDOUT' ? `timed out after ${options.timeout}s` : RESULT_PATTERN.test(final) ? final.replace('RESULT: ', '') : `exit ${child.status}, no RESULT line`;
    results.push({ ...row, status: passed ? 'PASS' : 'FAIL', time: `${seconds}s`, note, output });
    if (!passed) fail(row, 'selftest-failed', `${row.shown}: ${note}`, `Run node ${displayPath(row.script)} and fix what it reports.`);
  }
  const width = Math.max(10, ...results.map((row) => row.label.length));
  const scriptWidth = Math.max(8, ...results.map((row) => row.shown.length));
  if (shard) console.log(`shard ${shard.index + 1}/${shard.count}: ${results.length} rows`);
  console.log(`${'SKILL'.padEnd(width)}  ${'SELFTEST'.padEnd(scriptWidth)}  RESULT  TIME     NOTE`);
  for (const row of results) console.log(`${row.label.padEnd(width)}  ${row.shown.padEnd(scriptWidth)}  ${row.status.padEnd(6)}  ${row.time.padEnd(7)}  ${row.status === 'PASS' ? '' : row.note}`);
  for (const row of results.filter((item) => item.status === 'FAIL' && item.output)) {
    console.log(`\n--- ${row.label}: last lines of output ---`);
    console.log(row.output.trimEnd().split('\n').slice(-20).join('\n'));
  }
  console.log('');
  const ran = results.filter((row) => row.status !== 'SKIP').length;
  if (ran === 0 && report.count === 0) {
    if (results.length === 0) {
      console.log('No rows in this shard.');
      console.log('selftest-all: 0 rows checked, 0 problems');
      console.log('RESULT: PASS');
      return 0;
    }
    console.log('No self-tests ran: no skill has scripts yet.');
  }
  return report.finish({ checked: results.length, unit: 'rows' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(main);
