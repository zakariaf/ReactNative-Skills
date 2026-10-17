#!/usr/bin/env node
// check-ci-lanes.mjs: checks what the GitHub Actions workflows of an Expo app run: the same gate as
// the pre-push hook (npm ci, then npm run verify) on every pull request and push, Node from the
// repo's pin file, only npm scripts that exist, every device lane the app has a script for (Android
// emulator on Linux with KVM, iOS simulator on macOS, JDK 17 where Maestro or Gradle runs), devices
// reached only through the repo's scripts, reports kept on failure, and release lanes that start by
// hand behind a protected environment with a pinned EAS CLI. It also checks that quality-gates.json
// gates the workflow files and that contracts/ci.json opt-outs carry a reason.
// Usage: node check-ci-lanes.mjs [repo-root] [--app-dir <dir>] [--json]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createReporter, matchGlob, notYetCreated, parseArgs, requireDir, run, UsageError } from './check-lib.mjs';
import {
  actionName,
  commandWords,
  DEPENDABOT_FILE,
  entryOf,
  eventsOf,
  FILE_OWNERS,
  jobCommands,
  jobScripts,
  LANES,
  npmRunScript,
  npmRunTarget,
  readRepoFacts,
  readWorkflows,
  SCRIPT_OWNERS,
  shellCommands,
  textOf,
  valueOf,
  withText,
  WORKFLOWS_DIR,
} from './lib/workflows.mjs';

const SPEC = {
  name: 'check-ci-lanes',
  summary: 'Checks that CI runs the local gate (npm ci + npm run verify), the device lanes on the right runners, and release lanes by hand behind an environment with a pinned EAS CLI.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'Folder of the app package.json whose scripts the workflows run (default: the repo root; when multi-package, e.g. apps/mobile)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  yaml-syntax          a workflow that does not parse',
    '  verify-gate          no job on pull_request runs npm ci, then npm run verify; an if: (job or step) can skip them; a paths/branches/types filter on pull_request; no push to main; cancel-in-progress: true on it',
    '  install-ci           npm install / yarn / pnpm instead of npm ci, npm ci with a weakening flag, or a global install without an exact version, --min-release-age=7 and --ignore-scripts',
    '  ad-hoc-command       a tool the npm scripts own run directly (eslint, tsc, jest, prettier, knip, expo, xcodebuild, gradlew, pod)',
    '  node-pin             a job runs npm or node without setup-node reading the repo\'s pin file (.nvmrc)',
    '  script-missing       npm run <script> or node <file> that the repo does not have (SKIP when another skill creates it)',
    '  device-lane          the app has a device script (build:ios:sim, build:android:emu, e2e:ios, e2e:android) that no scheduled or push workflow runs',
    '  lane-runner          an Android lane off Linux or without KVM, an iOS lane off macOS',
    '  jdk-pin              a job runs Gradle or Maestro without selecting JDK 17',
    '  raw-device-command   maestro, adb, emulator, avdmanager, simctl or xcode-select called from a workflow, or an action that drives a device or switches Xcode',
    '  sdk-licence          sdkmanager --licenses in a workflow (accepting a licence is the developer\'s decision)',
    '  reports-artifact     a gate or device job without an upload-artifact step that runs if: always() / failure() / !cancelled()',
    '  release-trigger      a release (eas build / submit / update, a release:* npm script, a scripts/release* lane, also reached through npm run) in a workflow that a push, pull request or schedule starts',
    '  release-environment  a job that runs such a release without a protected environment:',
    '  eas-cli-pinned       npx eas-cli, or expo/expo-github-action without an exact eas-version',
    '  eas-non-interactive  eas build or submit without --non-interactive',
    '  variant-pair         APP_VARIANT set without EXPO_PUBLIC_APP_VARIANT of the same value in the same env block',
    '  workflows-gated      quality-gates.json gatedPaths does not cover a workflow file or dependabot.yml',
    '  lane-opt-out         contracts/ci.json laneOptOuts names an unknown lane, gives no reason, or opts out a lane CI runs',
    'NOT APPLICABLE when the repo has no .github/workflows/ folder; an empty folder is bad input (exit 2).',
    'Multi-package: npm run <x> --workspace <dir> (or -w, --prefix, -C) is looked up in <dir>/package.json, any other npm run in the root package.json.',
  ].join('\n'),
};

const AD_HOC = new Set(['eslint', 'tsc', 'jest', 'prettier', 'knip', 'stryker', 'expo', 'expo-doctor', 'xcodebuild', 'gradlew', 'pod', 'react-native', 'detox', 'fastlane']);
const RAW_DEVICE = new Set(['maestro', 'adb', 'emulator', 'avdmanager', 'xcode-select']);
const DEVICE_ACTIONS = new Set(['reactivecircus/android-emulator-runner', 'maxim-lobanov/setup-xcode', 'futureware-tech/simulator-action', 'mobile-dev-inc/action-maestro-cloud']);
const ANDROID_SCRIPTS = new Set(['build:android:emu', 'e2e:android', 'screenshots:android']);
const IOS_SCRIPTS = new Set(['build:ios:sim', 'e2e:ios', 'screenshots:ios']);
const JDK_SCRIPTS = new Set(['build:android:emu', 'e2e:android', 'e2e:ios', 'screenshots:android', 'screenshots:ios']);
const EAS_RELEASE = new Set(['build', 'submit', 'update', 'deploy', 'workflow:run', 'build:internal']);
const EXACT = /^\d+\.\d+\.\d+$/;
/** How deep npm scripts that call npm scripts are followed (a cycle stops earlier). */
const MAX_SCRIPT_DEPTH = 6;
/** npm scripts that start a release by name (release:eas, release:ios, release:android, release). */
const RELEASE_SCRIPT = /^release(:|$)/;
/** Repo script files that upload to a store (ios-release-testflight, android-release-play). */
const RELEASE_FILE = /^(\.\/)?scripts\/release[\w-]*(\/|\.(ts|mts|js|mjs|cjs|sh)$)/;
/** A script file that spawns eas build / submit / update itself: spawn('eas', ['build', ...]). */
const EAS_SPAWN = /['"`]eas['"`]\s*,\s*\[\s*['"`](build|submit|update)['"`]/;
const REPORTS_IF = /\b(always|failure)\(\)|!\s*cancelled\(\)/;

const toolOf = (words) => {
  const first = words[0] === 'npx' ? words.slice(1).find((word) => !word.startsWith('-')) ?? '' : words[0] ?? '';
  return basename(first.replace(/@[^/]*$/, ''));
};

function easOf(words) {
  if (words[0] === 'eas') return { sub: words[1] ?? '', npx: false };
  if (words[0] === 'npx') {
    const rest = words.slice(1).filter((word) => !word.startsWith('-'));
    const tool = (rest[0] ?? '').replace(/@[^/]*$/, '');
    if (tool === 'eas-cli' || tool === 'eas') return { sub: rest[1] ?? '', npx: true };
  }
  return null;
}

function checkInstall(report, rel, command, hasLockfile) {
  const [tool, sub] = command.words;
  const isGlobal = command.words.includes('-g') || command.words.includes('--global');
  if (tool === 'npm' && ['install', 'i', 'in', 'add', 'isntall'].includes(sub)) {
    if (!isGlobal) {
      report.problem({ file: rel, line: command.line, rule: 'install-ci', message: `"${command.text}" may rewrite the lockfile and install versions nobody reviewed`, fix: 'Install with npm ci (the exact lockfile, or a failure).' });
      return;
    }
    const specs = command.words.slice(2).filter((word) => !word.startsWith('-'));
    const age = /--min-release-age=(\d+)/.exec(command.text);
    const bad = specs.find((spec) => !EXACT.test(spec.slice(spec.lastIndexOf('@') + 1)) || spec.lastIndexOf('@') <= 0);
    if (bad || !age || Number(age[1]) < 7 || !command.words.includes('--ignore-scripts')) {
      report.problem({ file: rel, line: command.line, rule: 'install-ci', message: `global install "${command.text}" skips the repo's dependency policy`, fix: 'Install one exact version with the policy flags: npm install -g --min-release-age=7 --ignore-scripts <pkg>@<x.y.z>.' });
    }
    return;
  }
  if (tool === 'npm' && sub === 'ci') {
    const weak = command.words.find((word) => /^--(force|legacy-peer-deps|ignore-scripts|no-package-lock|no-engine-strict|dangerously-allow-all-scripts|allow-scripts)\b/.test(word) || /^--min-release-age=/.test(word));
    if (weak) report.problem({ file: rel, line: command.line, rule: 'install-ci', message: `npm ci ${weak} switches off part of the dependency policy for the run`, fix: 'Run plain npm ci; the committed .npmrc decides.' });
    return;
  }
  if (hasLockfile && ['yarn', 'pnpm', 'bun'].includes(tool)) {
    report.problem({ file: rel, line: command.line, rule: 'install-ci', message: `${tool} in a repo locked with package-lock.json installs other versions`, fix: 'Use npm ci.' });
  }
}

function checkScriptRefs(report, rel, job, facts) {
  for (const command of jobCommands(job)) {
    const target = npmRunTarget(command.words);
    if (target) {
      const scripts = facts.scriptsIn(target.dir);
      const manifest = target.dir && target.dir !== '.' ? `${target.dir}/package.json` : 'package.json';
      if (scripts === null) report.problem({ file: rel, line: command.line, rule: 'script-missing', message: `npm run ${target.script} names the package ${target.dir}, which has no package.json`, fix: 'Name the workspace folder that holds the script (--workspace apps/<app>).' });
      else if (scripts[target.script] === undefined) {
        const owner = SCRIPT_OWNERS[target.script];
        if (owner) report.skip({ file: rel, rule: 'script-missing', message: `npm script "${target.script}" not yet created (${owner} creates it)` });
        else report.problem({ file: rel, line: command.line, rule: 'script-missing', message: `npm run ${target.script}: ${manifest} has no "${target.script}" script`, fix: `Add the script to ${manifest}, or call one that exists.` });
      }
    }
    const file = ['node', 'bash', 'sh'].includes(command.words[0]) ? command.words.slice(1).find((word) => !word.startsWith('-')) : null;
    if (file && /^(\.\/)?[\w.-]+\//.test(file) && !facts.hasFile(file)) {
      const owner = FILE_OWNERS.find(([prefix]) => file.replace(/^\.\//, '').startsWith(prefix))?.[1];
      const reason = owner ? notYetCreated(facts.root, { file: file.replace(/^\.\//, ''), owner }) : null;
      if (reason) report.skip({ file: rel, rule: 'script-missing', message: `${file.replace(/^\.\//, '')} ${reason}` });
      else report.problem({ file: rel, line: command.line, rule: 'script-missing', message: `${command.words[0]} ${file}: the file does not exist`, fix: 'Create the script, or call the npm script that runs it.' });
    }
  }
}

function hasNodeStep(job, index, facts, report, rel) {
  const setup = job.steps.slice(0, index).filter((step) => actionName(step.uses) === 'actions/setup-node');
  if (setup.length === 0) return false;
  for (const step of setup) {
    const file = withText(step, 'node-version-file');
    if (withText(step, 'node-version') !== null) report.problem({ file: rel, line: step.line, rule: 'node-pin', message: `setup-node in job ${job.id} names node-version ${withText(step, 'node-version')} instead of reading the repo's pin file`, fix: 'Use node-version-file: .nvmrc, so local, CI and EAS read one Node version.' });
    else if (!file) report.problem({ file: rel, line: step.line, rule: 'node-pin', message: `setup-node in job ${job.id} names no version (the runner's preinstalled Node and npm are older than engines allows)`, fix: 'Add node-version-file: .nvmrc.' });
    else if (!facts.hasFile(file)) report.problem({ file: rel, line: step.line, rule: 'node-pin', message: `node-version-file ${file} does not exist`, fix: 'Commit the pin file (.nvmrc holding the Node version the project uses), or point at the one that exists.' });
  }
  return true;
}

function checkJob(report, workflow, job, facts) {
  const rel = workflow.rel;
  const commands = jobCommands(job);
  const scripts = jobScripts(job).map((item) => item.script);
  const usesNode = commands.find((command) => ['npm', 'npx', 'node'].includes(command.words[0]));
  if (usesNode && !hasNodeStep(job, usesNode.step.index, facts, report, rel)) {
    report.problem({ file: rel, line: usesNode.line, rule: 'node-pin', message: `job ${job.id} runs ${usesNode.words[0]} on the runner's preinstalled Node`, fix: 'Add actions/setup-node with node-version-file: .nvmrc before the first npm or node step.' });
  }
  checkScriptRefs(report, rel, job, facts);
  for (const command of commands) {
    checkInstall(report, rel, command, facts.hasFile('package-lock.json'));
    const tool = toolOf(command.words);
    if (AD_HOC.has(tool) && !easOf(command.words)) report.problem({ file: rel, line: command.line, rule: 'ad-hoc-command', message: `${tool} is run directly: CI then checks something other than what verify and the build scripts check`, fix: 'Call the npm script that owns it (npm run verify, npm run build:ios:sim, ...), so CI and the developer run the same command.' });
    if (RAW_DEVICE.has(tool) || (tool === 'xcrun' && command.words.includes('simctl'))) report.problem({ file: rel, line: command.line, rule: 'raw-device-command', message: `${tool === 'xcrun' ? 'xcrun simctl' : tool} is called from the workflow, outside the scripts that name and own their devices`, fix: 'Call the repo script (npm run build:ios:sim, build:android:emu, e2e:ios, e2e:android); it creates a <project>-<purpose> device and addresses it by id.' });
    if (tool === 'sdkmanager' && command.words.includes('--licenses')) report.problem({ file: rel, line: command.line, rule: 'sdk-licence', message: 'the workflow accepts Android SDK licences on the developer\'s behalf', fix: 'Remove the step; the hosted images ship with the SDK licences accepted. A licence the image lacks is the developer\'s decision (android-emulator-build, human steps).' });
  }
  for (const step of job.steps) {
    const name = actionName(step.uses);
    if (DEVICE_ACTIONS.has(name)) report.problem({ file: rel, line: step.line, rule: 'raw-device-command', message: `${name} drives a device or switches Xcode outside the repo's scripts`, fix: 'Remove the action; the build and E2E scripts select the pinned Xcode by version and create their own named devices.' });
  }
  const usesAndroid = scripts.some((script) => ANDROID_SCRIPTS.has(script));
  const usesIos = scripts.some((script) => IOS_SCRIPTS.has(script));
  const labels = job.runners.map((runner) => runner.label.toLowerCase());
  const runsOnLine = job.runsOn?.line ?? job.line;
  if (usesAndroid) {
    if (!labels.some((label) => label.startsWith('ubuntu-') || label === 'linux')) report.problem({ file: rel, line: runsOnLine, rule: 'lane-runner', message: `job ${job.id} runs an Android emulator lane on ${labels.join(', ') || 'no runner'}: macOS arm64 runners cannot nest virtualization, so the emulator never boots`, fix: 'Run the Android lane on ubuntu-24.04 with the KVM udev step.' });
    else if (!job.steps.some((step) => /\bkvm\b/i.test(step.run ?? ''))) report.problem({ file: rel, line: runsOnLine, rule: 'lane-runner', message: `job ${job.id} starts an emulator on Linux without opening /dev/kvm (software emulation is too slow to finish)`, fix: 'Add the "Let the emulator use KVM" step of templates/workflows/devices.yml before the build.' });
  }
  if (usesIos && !labels.some((label) => label.startsWith('macos-') || label === 'macos')) report.problem({ file: rel, line: runsOnLine, rule: 'lane-runner', message: `job ${job.id} runs an iOS simulator lane on ${labels.join(', ') || 'no runner'}`, fix: 'Run the iOS lane on macos-26 (Xcode 26.6 and the iOS 26.5 simulators are on the image).' });
  if (scripts.some((script) => JDK_SCRIPTS.has(script))) {
    const selectsJdk = job.steps.some((step) => /JAVA_HOME_17_/.test(step.run ?? '') || (actionName(step.uses) === 'actions/setup-java' && /^17(\.|$)/.test(withText(step, 'java-version') ?? '')))
      || /17/.test(textOf(valueOf(job.env, 'JAVA_HOME')) ?? '');
    if (!selectsJdk) report.problem({ file: rel, line: job.line, rule: 'jdk-pin', message: `job ${job.id} runs Gradle or Maestro on the image's default JDK (21 on macos-26)`, fix: 'Add a step: echo "JAVA_HOME=$JAVA_HOME_17_X64" >> "$GITHUB_ENV" (JAVA_HOME_17_arm64 on macOS), or actions/setup-java with java-version: \'17\'.' });
  }
  const isGateJob = scripts.includes('verify') || scripts.some((script) => ANDROID_SCRIPTS.has(script) || IOS_SCRIPTS.has(script));
  if (isGateJob && !job.steps.some((step) => actionName(step.uses) === 'actions/upload-artifact' && REPORTS_IF.test(step.if ?? ''))) {
    report.problem({ file: rel, line: job.line, rule: 'reports-artifact', message: `job ${job.id} keeps no reports when it fails (screenshots, junit, coverage die with the runner)`, fix: 'Add actions/upload-artifact with if: ${{ always() }}, path: reports/, if-no-files-found: ignore and retention-days.' });
  }
  checkRelease(report, workflow, job, commands, facts);
}

/**
 * A command and every command the npm scripts it calls run, recursively (package.json text, at most
 * MAX_SCRIPT_DEPTH levels, a cycle stops): [{ words, script }] where script is the npm script it ran.
 */
function expandScripts(words, facts, dir = null, seen = new Set(), depth = 0) {
  const target = npmRunTarget(words);
  const out = [{ words, script: target?.script ?? null }];
  if (!target || depth >= MAX_SCRIPT_DEPTH) return out;
  const packageDir = target.dir ?? dir;
  const key = `${packageDir ?? '.'}:${target.script}`;
  const text = facts.scriptsIn(packageDir)?.[target.script];
  if (seen.has(key) || typeof text !== 'string') return out;
  for (const part of shellCommands(text, 1)) out.push(...expandScripts(commandWords(part.text), facts, packageDir, new Set([...seen, key]), depth + 1));
  return out;
}

/** What makes this (possibly nested) command a release, as words for a message, or null. */
function releaseOf({ words, script }, facts) {
  if (script && RELEASE_SCRIPT.test(script)) return `npm run ${script}`;
  const eas = easOf(words);
  if (eas && EAS_RELEASE.has(eas.sub)) return `eas ${eas.sub}`;
  const file = ['node', 'bash', 'sh', 'tsx'].includes(words[0]) ? words.slice(1).find((word) => !word.startsWith('-')) : null;
  if (file && RELEASE_FILE.test(file)) return `${words[0]} ${file}`;
  if (file && /^(\.\/)?scripts\/eas\//.test(file) && EAS_SPAWN.test(facts.readText(file.replace(/^\.\//, '')) ?? '')) return `${words[0]} ${file} (it spawns eas)`;
  return null;
}

function checkRelease(report, workflow, job, commands, facts) {
  const rel = workflow.rel;
  const easCommands = commands.map((command) => ({ command, eas: easOf(command.words) })).filter((item) => item.eas);
  for (const { command, eas } of easCommands) {
    if (eas.npx) report.problem({ file: rel, line: command.line, rule: 'eas-cli-pinned', message: 'npx eas-cli resolves whatever version is newest and is stopped by strict-allow-scripts inside the repo', fix: 'Install it once: npm install -g --min-release-age=7 --ignore-scripts eas-cli@<x.y.z>, then call eas.' });
    if (['build', 'submit'].includes(eas.sub) && !command.words.includes('--non-interactive')) report.problem({ file: rel, line: command.line, rule: 'eas-non-interactive', message: `eas ${eas.sub} without --non-interactive waits for a prompt until the job times out`, fix: `Add --non-interactive (and name --profile and --platform).` });
  }
  for (const step of job.steps) {
    if (actionName(step.uses) !== 'expo/expo-github-action') continue;
    const version = withText(step, 'eas-version');
    if (version !== null && !EXACT.test(version)) report.problem({ file: rel, line: step.line, rule: 'eas-cli-pinned', message: `expo/expo-github-action installs eas-version ${version}`, fix: 'Pin an exact eas-version at least 7 days old, or install eas-cli@<x.y.z> globally with the policy flags.' });
  }
  // A release reached through npm run is still a release: the script text is followed into package.json.
  const release = commands
    .map((command) => {
      const found = expandScripts(command.words, facts).map((item) => releaseOf(item, facts)).find(Boolean);
      const own = command.words.join(' ');
      return found ? (own.startsWith(found) ? found : `${own} (${found})`) : null;
    })
    .find(Boolean);
  if (!release) return;
  if (!job.environment) report.problem({ file: rel, line: job.line, rule: 'release-environment', message: `job ${job.id} runs ${release} without a protected environment`, fix: 'Add environment: production (Settings > Environments: required reviewers, main only) and keep EXPO_TOKEN there.' });
  for (const trigger of workflow.triggers) {
    const tagsOnly = trigger.event === 'push' && valueOf(trigger.node, 'tags') && !valueOf(trigger.node, 'branches') && !valueOf(trigger.node, 'branches-ignore');
    if (trigger.event !== 'workflow_dispatch' && !tagsOnly) report.problem({ file: rel, line: trigger.line, rule: 'release-trigger', message: `${trigger.event} starts a workflow that runs ${release}: a store build, submission or update would go out without anyone deciding`, fix: 'Start release workflows by hand (workflow_dispatch) or from a pushed release tag only; an npm script that builds or submits is a release too.' });
  }
}

function checkVariantPairs(report, workflow) {
  const blocks = [workflow.env, ...workflow.jobs.flatMap((job) => [job.env, ...job.steps.map((step) => step.env)])];
  for (const block of blocks) {
    const variant = entryOf(block, 'APP_VARIANT');
    const publicVariant = entryOf(block, 'EXPO_PUBLIC_APP_VARIANT');
    if (!variant && !publicVariant) continue;
    if (textOf(variant?.value) !== textOf(publicVariant?.value)) report.problem({ file: workflow.rel, line: (variant ?? publicVariant).line, rule: 'variant-pair', message: 'APP_VARIANT and EXPO_PUBLIC_APP_VARIANT differ in this env block: native config and JS bundle would be built as different variants', fix: 'Set both to the same value in the same block (the build job only; lint and tests need neither).' });
  }
}

function checkGated(report, root, files) {
  const reason = notYetCreated(root, { file: 'quality-gates.json', owner: 'quality-gates' });
  if (reason) {
    report.skip({ file: 'quality-gates.json', rule: 'workflows-gated', message: reason });
    return;
  }
  let gates;
  try {
    gates = JSON.parse(readFileSync(join(root, 'quality-gates.json'), 'utf8'));
  } catch {
    report.problem({ file: 'quality-gates.json', line: 1, rule: 'workflows-gated', message: 'quality-gates.json is not valid JSON', fix: 'Fix it (quality-gates owns the file).' });
    return;
  }
  const globs = Array.isArray(gates.gatedPaths) ? gates.gatedPaths : [];
  const text = readFileSync(join(root, 'quality-gates.json'), 'utf8');
  const line = text.slice(0, Math.max(0, text.indexOf('"gatedPaths"'))).split('\n').length;
  for (const file of files) {
    if (!globs.some((glob) => typeof glob === 'string' && matchGlob(file, glob))) report.problem({ file: 'quality-gates.json', line, rule: 'workflows-gated', message: `gatedPaths does not cover ${file}: a commit can weaken CI without a Gate-Change trailer`, fix: 'Add ".github/workflows/**" and ".github/dependabot.yml" to gatedPaths, in a commit with a Gate-Change: trailer (quality-gates owns the list).' });
  }
}

function checkLanes(report, workflows, facts) {
  const optOuts = facts.contract?.laneOptOuts;
  if (facts.contract && (typeof optOuts !== 'object' || optOuts === null || Array.isArray(optOuts))) {
    report.problem({ file: 'contracts/ci.json', line: 1, rule: 'lane-opt-out', message: 'laneOptOuts is missing or not an object', fix: 'Write "laneOptOuts": {} (or lane: reason entries).' });
  }
  const outs = optOuts && typeof optOuts === 'object' && !Array.isArray(optOuts) ? optOuts : {};
  const runs = (script) => workflows.flatMap((workflow) => workflow.jobs.filter((job) => jobScripts(job).some((item) => item.script === script)).map((job) => ({ workflow, job })));
  for (const [lane, reasonText] of Object.entries(outs)) {
    if (!LANES[lane]) report.problem({ file: 'contracts/ci.json', line: 1, rule: 'lane-opt-out', message: `laneOptOuts names an unknown lane "${lane}"`, fix: `Use one of ${Object.keys(LANES).join(', ')}.` });
    else if (typeof reasonText !== 'string' || reasonText.trim().length < 20) report.problem({ file: 'contracts/ci.json', line: 1, rule: 'lane-opt-out', message: `laneOptOuts.${lane} gives no reason a reviewer can judge`, fix: 'Write why the lane does not run in CI (at least a sentence), or run it.' });
    else if (runs(LANES[lane].script).length > 0) report.problem({ file: 'contracts/ci.json', line: 1, rule: 'lane-opt-out', message: `laneOptOuts.${lane} is stale: a workflow runs ${LANES[lane].script}`, fix: 'Delete the opt-out.' });
  }
  for (const [lane, { script, owner }] of Object.entries(LANES)) {
    if (facts.scripts[script] === undefined || outs[lane] !== undefined) continue;
    const found = runs(script);
    if (found.length === 0) {
      report.problem({ file: WORKFLOWS_DIR, line: 1, rule: 'device-lane', message: `${facts.appDir === '.' ? '' : `${facts.appDir}/`}package.json has "${script}" (${owner}) but no workflow runs it: the ${lane} lane is never proven in CI`, fix: `Add the job from templates/workflows/devices.yml, or record the decision in contracts/ci.json laneOptOuts.${lane} with its reason.` });
      continue;
    }
    const automatic = found.some(({ workflow }) => [...eventsOf(workflow)].some((event) => ['schedule', 'push', 'pull_request', 'merge_group'].includes(event)));
    if (!automatic) report.problem({ file: found[0].workflow.rel, line: found[0].workflow.onLine, rule: 'device-lane', message: `${script} runs only when someone starts it by hand`, fix: 'Add a schedule (nightly) next to workflow_dispatch.' });
  }
}

const ALWAYS_RUNS = /^\s*(\$\{\{\s*)?success\(\)(\s*\}\})?\s*$/;
const PR_DEFAULT_TYPES = ['opened', 'synchronize', 'reopened'];

/** The npm ci and npm run verify commands of a job, in order, or null when it has not both. */
function gateCommands(job) {
  const commands = jobCommands(job);
  const install = commands.findIndex((command) => command.words[0] === 'npm' && command.words[1] === 'ci');
  const verify = commands.findIndex((command, index) => index > install && npmRunScript(command.words) === 'verify');
  return install !== -1 && verify !== -1 ? [commands[install], commands[verify]] : null;
}

/** The first `if:` that can skip the gate (job level, or the npm ci / verify step), or null. */
function gateCondition(job, commands) {
  if (job.if !== null && !ALWAYS_RUNS.test(job.if)) return { line: entryOf(job.node, 'if').line, where: `job ${job.id}`, text: job.if };
  for (const { step } of commands) {
    if (step.if !== null && !ALWAYS_RUNS.test(step.if)) return { line: entryOf(step.node, 'if').line, where: `the step "${step.name ?? step.run}"`, text: step.if };
  }
  return null;
}

const listOf = (node) => (node?.type === 'seq' ? node.items.map((item) => textOf(item) ?? '') : node?.type === 'scalar' && !node.empty ? [node.value] : []);

/** Filters on the pull_request and push triggers that let a pull request or a merge to main skip the gate. */
function checkGateTriggers(report, workflow) {
  for (const trigger of workflow.triggers) {
    if (!trigger.node || trigger.node.type !== 'map') continue;
    if (trigger.event === 'pull_request') {
      for (const key of ['paths', 'paths-ignore', 'branches', 'branches-ignore']) {
        const entry = entryOf(trigger.node, key);
        if (entry) report.problem({ file: workflow.rel, line: entry.line, rule: 'verify-gate', message: `pull_request: ${key} lets a pull request ${key.startsWith('paths') ? 'that changes other files (package.json, a config, a workflow)' : 'into another branch'} merge without running verify (and a required check that never starts blocks it forever)`, fix: `Remove ${key}: the gate runs on every pull request.` });
      }
      const types = listOf(valueOf(trigger.node, 'types'));
      const missing = PR_DEFAULT_TYPES.filter((type) => !types.includes(type));
      if (entryOf(trigger.node, 'types') && missing.length > 0) report.problem({ file: workflow.rel, line: entryOf(trigger.node, 'types').line, rule: 'verify-gate', message: `pull_request types leave out ${missing.join(', ')}: a new push to the pull request is not verified`, fix: 'Remove types: (the default is opened, synchronize, reopened).' });
    }
    if (trigger.event === 'push') {
      for (const key of ['paths', 'paths-ignore']) {
        const entry = entryOf(trigger.node, key);
        if (entry) report.problem({ file: workflow.rel, line: entry.line, rule: 'verify-gate', message: `push: ${key} lets a merge to main that changes other files go unverified`, fix: `Remove ${key}.` });
      }
      const branches = entryOf(trigger.node, 'branches');
      const ignored = entryOf(trigger.node, 'branches-ignore');
      const tags = entryOf(trigger.node, 'tags');
      if (branches && !listOf(branches.value).some((glob) => matchGlob('main', glob))) report.problem({ file: workflow.rel, line: branches.line, rule: 'verify-gate', message: 'push: branches does not include main: what merges is never verified', fix: 'Write push: { branches: [main] }.' });
      else if (ignored && listOf(ignored.value).some((glob) => matchGlob('main', glob))) report.problem({ file: workflow.rel, line: ignored.line, rule: 'verify-gate', message: 'push: branches-ignore excludes main: what merges is never verified', fix: 'Write push: { branches: [main] }.' });
      else if (!branches && !ignored && tags) report.problem({ file: workflow.rel, line: tags.line, rule: 'verify-gate', message: 'push: tags without branches runs only on tags: what merges to main is never verified', fix: 'Write push: { branches: [main] }.' });
    }
  }
}

function checkVerifyGate(report, workflows) {
  const prWorkflows = workflows.filter((workflow) => eventsOf(workflow).has('pull_request'));
  const candidates = prWorkflows.flatMap((workflow) => workflow.jobs.map((job) => ({ workflow, job, commands: gateCommands(job) })).filter((item) => item.commands));
  if (candidates.length === 0) {
    const target = prWorkflows[0] ?? workflows[0];
    report.problem({ file: target.rel, line: target.onLine ?? 1, rule: 'verify-gate', message: 'no job on pull_request runs npm ci and then npm run verify: a pull request can merge without the gates the pre-push hook runs', fix: 'Copy templates/workflows/ci.yml (verify job: checkout, setup-node from .nvmrc, npm ci, npm run verify).' });
    return;
  }
  const clean = candidates.find(({ job, commands }) => !gateCondition(job, commands));
  if (!clean) {
    const { workflow, job, commands } = candidates[0];
    const condition = gateCondition(job, commands);
    report.problem({ file: workflow.rel, line: condition.line, rule: 'verify-gate', message: `${condition.where} runs only if: ${condition.text}: a pull request can skip the gate`, fix: 'Remove the if: from the verify job and its npm ci and npm run verify steps; the gate runs on every pull request and push.' });
    checkGateTriggers(report, workflow);
    return;
  }
  const gated = clean.workflow;
  checkGateTriggers(report, gated);
  for (const node of [gated.concurrency?.value, clean.job.concurrency]) {
    const cancel = valueOf(node, 'cancel-in-progress');
    if (textOf(cancel) === 'true' && eventsOf(gated).has('push')) report.problem({ file: gated.rel, line: cancel.line, rule: 'verify-gate', message: 'cancel-in-progress: true also cancels runs on main: two quick merges cancel the first, and that merged commit is never verified', fix: "Write cancel-in-progress: ${{ github.event_name == 'pull_request' }} (only a pull request's older runs are cancelled)." });
  }
  if (!eventsOf(gated).has('push')) report.problem({ file: gated.rel, line: gated.onLine, rule: 'verify-gate', message: 'the verify workflow does not run on push: main is never verified after a merge (or a direct push)', fix: 'Add push: { branches: [main] } to its triggers.' });
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: SPEC.name, json: options.json });
  if (!existsSync(join(root, WORKFLOWS_DIR))) return report.notApplicable(`no ${WORKFLOWS_DIR}/ folder: this repo has no GitHub Actions CI`);
  const workflows = readWorkflows(root);
  if (workflows.length === 0) throw new UsageError(`nothing to check: ${WORKFLOWS_DIR}/ holds no .yml file`, 'Add a workflow (templates/workflows/ci.yml of this skill) or remove the empty folder.');
  const facts = { ...readRepoFacts(root, { appDir: options['app-dir'] ?? '.' }), root };
  const parsed = [];
  for (const workflow of workflows) {
    if (workflow.error) {
      report.problem({ file: workflow.rel, line: workflow.error.line, rule: 'yaml-syntax', message: workflow.error.message, fix: 'Write plain block YAML: spaces only, no anchors, aliases or tags.' });
      continue;
    }
    parsed.push(workflow);
    for (const job of workflow.jobs) checkJob(report, workflow, job, facts);
    checkVariantPairs(report, workflow);
  }
  // The gate and the lanes are judged across all workflows: with one unreadable, they cannot be.
  if (parsed.length === workflows.length) {
    checkVerifyGate(report, parsed);
    checkLanes(report, parsed, facts);
  } else report.note('verify-gate, device-lane and lane-opt-out were not judged: fix the yaml-syntax problem first');
  const gatedFiles = [...workflows.map((workflow) => workflow.rel), ...(facts.hasFile(DEPENDABOT_FILE) ? [DEPENDABOT_FILE] : [])];
  checkGated(report, root, gatedFiles);
  return report.finish({ checked: workflows.length, unit: 'workflows' });
});
