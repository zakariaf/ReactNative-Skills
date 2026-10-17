#!/usr/bin/env node
// maestro-spawns.selftest.mjs: the self-test of lib/maestro-spawns.mjs (spawns that name their device,
// through flags or a device-binding helper, one const or one builder deep; the per-command --udid;
// fixed driver ports; configurable helper names; the driver-port option). Prints ok / FAIL lines and
// the RESULT line.

import assert from 'node:assert/strict';

import { createReporter, maskComments, parseArgs, run } from '../check-lib.mjs';
import { DEFAULT_DEVICE_HELPERS, maestroSpawnProblems } from './maestro-spawns.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const files = (map) => Object.entries(map).map(([rel, code]) => ({ rel, code: maskComments(code) }));
const lines = (problems) => problems.map((problem) => `${problem.file}:${problem.line} ${problem.message}`).sort();

test('spawns that name the device pass; one that does not fails with the old message', () => {
  const problems = maestroSpawnProblems(files({
    'scripts/e2e/maestro-bin.ts': "import { join } from 'node:path';\nexport const MAESTRO_BIN = join(home, '.maestro', 'bin', 'maestro');\n",
    'scripts/e2e/run-e2e.ts': [
      "import { spawnSync } from 'node:child_process';",
      "import { MAESTRO_BIN } from './maestro-bin';",
      "import { maestroGlobalArgs } from './maestro-args';",
      "spawnSync(MAESTRO_BIN, [...maestroGlobalArgs({ udid, driverPort }), 'test', flow]);",
      "const args = ['--device', udid, '--driver-host-port', String(port), 'test', flow];",
      'spawnSync(MAESTRO_BIN, args);',
      "spawnSync(MAESTRO_BIN, ['--version']);",
      "spawnSync(MAESTRO_BIN, buildArgs(flow));",
      "spawnSync(MAESTRO_BIN, ['test', flow]);",
      '',
    ].join('\n'),
    'scripts/e2e/build-args.ts': "export function buildArgs(flow: string) {\n  return ['--device', udid, '--driver-host-port', port, 'test', flow];\n}\n",
  }));
  assert.deepEqual(lines(problems), ["scripts/e2e/run-e2e.ts:9 spawns Maestro without --device <udid> and --driver-host-port <port> before the command, so the run can reach another session's simulator or XCTest driver"]);
  assert.match(problems[0].fix, /maestroGlobalArgs\(\{ udid, driverPort \}\)/);
  assert.doesNotMatch(problems[0].fix, /packages\/|tooling\/src/);
});

test('the bare maestro command on PATH, exec step objects, --udid and fixed ports', () => {
  const problems = maestroSpawnProblems(files({
    'scripts/e2e.ts': [
      "execa('maestro', ['test', '.maestro/flows/smoke.yaml']);",
      "spawnSync('maestro', ['--device', udid, '--driver-host-port', port, 'test', flow]);",
      "steps.push({ file: MAESTRO, args: ['test', flow] });",
      "const MAESTRO = '/opt/maestro/bin/maestro';",
      "spawnSync('/opt/maestro/bin/maestro', ['test', '--udid', udid, flow]);",
      "spawnSync(MAESTRO, ['--device', udid, '--driver-host-port', '7001', 'test']);",
      '',
    ].join('\n'),
  }));
  assert.deepEqual(lines(problems), [
    'scripts/e2e.ts:1 spawns Maestro without --device <udid> and --driver-host-port <port> before the command, so the run can reach another session\'s simulator or XCTest driver',
    'scripts/e2e.ts:3 runs Maestro without --device <udid> and --driver-host-port <port> before the command',
    "scripts/e2e.ts:5 passes Maestro's per-command --udid, which leaves the XCTest driver port shared with every other session",
    'scripts/e2e.ts:5 spawns Maestro without --device <udid> and --driver-host-port <port> before the command, so the run can reach another session\'s simulator or XCTest driver',
    'scripts/e2e.ts:6 uses a fixed Maestro driver port, which a second run on this Mac shares',
  ]);
});

test('options: other helper names, no driver-port requirement, a custom fix', () => {
  const source = files({ 'scripts/run.ts': "spawnSync('maestro', [...deviceArgs(udid), 'test', flow]);\nspawnSync('maestro', ['--device', udid, 'test', flow]);\n" });
  assert.deepEqual(DEFAULT_DEVICE_HELPERS, ['maestroGlobalArgs']);
  assert.equal(maestroSpawnProblems(source).length, 2, 'by default deviceArgs is unknown and --driver-host-port is required');
  const relaxed = maestroSpawnProblems(source, { helpers: ['deviceArgs'], requireDriverPort: false, fix: 'Use deviceArgs(udid).' });
  assert.deepEqual(relaxed, []);
  const strictHelpers = maestroSpawnProblems(files({ 'scripts/run.ts': "spawnSync('maestro', ['test', flow]);\n" }), { helpers: ['deviceArgs'], requireDriverPort: false, fix: 'Use deviceArgs(udid).' });
  assert.deepEqual(strictHelpers.map((problem) => [problem.message, problem.fix]), [['spawns Maestro without --device <udid> before the command, so the run can drive whichever simulator answers first', 'Use deviceArgs(udid).']]);
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'maestro-spawns.selftest', summary: 'Self-test of lib/maestro-spawns.mjs.', usage: '' });
  const report = createReporter({ name: 'maestro-spawns.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'lib/maestro-spawns.mjs', rule: 'lib-selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix lib/maestro-spawns.mjs (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
