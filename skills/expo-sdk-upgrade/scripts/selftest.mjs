#!/usr/bin/env node
// selftest.mjs: proves both checkers of this skill on overlay suites (tests/fixtures/<suite>/SUITE.json
// names each base; a case holds EXPECT.txt plus its planted change in mutation.json, and ARGS.txt
// when it needs other arguments):
//   check-sdk-alignment.mjs on a single app on SDK 57 (the shipped templates placed in it), the same
//   app scanned for SDK 58 (--target-sdk 58), the app after the move to SDK 58, and two Expo apps
//   with a shared package (when multi-package); older SDK 55 and 56 apps are cases of these suites;
//   check-sdk-trigger.mjs on saved npm facts (no network), judged at a fixed moment (release ages are
//   measured to the minute, as npm measures them at install time): bad-* cases are "a move is due"
//   (upgrade-due, store-deadline), pass-* cases are "no move due" with the reason and moment they
//   print, error-* cases are bad input (exit 2).
// Installed and vendored skills (a folder with a SKILL.md) hold planted findings in every suite and
// must stay invisible.
// Before the suites, unit checks pin the helpers no fixture can reach: the npm pack arguments of
// --online (the release age must be off for reading the tarball), the minute rounding of release
// ages, the .npmrc release-age reading and the skip-aware next SDK.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { join } from 'node:path';

import { isOldEnough, npmPackArgs, oldEnoughAt, recommendedTarget, releaseAgeDays } from './lib/sdk.mjs';
import { runSelftest } from './check-lib.mjs';

const NOW = '2026-11-02T12:00:00Z';

/** Unit checks of lib/sdk.mjs: [name, actual, expected]. */
function unitChecks() {
  const pack = npmPackArgs('58.0.4', '/tmp/sdk-trigger-x');
  const lines = { 56: {}, 57: { skipFrom: [55] }, 58: {} };
  return [
    ['npmPackArgs turns the release age off (reading is not adopting)', pack.includes('--min-release-age=0'), true],
    ['npmPackArgs packs the exact target into the temporary folder', pack.slice(0, 4).join(' '), 'pack expo@58.0.4 --pack-destination /tmp/sdk-trigger-x'],
    ['a release 7 days old to the millisecond is old enough', isOldEnough('2026-10-26T12:00:00.000Z', Date.parse(NOW), 7), true],
    ['a release 6 days 23:59 old is not', isOldEnough('2026-10-26T12:01:00.000Z', Date.parse(NOW), 7), false],
    ['the possible moment rounds up to the minute (never earlier than npm accepts)', oldEnoughAt('2026-10-26T18:00:30.000Z', 7), '2026-11-02T18:01Z'],
    ['a whole-minute publish time is not rounded', oldEnoughAt('2026-10-26T18:00:00.000Z', 7), '2026-11-02T18:00Z'],
    ['.npmrc without min-release-age: the 7-day floor', releaseAgeDays('engine-strict=true\n'), 7],
    ['.npmrc stricter than the floor wins', releaseAgeDays('min-release-age=14 # stricter\n'), 14],
    ['the last acceptable line wins', releaseAgeDays('min-release-age=10\nmin-release-age = "21"\n'), 21],
    ['a line below the floor is ignored (dependency-management flags it)', releaseAgeDays('min-release-age=14\nmin-release-age=3\n'), 14],
    ['an SDK 56 app moves to 57', recommendedTarget(56, lines).target, 57],
    ['an SDK 55 app skips 56 when 57 lists it in skipFrom', recommendedTarget(55, lines).target, 57],
    ['an SDK 57 app moves to 58', recommendedTarget(57, lines).target, 58],
  ];
}

if (!process.argv.includes('--help') && !process.argv.includes('-h') && !process.argv.includes('--materialize')) {
  const failed = unitChecks().filter(([, actual, expected]) => actual !== expected);
  for (const [name, actual, expected] of failed) console.log(`FAIL scripts/lib/sdk.mjs:1 [selftest-unit] ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} Fix: Restore the helper's contract in scripts/lib/sdk.mjs.`);
  if (failed.length > 0) {
    console.log(`selftest: unit checks of lib/sdk.mjs, ${failed.length} problems`);
    console.log(`RESULT: FAIL (${failed.length} problems)`);
    process.exit(1);
  }
  console.log(`ok   lib/sdk.mjs unit checks (${unitChecks().length})`);
}

await runSelftest(import.meta.url, [
  { script: 'check-sdk-alignment.mjs', fixtures: '../tests/fixtures/check-sdk-alignment', args: (dir) => [dir] },
  { script: 'check-sdk-alignment.mjs', fixtures: '../tests/fixtures/check-sdk-alignment-readiness', args: (dir) => [dir, '--target-sdk', '58'] },
  { script: 'check-sdk-alignment.mjs', fixtures: '../tests/fixtures/check-sdk-alignment-58', args: (dir) => [dir] },
  { script: 'check-sdk-alignment.mjs', fixtures: '../tests/fixtures/check-sdk-alignment-monorepo', args: (dir) => [dir] },
  { script: 'check-sdk-trigger.mjs', fixtures: '../tests/fixtures/check-sdk-trigger', args: (dir) => [dir, '--facts', join(dir, 'facts.json'), '--now', NOW] },
]);
