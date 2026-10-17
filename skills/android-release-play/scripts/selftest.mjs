#!/usr/bin/env node
// selftest.mjs: proves both checkers on their good fixtures and on one planted bug per rule.
// Both suites start from the shipped templates plus tests/bases/app (a local-lane Tasks app), so the
// self-test also proves the templates pass the checkers. check-store-aab cases describe their bundle
// in aab.json; args() writes the .aab from it (manifest encoded the way aapt2 writes it, libraries
// and signature blocks from tests/real-tools.json) before each run. Before the suites it proves the
// stamp: a passing gate writes { result, sha256, versionCode, applicationId }, a failing gate and a
// rehearsal write nothing, and relative --aab and --stamp paths start at the repo root, not at the
// folder the gate was started from.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleSuiteCases, makeTempDir, readSuiteSpec, removeTempDir, runSelftest } from './check-lib.mjs';
import { writeAab } from './lib/aab-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..');
const FIXTURES = join(SKILL, 'tests', 'fixtures');
const REAL = JSON.parse(readFileSync(join(SKILL, 'tests', 'real-tools.json'), 'utf8'));

/** Writes app-release.aab from the case's aab.json (none: the case tests a missing bundle). */
function aabArgs(dir) {
  const spec = join(dir, 'aab.json');
  if (existsSync(spec)) writeAab(join(dir, 'app-release.aab'), JSON.parse(readFileSync(spec, 'utf8')), REAL);
  return [dir, '--aab', join(dir, 'app-release.aab'), '--tags-list', join(dir, 'tags.txt')];
}

function stampProblems() {
  const suiteDir = join(FIXTURES, 'check-store-aab');
  const into = makeTempDir('android-release-play-stamp-');
  try {
    const cases = assembleSuiteCases({ suiteDir, skillDir: SKILL, into, spec: readSuiteSpec(suiteDir), only: (name) => ['good', 'bad-debuggable', 'pass-rehearsal'].includes(name) });
    const dirOf = (name) => cases.find((item) => item.name === name).dir;
    const gate = (name, extra = []) => {
      const stamp = join(into, `${name}.json`);
      spawnSync(process.execPath, [join(HERE, 'check-store-aab.mjs'), ...aabArgs(dirOf(name)), '--stamp', stamp, ...extra], { encoding: 'utf8' });
      return existsSync(stamp) ? JSON.parse(readFileSync(stamp, 'utf8')) : null;
    };
    const problems = [];
    const good = gate('good');
    const sha256 = createHash('sha256').update(readFileSync(join(dirOf('good'), 'app-release.aab'))).digest('hex');
    if (good?.result !== 'PASS' || good.sha256 !== sha256 || good.versionCode !== 15 || good.applicationId !== 'com.acme.tasks' || good.isRehearsal !== false) problems.push('a passing gate did not write { result: PASS, sha256, versionCode: 15, applicationId, isRehearsal: false }');
    if (gate('bad-debuggable') !== null) problems.push('a failing gate wrote a stamp');
    if (gate('pass-rehearsal', ['--rehearsal']) !== null) problems.push('a rehearsal wrote a stamp');
    const relative = ['build/release-android/aab-gate.json'];
    spawnSync(process.execPath, [join(HERE, 'check-store-aab.mjs'), dirOf('good'), '--aab', 'app-release.aab', '--tags-list', 'tags.txt', '--stamp', relative[0]], { cwd: into, encoding: 'utf8' });
    if (!existsSync(join(dirOf('good'), ...relative[0].split('/'))) || existsSync(join(into, 'build'))) problems.push('relative --aab, --tags-list and --stamp were not read from the repo root (the stamp must land in <root>/build/release-android/, never in the current folder)');
    return problems;
  } finally {
    removeTempDir(into);
  }
}

const problems = stampProblems();
for (const problem of problems) console.log(`FAIL scripts/check-store-aab.mjs [selftest-stamp] ${problem} Fix: Write the stamp only after a PASS without --rehearsal, with the bundle's sha256.`);
if (problems.length > 0) {
  console.log(`RESULT: FAIL (${problems.length} problems)`);
  process.exit(1);
}

await runSelftest(import.meta.url, [
  { script: 'check-store-aab.mjs', fixtures: '../tests/fixtures/check-store-aab', args: aabArgs },
  { script: 'check-play-release-setup.mjs', fixtures: '../tests/fixtures/check-play-release-setup', args: (dir) => [dir] },
]);
