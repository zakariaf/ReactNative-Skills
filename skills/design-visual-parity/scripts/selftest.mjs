#!/usr/bin/env node
// selftest.mjs: proves every script of this skill on good and planted-defect fixtures
// (tests/fixtures/<script>/, overlay format). The comparison suites draw their references and
// captures at run time from small scene files (scripts/lib/scene.mjs), so every planted defect is one
// JSON change; the device suites run against fake xcrun, adb, emulator tools and maestro
// (tests/fakes/). Each case may carry post.json (ops applied after the scenes are drawn and the steps
// before the checked script ran) and ledger.json (the sign-off ledger, with "@sheet" and "@looked"
// filled from the drawn sheets). shoot-design.mjs needs Playwright and Google Chrome: its suite runs
// when the tooling folder holds Playwright (--tooling <dir>, else $DESIGN_VISUAL_PARITY_TOOLING_DIR,
// else .skill-tooling/design-visual-parity in the current folder or an ancestor of the skill, else the
// skill's scripts folder); when it does not, a SKIP line names every case that did not run.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyMutation, runSelftest } from './check-lib.mjs';
import { SKILL, TOOLING_ENV, hasPlaywright, toolingDirOf } from './lib/deps.mjs';
import { buildScenes } from './lib/scene.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FAKES = resolve(here, '..', 'tests', 'fakes');
const FAKE = {
  xcrun: join(FAKES, 'fake-xcrun.mjs'),
  maestro: join(FAKES, 'fake-maestro.mjs'),
  adb: join(FAKES, 'fake-adb.mjs'),
  sdk: join(FAKES, 'fake-android-sdk.mjs'),
  clock: join(FAKES, 'fake-clock.mjs'),
};

const runScript = (script, args, cwd) => spawnSync(process.execPath, [join(here, script), ...args], { cwd, encoding: 'utf8', env: process.env });

/** The sign-off ledger of a case: ledger.json with "@sheet" and "@looked" filled from the drawn sheets. */
function fillLedger(dir) {
  const source = join(dir, 'ledger.json');
  if (!existsSync(source)) return;
  const ledger = JSON.parse(readFileSync(source, 'utf8'));
  for (const entry of ledger.entries ?? []) {
    const run = join(dir, '.parity', entry.device, entry.frame, `${entry.theme}-${entry.lang}${entry.scrollY ? `-y${entry.scrollY}` : ''}`);
    const sheets = existsSync(join(run, 'sheets.json')) ? JSON.parse(readFileSync(join(run, 'sheets.json'), 'utf8')) : { files: {} };
    if (entry.sheetSha256 === '@sheet') entry.sheetSha256 = sheets.files['sheet.png'] ?? 'missing';
    if (entry.looked === '@looked') entry.looked = Object.keys(sheets.files).filter((f) => !f.startsWith('crops/'));
  }
  mkdirSync(join(dir, 'design', 'parity'), { recursive: true });
  writeFileSync(join(dir, 'design', 'parity', 'signoff.json'), `${JSON.stringify(ledger, null, 1)}\n`);
}

/** The case's environment: env.json (FAKE_NOW for the draft date), the fake device's state file. */
function caseEnv(dir) {
  delete process.env.FAKE_NOW;
  process.env.FAKE_PARITY_STATE = join(dir, '.fake-state.json');
  if (existsSync(join(dir, 'env.json'))) Object.assign(process.env, JSON.parse(readFileSync(join(dir, 'env.json'), 'utf8')));
}

/** Draw the scenes, run the steps before the checked script, then the case's post.json and ledger. */
function prepare(dir, { check = false, sheet = false } = {}) {
  caseEnv(dir);
  buildScenes(dir);
  if (check) runScript('check-parity.mjs', [dir], dir);
  if (sheet) runScript('make-sheet.mjs', [dir], dir);
  fillLedger(dir);
  if (existsSync(join(dir, 'post.json'))) applyMutation(dir, JSON.parse(readFileSync(join(dir, 'post.json'), 'utf8')), 'post.json');
  return dir;
}

/**
 * The device suites: the scene's capture becomes what the fake device shows (fake/screen.png, its
 * hierarchy fake/hier.json) and the run folder goes, because capture-app.mjs is what writes it.
 */
function prepareDevice(dir) {
  caseEnv(dir);
  mkdirSync(join(dir, 'fake'), { recursive: true });
  for (const run of buildScenes(dir)) {
    const name = run.split(/[\\/]/).slice(-3).join('-');
    renameSync(join(run, 'app.png'), join(dir, 'fake', `${name}.png`));
    renameSync(join(run, 'app.hier.json'), join(dir, 'fake', `${name}.json`));
    rmSync(run, { recursive: true, force: true });
  }
  const first = join(dir, 'fake', 'test-phone-tasks-default-light-en');
  if (existsSync(`${first}.png`)) {
    copyFileSync(`${first}.png`, join(dir, 'fake', 'screen.png'));
    copyFileSync(`${first}.json`, join(dir, 'fake', 'hier.json'));
  }
  if (existsSync(join(dir, 'post.json'))) applyMutation(dir, JSON.parse(readFileSync(join(dir, 'post.json'), 'utf8')), 'post.json');
  return dir;
}

const fakeTools = ['--xcrun', FAKE.xcrun, '--maestro', FAKE.maestro, '--adb', FAKE.adb];

/**
 * --tooling <dir> (CONTRIBUTING: package-using scripts accept it) is this file's own option: it is
 * taken out of argv before check-lib's runSelftest parses the rest.
 */
function takeToolingOption() {
  const at = process.argv.findIndex((a) => a === '--tooling' || a.startsWith('--tooling='));
  if (at < 0) return undefined;
  const arg = process.argv[at];
  const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : process.argv[at + 1];
  if (!value || value.startsWith('--')) {
    console.log('ERROR [bad-input] --tooling needs a folder Fix: Pass --tooling <dir> (the folder whose node_modules holds playwright).');
    console.log('RESULT: FAIL (1 problems)');
    process.exit(2);
  }
  process.argv.splice(at, arg.includes('=') ? 1 : 2);
  return resolve(value);
}

/** <dir>/.skill-tooling/<skill> holding Playwright, in the current folder or an ancestor of the skill. */
function repoToolingDir() {
  const starts = [process.cwd()];
  for (let dir = resolve(here, '..', '..'); ; dir = dirname(dir)) {
    starts.push(dir);
    if (dirname(dir) === dir) break;
  }
  return starts.map((dir) => join(dir, '.skill-tooling', SKILL)).find((dir) => hasPlaywright(dir));
}

const wantsHelp = process.argv.includes('--help') || process.argv.includes('-h');
if (wantsHelp) {
  console.log(`Also: --tooling <dir>  folder whose node_modules holds playwright for the shoot-design.mjs suite (default: $${TOOLING_ENV}, else .skill-tooling/${SKILL}, else the skill's scripts folder)`);
}
const givenTooling = takeToolingOption();
const tooling = givenTooling ?? (process.env[TOOLING_ENV] ? toolingDirOf({}) : (repoToolingDir() ?? toolingDirOf({})));
const withChrome = hasPlaywright(tooling);
if (withChrome) process.env[TOOLING_ENV] = tooling;
// The draft date test pins the clock and the time zone of the checked script.
process.env.TZ = 'Europe/Berlin';
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import ${pathToFileURL(FAKE.clock).href}`.trim();

const suites = [
  { script: 'check-parity.mjs', fixtures: '../tests/fixtures/check-parity', args: (dir) => [prepare(dir)] },
  { script: 'make-sheet.mjs', fixtures: '../tests/fixtures/make-sheet', args: (dir) => [prepare(dir, { check: true })] },
  { script: 'check-signoff.mjs', fixtures: '../tests/fixtures/check-signoff', args: (dir) => [prepare(dir, { check: true, sheet: true }), '--frame', 'tasks-default'] },
  { script: 'capture-app.mjs', fixtures: '../tests/fixtures/capture-app', args: (dir) => [prepareDevice(dir), '--settle-ms', '1500', ...fakeTools] },
  { script: 'run-parity.mjs', fixtures: '../tests/fixtures/run-parity', args: (dir) => [prepareDevice(dir), ...fakeTools] },
  { script: 'setup-parity-device.mjs', fixtures: '../tests/fixtures/setup-parity-device', args: (dir) => [dir, '--appearance', 'light', '--xcrun', FAKE.xcrun, '--adb', FAKE.adb, '--emulator', FAKE.sdk, '--avdmanager', FAKE.sdk, '--avd-home', join(dir, 'fake-avd')] },
  { script: 'check-mockup.mjs', fixtures: '../tests/fixtures/check-mockup', args: (dir) => [dir] },
  { script: 'check-harness.mjs', fixtures: '../tests/fixtures/check-harness', args: (dir) => [dir] },
];
if (withChrome) {
  suites.push({
    script: 'shoot-design.mjs',
    fixtures: '../tests/fixtures/shoot-design',
    // ARGS.txt (when a case has one) adds the mode after the repo root; the default mode is --check.
    args: (dir, context) => {
      // The committed references of the case: rendered once from its mockup, then its post.json.
      runScript('shoot-design.mjs', [dir, '--update-reference'], dir);
      if (existsSync(join(dir, 'post.json'))) applyMutation(dir, JSON.parse(readFileSync(join(dir, 'post.json'), 'utf8')), 'post.json');
      return context.argsTxt === null ? [dir, '--check'] : [dir];
    },
  });
} else if (!wantsHelp) {
  const notRun = readdirSync(resolve(here, '..', 'tests', 'fixtures', 'shoot-design'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  console.log(`SKIP tests/fixtures/shoot-design [shoot-design-suite] not run: no Playwright in ${tooling} (npm ci --prefix there, pass --tooling <dir> or set ${TOOLING_ENV}; Google Chrome renders). Cases not run: ${notRun.join(', ')}`);
}

await runSelftest(import.meta.url, suites, { timeoutMs: 180000 });
