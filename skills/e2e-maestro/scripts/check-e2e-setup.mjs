#!/usr/bin/env node
// check-e2e-setup.mjs: checks the end-to-end tooling of an Expo app without running it: the contract
// (contracts/e2e.json), the pinned, checksum-verified Maestro installer and nothing else installing
// Maestro, the no-telemetry Maestro environment, every Maestro spawn naming its device and a driver
// port of its own and every adb / simctl call naming its device, the build guard (Release, never
// production, ads off when the app has ads), the runner's steps and its socket samplers on the run's
// own devices with their liveness proof, deterministic capture settings, a capture that starts from
// an empty report folder and records failed combinations, the screenshot tolerance, the shared
// sub-flows, the npm scripts, ignored tool and report folders, and consistent baselines.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-e2e-setup.mjs [repo-root] [--baselines]

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, maskComments, notYetCreated, parseArgs, requireDir, run, walkRepo } from './check-lib.mjs';
import { e2eApps, isAdopted, manualFolders, packageJsonOf, readContract, readRepoJson, readRepoText } from './lib/e2e-repo.mjs';
import { maestroSpawnProblems } from './lib/maestro-spawns.mjs';

const SPEC = {
  name: 'check-e2e-setup',
  summary: "Checks the app's Maestro installer, runner, device helpers, sub-flows, scripts and screenshot baselines against the e2e-maestro rules.",
  usage: '[repo-root] [options]',
  options: {
    baselines: { type: 'boolean', help: 'Require every baseline set: each platform x device x locale x theme of contracts/e2e.json screenshots (before a release)' },
    'e2e-dir': { type: 'string', value: 'dir', help: 'The flows folder (default: rn-skills.config.json e2eDir, else .maestro)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  e2e-contract          contracts/e2e.json is missing or invalid (productionAppIds, network, manualFolders)',
    '  e2e-ads-off           package.json has react-native-google-mobile-ads but contracts/e2e.json buildExtra.adsMode',
    '                        is not "off": an ads-on build shows the consent form and tracking prompt on every cleared',
    '                        launch and its ad SDK opens sockets the network proof would have to allow',
    '  maestro-pin           scripts/e2e/install-maestro.sh is missing, pins a version/SHA-256 pair this skill has not',
    '                        verified, skips shasum -a 256 -c, or does not run with set -euo pipefail',
    '  maestro-install-source Maestro installed another way (brew install maestro, the curl | bash installer) in an npm',
    '                        script, a shell script or a CI workflow: unpinned, unverified, analytics on',
    '  maestro-env           maestro-run.ts does not run Maestro with Java 17 and MAESTRO_CLI_NO_ANALYTICS,',
    '                        MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED and MAESTRO_DISABLE_UPDATE_CHECK set to true',
    '  runner-file-missing   a runner, device, build-guard, sampler or screenshot module of scripts/e2e/ is missing',
    '  runner-network        the network policy is not off, but run-e2e.ts does not start the socket sampler or does',
    '                        not fail on network.txt',
    '  sampler-liveness      run-e2e.ts does not prove the samplers alive at the end (trackSampler, proveSamplersAlive:',
    '                        network-samplers.json), or sample-sockets.ts does not write its status after every sample',
    '                        (an empty network.txt from a dead sampler is no evidence)',
    "  sampler-own-devices   the sampler is not started per device with that device's id, or sample-sockets.ts finds",
    '                        the app without the device (any copy on the machine, another session\'s included)',
    '  runner-steps          run-e2e.ts does not list .maestro/flows/<area>/*.yaml, does not exclude quarantine and a11y',
    '                        from the flows step, has no large-text step (a11y flows at the largest size, LANG per',
    '                        locale), writes no run.json, or lists a manual folder',
    '  runner-build-guard    the runner does not refuse a Debug build (no embedded bundle), a production build',
    '                        (productionAppIds) or a build whose expo.extra misses buildExtra, before it touches a device',
    '  maestro-device        a Maestro spawn, npm script or shell line that does not name --device and',
    '                        --driver-host-port before the command (maestroGlobalArgs), the per-command --udid, or a',
    '                        fixed driver port',
    '  shared-device         a tooling source, shell script, npm script or CI workflow targets the booted simulator or',
    '                        all simulators (simctl <verb> booted|all), or runs an adb device command without -s <serial>',
    '                        (an adb spawn whose arguments start with neither -s nor adbArgs/adbDeviceArgs, adb -e/-d)',
    '  openurl-prompt        the tooling opens a link with simctl openurl (iOS shows an "Open in …?" alert nobody accepts)',
    '  maestro-upload        maestro cloud, login, test --analyze or record without --local in tooling, scripts or CI',
    '  deterministic-capture the status bar is not pinned to 9:41 or the text size and appearance are not set before',
    '                        capture (iOS simctl status_bar / ui; Android demo mode / font_scale / uimode)',
    '  screenshot-tolerance  MAX_DIFF_RATIO above 0.002, PIXEL_THRESHOLD above 0.1, or compareScreenshot not using them',
    '  capture-evidence      capture-screenshots.ts does not empty its platform report folder first, or does not record',
    '                        a failed combination as a capture-failed row (a stale or partial summary passes the report)',
    '  subflow-missing       subflows/open-link.yaml or debug-setup.yaml, or (with screenshots) shoot-screen.yaml or',
    '                        the matrix flow, is missing',
    '  e2e-script            the npm scripts e2e:ios, e2e:android (and screenshots:ios, screenshots:android) differ',
    '  gitignore-tools       .gitignore does not ignore tools/maestro (or /tools/) and reports/',
    '  baseline-matrix       a baseline set lacks a screen other sets of its platform have, or (--baselines) a set of',
    '                        the contract\'s matrix is missing',
    'SKIP lines: scripts/ios/simulators.ts and toolchain.ts until ios-simulator-build creates them; scripts/android/adb-args.ts until android-emulator-build does.',
    'NOT APPLICABLE: no app has an e2e folder, contracts/e2e.json or an e2e npm script yet.',
  ].join('\n'),
};

/** Verified Maestro releases: version -> SHA-256 of maestro.zip (the release's checksums_sha256.txt). */
const MAESTRO_PINS = { '2.10.0': '29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991' };
const QUIET_VARS = ['MAESTRO_CLI_NO_ANALYTICS', 'MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED', 'MAESTRO_DISABLE_UPDATE_CHECK'];
const CORE_FILES = ['maestro-args.ts', 'maestro-run.ts', 'run-e2e.ts', 'e2e-cli.ts', 'e2e-config.ts', 'e2e-device.ts', 'build-guard.ts', 'ios-device.ts', 'android-device.ts', 'open-device.ts'];
const NETWORK_FILES = ['network-sampler.ts', 'sample-sockets.ts', 'sampler-evidence.ts'];
/** The device-binding helpers (an adb argument list built by one of them starts with -s <serial>). */
const ADB_HELPERS = ['adbArgs', 'adbDeviceArgs'];
/** adb subcommands that touch no device. */
const ADB_DEVICE_FREE = new Set(['devices', 'start-server', 'kill-server', 'version', 'help', 'keygen', 'mdns']);
const ADB_TEXT = /\badb\s+(?:-[ed]\b|(?:shell|install|install-multiple|uninstall|logcat|emu|push|pull|reverse|forward|reboot|root|wait-for-device)\b)/;
const SIMCTL_SHARED = /\bsimctl\s+[\w-]+\s+(?:booted|all)\b/;
const SCREENSHOT_FILES = ['capture-screenshots.ts', 'screenshots-cli.ts', 'screenshot-compare.ts', 'png-diff.ts', 'write-gallery.ts'];
const IOS_FILES = ['ios/simulators.ts', 'ios/toolchain.ts'];
/** The adb binding android-device.ts and sample-sockets.ts import (adbArgs(serial, ...command)). */
const ANDROID_FILES = ['android/adb-args.ts'];
const PLATFORMS = ['ios', 'android'];
const THEMES = ['light', 'dark'];

const listDir = (path) => (existsSync(path) && statSync(path).isDirectory() ? readdirSync(path).sort() : []);

/** The app's e2e tooling folder and a reader of its comment-masked sources. */
function toolingOf(root, app) {
  const dir = posix.join(app.layout.scriptsDir, 'e2e');
  const rel = (name) => posix.join(dir, name);
  return { dir, rel, code: (name) => maskComments(readRepoText(root, rel(name)) ?? ''), has: (name) => existsSync(join(root, rel(name))) };
}

function checkInstaller(root, tooling, report) {
  const rel = tooling.rel('install-maestro.sh');
  const problem = (message, fix) => report.problem({ file: rel, line: 1, rule: 'maestro-pin', message, fix });
  const text = readRepoText(root, rel);
  if (text === null) {
    problem('is missing', "Copy this skill's templates/scripts/e2e/install-maestro.sh: Maestro comes only from the pinned GitHub zip, never Homebrew or curl | bash.");
    return;
  }
  const version = /MAESTRO_VERSION="([^"]+)"/.exec(text)?.[1];
  const sha = /MAESTRO_SHA256="([0-9a-f]{64})"/.exec(text)?.[1];
  if (!version || !sha) problem('does not pin MAESTRO_VERSION and a 64-hex MAESTRO_SHA256', 'Restore the two pin lines from the template.');
  else if (MAESTRO_PINS[version] === undefined) problem(`pins Maestro ${version}, which this skill has not verified`, 'Re-verify the release (references/maestro-setup.md, "Changing the pin"), then add the pair to this checker and the reference in one Gate-Change commit.');
  else if (MAESTRO_PINS[version] !== sha) problem(`the SHA-256 for ${version} is ${sha.slice(0, 12)}…, not the verified ${MAESTRO_PINS[version].slice(0, 12)}…`, 'Restore the verified checksum; never edit it to match a download.');
  if (!/shasum -a 256 -c/.test(text)) problem('does not verify the download with shasum -a 256 -c', 'Restore the checksum check: a mismatch deletes the zip and exits 1.');
  if (!/set -euo pipefail/.test(text)) problem('does not run with set -euo pipefail', 'Add set -euo pipefail after the shebang.');
}

/** Shell, npm and CI text where Maestro might be installed or run by hand. */
function commandSources(root, app) {
  const sources = [];
  const pkg = readRepoJson(root, packageJsonOf(app))?.data;
  for (const [name, command] of Object.entries(pkg?.scripts ?? {})) sources.push({ file: packageJsonOf(app), line: 1, text: String(command), where: `npm script "${name}"` });
  const files = walkRepo(root, { include: ['*.sh', '*.bash', '*.yml', '*.yaml', 'Makefile'] }).filter((rel) => /\.(sh|bash)$|^\.github\/workflows\/|(^|\/)Makefile$/.test(rel));
  for (const rel of files) {
    (readRepoText(root, rel) ?? '').split('\n').forEach((text, index) => {
      if (!/^\s*#/.test(text)) sources.push({ file: rel, line: index + 1, text, where: rel });
    });
  }
  return sources;
}

function checkCommandLines(root, app, report) {
  for (const { file, line, text, where } of commandSources(root, app)) {
    if (/\bbrew\s+install\b[^\n]*\bmaestro\b|get\.maestro\.mobile\.dev|curl[^\n|]*maestro[^\n|]*\|\s*(ba)?sh/.test(text)) report.problem({ file, line, rule: 'maestro-install-source', message: `${where} installs Maestro outside the pinned installer: ${text.trim().slice(0, 80)}`, fix: 'Run bash scripts/e2e/install-maestro.sh (pinned version, checksum verified, idempotent; the runner calls it anyway).' });
    const run = /(?:^|[\s/;&|(])maestro\b(?!-)((?:\s+--?[\w-]+(?:[ =](?!test\b|hierarchy\b|record\b)\S+)?)*)\s+(test|hierarchy|record|start-device)\b/.exec(text);
    if (run && !(/--device\s+\S+/.test(run[1]) && /--driver-host-port\s+(?!7001\b)\S+/.test(run[1]))) report.problem({ file, line, rule: 'maestro-device', message: `${where} runs maestro ${run[2]} without --device <id> and its own --driver-host-port before the command`, fix: 'Run Maestro through the runner (scripts/e2e/run-e2e.ts, maestroGlobalArgs), or write maestro --device <id> --driver-host-port <free port> test ...' });
    if (/\bmaestro\b[^\n]*(\s--analyze\b|\s(cloud|login)\b|\srecord\b(?![^\n]*--local))/.test(text)) report.problem({ file, line, rule: 'maestro-upload', message: `${where} sends the run off the machine: ${text.trim().slice(0, 80)}`, fix: 'Remove maestro cloud, login, test --analyze, and record without --local; runs stay on the machine.' });
    if (SIMCTL_SHARED.test(text)) report.problem({ file, line, rule: 'shared-device', message: `${where} targets the booted simulator or all simulators: ${text.trim().slice(0, 80)}`, fix: "Name one of the repo's own <prefix>-<purpose> simulators by its UDID; the booted one may be another session's, and all reaches everyone's." });
    if (ADB_TEXT.test(text)) report.problem({ file, line, rule: 'shared-device', message: `${where} runs an adb device command without -s <serial>: ${text.trim().slice(0, 80)}`, fix: 'Write adb -s <serial> <command> (the serial of the emulator this run started), or run it through the tooling (adbArgs).' });
    if (/\bsimctl\s+openurl\b/.test(text)) report.problem({ file, line, rule: 'openurl-prompt', message: `${where} opens a link with simctl openurl`, fix: 'Open links through the open-link or debug-setup sub-flow (it accepts iOS\'s "Open in …?" alert).' });
  }
}

function checkRunEnv(tooling, report) {
  if (!tooling.has('maestro-run.ts')) return;
  const code = tooling.code('maestro-run.ts');
  const rel = tooling.rel('maestro-run.ts');
  for (const name of QUIET_VARS) if (!new RegExp(`${name}\\s*:\\s*['"]true['"]`).test(code)) report.problem({ file: rel, line: 1, rule: 'maestro-env', message: `does not set ${name}: 'true'`, fix: 'Restore MAESTRO_QUIET_ENV from the template: no analytics, no analysis prompt, no update check.' });
  if (!/java_home['"]\s*,\s*\[\s*['"]-v['"]\s*,\s*['"]17['"]/.test(code) || !/JAVA_HOME/.test(code)) report.problem({ file: rel, line: 1, rule: 'maestro-env', message: 'does not select Java 17 for Maestro', fix: "Restore javaHome(): JAVA_HOME, else /usr/libexec/java_home -v 17, else Android Studio's bundled JDK." });
  if (!/\bmaestroEnv\s*\(/.test(code.replace(/export function maestroEnv/, ''))) report.problem({ file: rel, line: 1, rule: 'maestro-env', message: 'runMaestro does not pass maestroEnv(...) to the spawn', fix: 'Spawn Maestro with env: maestroEnv(process.env, javaHome(process.env)).' });
  if (!/\bmaestroGlobalArgs\s*\(/.test(code)) report.problem({ file: rel, line: 1, rule: 'maestro-device', message: 'runMaestro does not put maestroGlobalArgs(...) before the command', fix: 'Restore runMaestro from the template: [...maestroGlobalArgs({ udid: device.id, driverPort }), ...args].' });
}

function checkFiles(root, app, tooling, contract, report) {
  const network = contract?.network?.mode ?? 'offline-only';
  const wantsShots = contract?.screenshots !== undefined || existsSync(join(root, app.layout.e2eDir, 'screenshots'));
  const files = [...CORE_FILES, ...(network === 'off' ? [] : NETWORK_FILES), ...(wantsShots ? SCREENSHOT_FILES : [])];
  for (const name of files.filter((item) => !tooling.has(item))) report.problem({ file: tooling.rel(name), line: 0, rule: 'runner-file-missing', message: 'is missing', fix: `Copy it (and its test) from this skill's templates/scripts/e2e/${name}.` });
  const prerequisites = [...IOS_FILES.map((name) => [name, 'ios-simulator-build']), ...ANDROID_FILES.map((name) => [name, 'android-emulator-build'])];
  for (const [name, owner] of prerequisites) {
    const rel = posix.join(app.layout.scriptsDir, name);
    const reason = notYetCreated(root, { file: rel, owner });
    if (reason) report.skip({ file: rel, rule: 'runner-file-missing', message: reason });
  }
  return { network, wantsShots };
}

function checkRunner(root, app, tooling, contract, report) {
  if (!tooling.has('run-e2e.ts')) return;
  const rel = tooling.rel('run-e2e.ts');
  const code = tooling.code('run-e2e.ts');
  const problem = (rule, message, fix) => report.problem({ file: rel, line: 1, rule, message, fix });
  const restore = "Restore run-e2e.ts from this skill's template.";
  if ((contract?.network?.mode ?? 'offline-only') !== 'off') {
    if (!/sample-sockets/.test(code) || !/network\.txt/.test(code)) problem('runner-network', 'does not run the socket sampler or does not fail on network.txt', `${restore} Every disallowed socket of the app fails the run.`);
    if (/sample-sockets/.test(code) && !/\[\s*SOCKET_SAMPLER\s*,[^\]]*\bdevice\.id\b[^\]]*\]/.test(code)) problem('sampler-own-devices', "starts the socket sampler without the device's id, so it watches every copy of the app on the machine", `${restore} One sampler per device: [SOCKET_SAMPLER, platform, mode, device.id, app.executable, network, hosts].`);
    if (/sample-sockets/.test(code) && !(/\bproveSamplersAlive\s*\(/.test(code) && /\btrackSampler\s*\(/.test(code))) problem('sampler-liveness', 'stops the socket samplers without proving they watched until the end (trackSampler, proveSamplersAlive)', `${restore} proveSamplersAlive reads each status twice, writes network-samplers.json and fails the run on a sampler that died or never found the app.`);
  }
  const steps = [
    [/['"]flows['"]\s*,\s*['"]\*['"]\s*,\s*['"]\*\.yaml['"]|flows\/\*\/\*\.yaml/, 'does not list .maestro/flows/<area>/*.yaml (Maestro runs only the top level of a folder it is given)'],
    [/['"]--exclude-tags['"]\s*,\s*['"]quarantine,a11y['"]/, 'the flows step does not exclude quarantine and a11y flows'],
    [/setTextSize\(\s*['"]largest['"]\s*\)/, 'there is no large-text step at the largest text size'],
    [/['"]--include-tags['"]\s*,\s*['"]a11y['"]/, 'the large-text step does not run the a11y flows'],
    [/LANG=\$\{/, 'the large-text step does not pass LANG per locale'],
    [/run\.json/, 'writes no run.json (check-e2e-report needs it to tell an evidence run from a filtered one)'],
  ];
  for (const [pattern, message] of steps) if (!pattern.test(code)) problem('runner-steps', message, restore);
  for (const folder of manualFolders(root, app, contract).keys()) if (new RegExp(`['"/]${folder}['"/]`).test(code)) problem('runner-steps', `lists the manual folder ${folder}/, whose flows run by hand on another build`, 'Run only .maestro/flows/<area>/*.yaml; manual folders are checked by check-flows and run by hand.');
  const guard = `${code}\n${tooling.code('open-device.ts')}`;
  if (!/\brequireE2eBuild\s*\(/.test(guard)) problem('runner-build-guard', 'runs on whatever build it finds, without refusing a Debug or a production build', `${restore} readCheckedBuild (open-device.ts) calls requireE2eBuild before any device is touched.`);
  const body = /function\s+e2eBuildProblem\b[\s\S]*?\n\}/.exec(tooling.code('build-guard.ts'))?.[0] ?? '';
  if (tooling.has('build-guard.ts') && !(/hasEmbeddedBundle/.test(body) && /productionAppIds/.test(body) && /\(\s*app\s*,\s*buildExtra\s*\)/.test(body))) report.problem({ file: tooling.rel('build-guard.ts'), line: 1, rule: 'runner-build-guard', message: 'e2eBuildProblem does not refuse a build without an embedded bundle, a production app id and a build whose extra misses buildExtra', fix: "Restore e2eBuildProblem from this skill's template." });
}

function checkSampler(tooling, report) {
  if (!tooling.has('sample-sockets.ts')) return;
  const code = tooling.code('sample-sockets.ts');
  const rel = tooling.rel('sample-sockets.ts');
  if (!/\bappProcessPattern\s*\(\s*[^,()]+,\s*[^,()]+\)/.test(code) || !/\badbArgs\s*\(/.test(code)) report.problem({ file: rel, line: 1, rule: 'sampler-own-devices', message: "finds the app without naming the device (appProcessPattern(executable, udid) on iOS, adbArgs(serial, ...) on Android)", fix: "Restore sample-sockets.ts from this skill's template: other sessions run the same app on their own devices." });
  if (!/\bsamplerStatusPath\s*\(/.test(code) || !/\bnextSamplerStatus\s*\(/.test(code)) report.problem({ file: rel, line: 1, rule: 'sampler-liveness', message: 'does not write its status (samples, samples that found the app, the last error) after every sample', fix: "Restore sample-sockets.ts from this skill's template: the runner proves each sampler alive from that status (sampler-evidence.ts)." });
}

/** An app with AdMob is tested only on an ADS_MODE=off build (admob-ads-and-consent). */
function checkAdsOff(root, app, contract, report) {
  const pkg = readRepoJson(root, packageJsonOf(app))?.data ?? {};
  const hasAds = ['dependencies', 'devDependencies'].some((key) => pkg[key]?.['react-native-google-mobile-ads'] !== undefined);
  if (!hasAds || contract === null || contract === undefined) return;
  if (contract.buildExtra?.adsMode !== 'off') report.problem({ file: posix.join(app.layout.contractsDir, 'e2e.json'), line: 1, rule: 'e2e-ads-off', message: `the app has react-native-google-mobile-ads but buildExtra.adsMode is ${JSON.stringify(contract.buildExtra?.adsMode ?? null)}, so the runner accepts an ads-on build`, fix: 'Add "buildExtra": { "adsMode": "off" } and build the E2E build with ADS_MODE=off (admob-ads-and-consent). Ads flows run by hand in a manual folder (ads-smoke), never in the runner, and no ad host goes into allowHosts.' });
}

/** Every non-test tooling source of the app (repo scan: installed skills and outputs pruned). */
function toolingSources(root, app) {
  const prefix = `${app.layout.scriptsDir}/`;
  return walkRepo(root, { include: ['*.ts', '*.mts', '*.mjs', '*.js'], ignore: ['*.test.*', '*.spec.*'] }).filter((rel) => rel.startsWith(prefix)).map((rel) => ({ rel, code: maskComments(readRepoText(root, rel) ?? '') }));
}

/**
 * adb spawns whose argument list starts with neither -s nor a binding helper: execFileSync('adb', [...]),
 * run(tools.adb, [...]). A list held in a variable is not judged (its builder is checked where it is built).
 */
function adbSpawnProblems(code) {
  const found = [];
  const spawn = /\b[\w.]+\(\s*(?:['"`]adb['"`]|[\w.]*\badb(?:Path|Bin)?)\s*,\s*\[\s*(?:\.\.\.\s*)?(?:(['"`])([^'"`]*)\1|(\w+)\s*\()?/g;
  for (const match of code.matchAll(spawn)) {
    const [, , literal, helper] = match;
    const line = code.slice(0, match.index).split('\n').length;
    if (literal !== undefined && literal !== '-s' && !ADB_DEVICE_FREE.has(literal)) found.push({ line, what: `adb ${literal}` });
    else if (helper !== undefined && !ADB_HELPERS.includes(helper)) found.push({ line, what: `adb arguments from ${helper}()` });
  }
  for (const match of code.matchAll(/\bexec(?:Sync)?\(\s*['"`]adb\s+(?!-s\b)([\w-]+)/g)) {
    if (!ADB_DEVICE_FREE.has(match[1])) found.push({ line: code.slice(0, match.index).split('\n').length, what: `adb ${match[1]}` });
  }
  return found;
}

function checkDeviceSafety(root, app, report) {
  const files = toolingSources(root, app);
  for (const found of maestroSpawnProblems(files, { helpers: ['maestroGlobalArgs'] })) report.problem({ ...found, rule: 'maestro-device' });
  for (const { rel, code } of files) {
    const at = (pattern) => code.slice(0, code.search(pattern)).split('\n').length;
    if (/['"](?:booted)['"]|['"]simctl['"][^\n]*['"]all['"]|\bsimctl\s+\w+\s+(?:booted|all)\b/.test(code)) report.problem({ file: rel, line: at(/booted|['"]all['"]/), rule: 'shared-device', message: 'targets the booted simulator or all simulators', fix: "Target the repo's own <prefix>-<purpose> simulator by its UDID (ensureSimulator); another session's simulator may be the booted one." });
    if (/['"]adb['"]\s*,\s*\[\s*['"]-[ed]['"]|\badb\s+-[ed]\s/.test(code)) report.problem({ file: rel, line: at(/-[ed]['"\s]/), rule: 'shared-device', message: "uses adb's implicit device (-e / -d: \"the only emulator\")", fix: 'Pass adbArgs(serial, ...) (-s <serial>) for every device command.' });
    else for (const { line, what } of adbSpawnProblems(code)) report.problem({ file: rel, line, rule: 'shared-device', message: `runs ${what} without -s <serial>: with two devices attached it fails, with one it may be another session's`, fix: 'Build the arguments with adbArgs(serial, [...]) (-s <serial> first); only devices, start-server, kill-server and version need no device.' });
    if (/['"]openurl['"]/.test(code)) report.problem({ file: rel, line: at(/['"]openurl['"]/), rule: 'openurl-prompt', message: 'opens a link with simctl openurl: iOS answers with an "Open in …?" alert nothing accepts, so the app never gets the link', fix: 'Run the debug-setup sub-flow through runMaestro (debugSetupArgs); it accepts the alert and waits for the screen.' });
    if (/['"](?:--analyze|cloud|login)['"]/.test(code)) report.problem({ file: rel, line: at(/['"](?:--analyze|cloud|login)['"]/), rule: 'maestro-upload', message: 'passes --analyze, cloud or login to Maestro', fix: "Remove it: those send the run, its screenshots or the app to Maestro's servers." });
  }
}

function checkCapture(tooling, report) {
  const need = (name, pattern, message, fix) => {
    if (tooling.has(name) && !pattern.test(tooling.code(name))) report.problem({ file: tooling.rel(name), line: 1, rule: 'deterministic-capture', message, fix });
  };
  need('ios-device.ts', /statusBarArgs\s*\(|['"]--time['"]\s*,\s*['"]9:41['"]/, 'does not pin the iOS status bar to 9:41', 'Restore pinStatusBar: simctl(statusBarArgs(udid)) (9:41, full signal and battery).');
  need('ios-device.ts', /content_size/, 'does not set the iOS text size (simctl ui <udid> content_size)', 'Restore setTextSize from the template.');
  need('ios-device.ts', /['"]appearance['"]/, 'does not set the iOS appearance (simctl ui <udid> appearance)', 'Restore setAppearance from the template.');
  need('android-device.ts', /['"]0941['"]/, 'does not pin the Android status bar clock to 09:41 (demo mode)', 'Restore statusBarCommands from the template (sysui demo mode).');
  need('android-device.ts', /font_scale/, 'does not set the Android font scale', 'Restore setTextSize from the template (settings put system font_scale).');
  need('android-device.ts', /['"]uimode['"]/, 'does not set the Android appearance (cmd uimode night)', 'Restore setAppearance from the template.');
  need('capture-screenshots.ts', /\.pinStatusBar\(\)[\s\S]*\.setTextSize\(/, 'does not pin the status bar and set the text size before capturing', 'Restore captureDevice from the template.');
  need('capture-screenshots.ts', /\.setAppearance\(/, 'does not switch the appearance per theme', 'Restore captureDevice from the template (light, then dark).');
  if (tooling.has('capture-screenshots.ts')) {
    const code = tooling.code('capture-screenshots.ts');
    const evidence = (message, fix) => report.problem({ file: tooling.rel('capture-screenshots.ts'), line: 1, rule: 'capture-evidence', message, fix });
    if (!/\brmSync\(\s*capture\.out\b/.test(code)) evidence('does not empty reports/screenshots/<platform>/ before capturing, so a capture that stops early leaves the last summary behind', "Restore main() from this skill's template: rmSync(capture.out, { recursive: true, force: true }) first.");
    if (!/['"]capture-failed['"]/.test(code)) evidence('does not record a failed combination as a capture-failed row (a failure would end the run without a summary, or vanish from it)', "Restore captureCombo and captureDevice from this skill's template.");
  }
  if (!tooling.has('screenshot-compare.ts')) return;
  const rel = tooling.rel('screenshot-compare.ts');
  const code = tooling.code('screenshot-compare.ts');
  const ratio = /\bMAX_DIFF_RATIO\s*=\s*([0-9.eE+-]+)/.exec(code);
  const threshold = /\bPIXEL_THRESHOLD\s*=\s*([0-9.eE+-]+)/.exec(code);
  const tolerance = (message) => report.problem({ file: rel, line: 1, rule: 'screenshot-tolerance', message, fix: "Restore MAX_DIFF_RATIO = 0.002 and PIXEL_THRESHOLD = 0.1 and their use; a tolerance changes only with the reviewer's agreement (Gate-Change trailer), never to clear a diff." });
  if (!ratio || !(Number(ratio[1]) <= 0.002)) tolerance(ratio ? `MAX_DIFF_RATIO is ${ratio[1]}, above 0.002` : 'has no MAX_DIFF_RATIO');
  if (!threshold || !(Number(threshold[1]) <= 0.1)) tolerance(threshold ? `PIXEL_THRESHOLD is ${threshold[1]}, above 0.1` : 'has no PIXEL_THRESHOLD');
  if (!/diffImages\([^)]*PIXEL_THRESHOLD\s*\)/.test(code) || !/<=\s*MAX_DIFF_RATIO\b/.test(code)) tolerance('compareScreenshot does not judge with PIXEL_THRESHOLD and MAX_DIFF_RATIO');
}

function checkSubflows(root, app, wantsShots, contract, report) {
  const e2e = app.layout.e2eDir;
  const wanted = ['subflows/open-link.yaml', 'subflows/debug-setup.yaml', ...(wantsShots ? ['subflows/shoot-screen.yaml'] : [])].map((rel) => posix.join(e2e, rel));
  if (wantsShots) wanted.push(typeof contract?.screenshots?.flow === 'string' ? contract.screenshots.flow : posix.join(e2e, 'screenshots/matrix.yaml'));
  for (const rel of wanted.filter((item) => !existsSync(join(root, item)))) report.problem({ file: rel, line: 0, rule: 'subflow-missing', message: 'is missing', fix: `Copy this skill's templates/${rel.replace(`${e2e}/`, '.maestro/')} and fill its testIDs.` });
}

function checkScripts(root, app, wantsShots, report) {
  const rel = packageJsonOf(app);
  const pkg = readRepoJson(root, rel);
  if (pkg?.error !== undefined) fail(`${rel} is not valid JSON: ${pkg.error}`, 'Fix package.json first.');
  const scripts = pkg?.data?.scripts ?? {};
  const wanted = { 'e2e:ios': 'node scripts/e2e/run-e2e.ts --platform ios', 'e2e:android': 'node scripts/e2e/run-e2e.ts --platform android' };
  if (wantsShots) Object.assign(wanted, { 'screenshots:ios': 'node scripts/e2e/capture-screenshots.ts --platform ios', 'screenshots:android': 'node scripts/e2e/capture-screenshots.ts --platform android' });
  for (const [name, command] of Object.entries(wanted)) if (scripts[name] !== command) report.problem({ file: rel, line: 1, rule: 'e2e-script', message: `script "${name}" is ${scripts[name] === undefined ? 'missing' : JSON.stringify(scripts[name])}`, fix: `Set "${name}": ${JSON.stringify(command)} (options go after --: npm run ${name} -- --sim my-e2e).` });
}

function checkIgnore(root, app, report) {
  const rel = app.dir === '' ? '.gitignore' : posix.join(app.dir, '.gitignore');
  const text = readRepoText(root, rel) ?? readRepoText(root, '.gitignore');
  if (text === null) {
    report.problem({ file: rel, line: 0, rule: 'gitignore-tools', message: 'is missing', fix: 'Add a .gitignore that lists tools/maestro/ and reports/.' });
    return;
  }
  const lines = text.split('\n').map((line) => line.trim().replace(/\/$/, '').replace(/^\//, ''));
  if (!lines.includes('tools') && !lines.includes('tools/maestro')) report.problem({ file: rel, line: 1, rule: 'gitignore-tools', message: 'does not ignore tools/maestro/', fix: 'Add /tools/maestro/ (the 315 MB Maestro install lives there).' });
  if (!lines.includes('reports')) report.problem({ file: rel, line: 1, rule: 'gitignore-tools', message: 'does not ignore reports/', fix: 'Add reports/ (JUnit, network.txt, raw screenshots and diffs are never committed).' });
}

function checkBaselines(root, app, contract, requireAll, report) {
  const base = posix.join(app.layout.e2eDir, 'baselines');
  for (const platform of listDir(join(root, base))) {
    const sets = [];
    for (const device of listDir(join(root, base, platform))) for (const set of listDir(join(root, base, platform, device))) sets.push({ device, set, pngs: listDir(join(root, base, platform, device, set)).filter((name) => name.endsWith('.png')) });
    const plain = sets.filter((item) => !item.set.endsWith('-largest'));
    const union = new Set(plain.flatMap((item) => item.pngs));
    for (const item of plain) {
      const missing = [...union].filter((name) => !item.pngs.includes(name));
      if (missing.length > 0) report.problem({ file: `${base}/${platform}/${item.device}/${item.set}`, line: 0, rule: 'baseline-matrix', message: `lacks ${missing.length} screen(s) the other ${platform} sets have: ${missing.slice(0, 4).join(', ')}`, fix: `Capture them: npm run screenshots:${platform} -- --update --devices ${item.device} --locales ${item.set.split('-')[0]}, open every new PNG, commit with a Gate-Change trailer.` });
    }
  }
  if (!requireAll) return;
  const shots = contract?.screenshots;
  if (!shots) {
    report.problem({ file: posix.join(app.layout.contractsDir, 'e2e.json'), line: 1, rule: 'baseline-matrix', message: '--baselines needs contracts/e2e.json "screenshots" (the matrix locales and devices)', fix: 'Add "screenshots": { "locales": [...], "devices": ["phone", "tablet"] }.' });
    return;
  }
  for (const platform of shots.platforms ?? PLATFORMS) for (const device of shots.devices ?? ['phone', 'tablet']) for (const locale of shots.locales ?? []) for (const theme of THEMES) {
    const set = `${base}/${platform}/${device}/${locale}-${theme}`;
    if (!existsSync(join(root, set))) report.problem({ file: set, line: 0, rule: 'baseline-matrix', message: 'the baseline set is missing', fix: `Capture it: npm run screenshots:${platform} -- --update --devices ${device} --locales ${locale}, open every PNG, commit with a Gate-Change trailer.` });
  }
}

function checkApp(root, app, options, report) {
  const contract = readContract(root, app);
  for (const message of contract.problems) report.problem({ file: contract.rel, line: 1, rule: 'e2e-contract', message: `${contract.rel} ${message}`, fix: "Copy this skill's templates/contracts/e2e.json (and its schema) and fill productionAppIds and network." });
  const tooling = toolingOf(root, app);
  checkInstaller(root, tooling, report);
  const { wantsShots } = checkFiles(root, app, tooling, contract.data, report);
  checkRunEnv(tooling, report);
  checkRunner(root, app, tooling, contract.data, report);
  checkSampler(tooling, report);
  checkAdsOff(root, app, contract.data, report);
  checkDeviceSafety(root, app, report);
  checkCommandLines(root, app, report);
  checkCapture(tooling, report);
  checkSubflows(root, app, wantsShots, contract.data, report);
  checkScripts(root, app, wantsShots, report);
  checkIgnore(root, app, report);
  checkBaselines(root, app, contract.data, options.baselines, report);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${positionals[0] ?? '.'} has no package.json`, 'Run from the repo root or pass the repo root.');
  const report = createReporter({ name: SPEC.name, json: options.json });
  const apps = e2eApps(root, { e2eDir: options['e2e-dir'] }).filter((app) => isAdopted(root, app));
  if (apps.length === 0) return report.notApplicable("the app has no Maestro E2E yet: no .maestro/ folder, no contracts/e2e.json and no e2e npm script (e2e-maestro's workflow creates them)");
  for (const app of apps) checkApp(root, app, options, report);
  return report.finish({ checked: apps.length, unit: apps.length === 1 ? 'app' : 'apps' });
});
