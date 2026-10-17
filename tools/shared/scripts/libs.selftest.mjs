#!/usr/bin/env node
// libs.selftest.mjs: runs every lib/<name>.selftest.mjs (the self-tests of the shared helper libs) and
// prints one line per file, then the RESULT line. The library's selftest-all runs this file because
// it runs every shared scripts/*.selftest.mjs.
//   node libs.selftest.mjs

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESULT_PATTERN, createReporter, parseArgs, run } from './check-lib.mjs';

const LIB = join(dirname(fileURLToPath(import.meta.url)), 'lib');

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'libs.selftest', summary: 'Runs every lib/*.selftest.mjs and fails when any of them fails.', usage: '' });
  const report = createReporter({ name: 'libs.selftest' });
  const files = readdirSync(LIB).filter((name) => name.endsWith('.selftest.mjs')).sort();
  for (const name of files) {
    const result = spawnSync(process.execPath, [join(LIB, name)], { cwd: LIB, encoding: 'utf8', timeout: 300000 });
    const stdout = result.stdout ?? '';
    const final = stdout.trim().split('\n').at(-1) ?? '';
    if (result.status === 0 && final === 'RESULT: PASS') {
      console.log(`ok   lib/${name}`);
      continue;
    }
    const failures = stdout.split('\n').filter((line) => line.startsWith('FAIL ') || line.startsWith('ERROR ')).slice(0, 5).join(' | ');
    report.problem({ file: `lib/${name}`, rule: 'lib-selftest', message: `${RESULT_PATTERN.test(final) ? final : `exit ${result.status}, no RESULT line`}${failures ? `: ${failures}` : ''}`, fix: `Run node lib/${name} and fix what it reports.` });
  }
  return report.finish({ checked: files.length, unit: 'lib self-tests' });
});
