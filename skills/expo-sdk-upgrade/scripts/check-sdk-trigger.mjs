#!/usr/bin/env node
// check-sdk-trigger.mjs: answers "is an Expo SDK or toolchain move due for this repo?".
//   RESULT: PASS (exit 0)  no move is due. Either the next SDK is not npm "latest" yet, or it (or a
//                          package the repo takes from its module map, or an @react-native tool that
//                          follows React Native) is missing or younger than the repo's release age
//                          (.npmrc min-release-age, 7 days at least), measured to the minute as npm
//                          measures it. Each reason is a "wait" line with the moment it can change;
//                          "verdict" says to stay. A store requirement that starts later is a
//                          "notice" line.
//   RESULT: FAIL (exit 1)  [upgrade-due]: every trigger condition holds and the app is still on the
//                          older SDK, so the move is due and not yet done; the "plan" lines say how.
//                          [store-deadline]: an App Store or Google Play requirement in effect is not
//                          met (the Xcode the builds use, the Android targetSdk the app ships).
//   exit 2                 no facts: pass --online (npm) or --facts <file> (a saved facts file).
// The next SDK is the app's SDK + 1, unless a later SDK's entry lists the app's SDK in "skipFrom"
// (Expo's notes say to skip one: SDK 55 apps go straight to 57). The third condition of the trigger
// (everything green on a branch) is the runbook.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-sdk-trigger.mjs . --online

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  androidPins,
  androidTarget,
  appsSdk,
  bare,
  compareVersions,
  depsOf,
  isOldEnough,
  lineOrder,
  loadSdkLines,
  loadStoreRequirements,
  majorOf,
  minuteOf,
  npmPackArgs,
  oldEnoughAt,
  publishedMinute,
  readRepo,
  recommendedTarget,
  repoFiles,
  repoReleaseAge,
  sdkLinesContractPath,
  xcodeSources,
} from './lib/sdk.mjs';
import { createReporter, fail, makeTempDir, parseArgs, removeTempDir, requireDir, requireFile, run } from './check-lib.mjs';

const SPEC = {
  name: 'check-sdk-trigger',
  summary:
    'Answers whether an Expo SDK or toolchain move is due. PASS (exit 0): no move is due, and each "wait" line says why (the next SDK is not npm "latest" yet, or it, a package the repo uses from its module map, or @react-native/jest-preset or @react-native/eslint-plugin at its React Native version is missing or younger than the repo\'s release age: .npmrc min-release-age, at least 7 days, measured to the minute) with the moment it can change. FAIL [upgrade-due] (exit 1): every trigger condition holds and the app is still on the older SDK; the plan lines say how to move. FAIL [store-deadline]: an App Store (Xcode) or Google Play (targetSdk) requirement in effect is not met. Facts come from npm (--online) or a saved facts file (--facts); without either it exits 2.',
  usage: '[repo-root] (--online | --facts <file>) [options]',
  options: {
    target: { type: 'string', value: 'n', help: "The SDK major to judge (default: the app's SDK + 1, or the SDK Expo says to move to when it says to skip one)" },
    online: { type: 'boolean', help: 'Read dist-tags, publish times and the target module map from npm (network)' },
    facts: { type: 'string', value: 'file', help: 'Use a saved facts file instead of the network (see --save-facts)' },
    'save-facts': { type: 'string', value: 'file', help: 'With --online: also write the facts to this file (evidence for the report)' },
    now: { type: 'string', value: 'ISO time', help: 'The moment of the release-age checks, as npm measures the age at install time, and the day of the store requirements (default: the current time)' },
    xcode: { type: 'string', value: 'version', help: 'The Xcode version builds use (default: the same sources as check-sdk-alignment)' },
    'sdk-lines': { type: 'string', value: 'file', help: "The app's own SDK lines (default: contracts/expo-sdk-lines.json)" },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Outcomes: PASS = no move due (wait reasons: target-stable target-age package-missing package-age);',
    '          FAIL [upgrade-due] = the move is due and not yet done; FAIL [store-deadline] = a store',
    '          requirement in effect is not met; exit 2 = no facts or bad input.',
    'Example: node check-sdk-trigger.mjs . --online --save-facts reports/sdk-trigger.json',
    'Facts file: { "distTags": {...}, "expoTimes": { "<version>": "<iso>" }, "moduleMap": {...},',
    '              "packageTimes": { "<package>": { "<version>": "<iso>" } } }',
    'A target older than npm "latest" is judged on its own "sdk-<n>" dist-tag (one SDK at a time, unless',
    'Expo\'s notes say to skip one: the SDK lines\' "skipFrom"). The release age is the repo .npmrc\'s',
    'min-release-age (the last acceptable line, at least 7 days), measured to the minute.',
  ].join('\n'),
};

const RN_TOOLS = ['@react-native/jest-preset', '@react-native/eslint-plugin'];

function npmJson(args) {
  const result = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) fail(`npm ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim().split('\n')[0]}`, 'Check the network and the package name, or use --facts.');
  return JSON.parse(result.stdout);
}

/**
 * The target expo's bundledNativeModules.json, read from its npm tarball. The pack runs in the
 * temporary folder with the release age off (npmPackArgs): the repo's policy must not hide the very
 * release whose age this check reports.
 */
function fetchModuleMap(version) {
  const dir = makeTempDir('sdk-trigger-');
  try {
    const pack = spawnSync('npm', npmPackArgs(version, dir), { encoding: 'utf8', cwd: dir });
    if (pack.status !== 0) fail(`npm pack expo@${version} failed: ${(pack.stderr || pack.stdout).trim().split('\n')[0]}`, 'Check the network, or use --facts.');
    const tgz = readdirSync(dir).find((name) => name.endsWith('.tgz'));
    const untar = spawnSync('tar', ['-xzf', join(dir, tgz), '-C', dir, 'package/bundledNativeModules.json'], { encoding: 'utf8' });
    if (untar.status !== 0) fail(`could not read bundledNativeModules.json from expo@${version}`, 'Use --facts with the map copied by hand.');
    return JSON.parse(readFileSync(join(dir, 'package', 'bundledNativeModules.json'), 'utf8'));
  } finally {
    removeTempDir(dir);
  }
}

/**
 * The stable expo version of the target SDK, or null while it has none: npm "latest" when it is on
 * the target major; the target's own "sdk-<n>" dist-tag when "latest" has already moved past it.
 */
function targetVersion(distTags, target) {
  const latest = distTags?.latest;
  if (!latest) return null;
  if (majorOf(latest) === target) return latest;
  if (majorOf(latest) > target) return distTags[`sdk-${target}`] ?? null;
  return null;
}

/** Every manifest of the repo: the root, each app, each shared package. */
const manifests = (repo) => [repo.rootManifest, ...repo.apps.filter((app) => app.ws !== '').map((app) => app.manifest), ...repo.shared.map((pkg) => pkg.manifest)];

function usedNames(repo, map) {
  const names = new Set();
  for (const manifest of manifests(repo)) for (const name of Object.keys({ ...depsOf(manifest), ...(manifest?.peerDependencies ?? {}) })) if (name in map) names.add(name);
  for (const core of ['react', 'react-native']) if (core in map) names.add(core);
  return [...names].sort();
}

function onlineFacts(repo, target) {
  const view = npmJson(['view', 'expo', 'dist-tags', 'time', '--json']);
  const facts = { distTags: view['dist-tags'], expoTimes: view.time, moduleMap: null, packageTimes: {} };
  const version = targetVersion(facts.distTags, target);
  if (!version) return facts;
  facts.moduleMap = fetchModuleMap(version);
  const rootDev = depsOf(repo.rootManifest);
  const names = [...usedNames(repo, facts.moduleMap), ...RN_TOOLS.filter((name) => name in rootDev)];
  for (const name of names) facts.packageTimes[name] = npmJson(['view', name, 'time', '--json']);
  return facts;
}

/** Packages to age-check: name -> the version the target SDK installs. */
function wanted(repo, facts) {
  const map = facts.moduleMap ?? {};
  const out = usedNames(repo, map).map((name) => [name, bare(map[name])]);
  const rn = map['react-native'];
  const rootDev = depsOf(repo.rootManifest);
  if (rn) for (const name of RN_TOOLS.filter((tool) => tool in rootDev)) out.push([name, bare(rn)]);
  return out;
}

/**
 * Every unmet trigger condition as { rule, message, until } (until = the first day it can hold, or
 * null when nobody can say). An empty list means the trigger holds.
 */
function waitReasons(repo, facts, context) {
  const { target, version, nowMs, days } = context;
  const at = minuteOf(nowMs);
  const tags = facts.distTags ?? {};
  if (!version) return [{ rule: 'target-stable', message: `SDK ${target} is not stable yet: expo "latest" is ${tags.latest ?? 'unknown'}${tags.next ? ` (next: ${tags.next})` : ''}; betas, previews and "next" releases are never adopted`, until: null }];
  const reasons = [];
  const published = facts.expoTimes?.[version];
  if (!published) reasons.push({ rule: 'target-age', message: `no publish time for expo ${version} (rerun with --online, or add expoTimes to the facts file)`, until: null });
  else if (!isOldEnough(published, nowMs, days)) reasons.push({ rule: 'target-age', message: `expo ${version} was published ${publishedMinute(published)}; it is not ${days} days old at ${at} (never add an exclude for an SDK move)`, until: oldEnoughAt(published, days) });
  if (!facts.moduleMap) reasons.push({ rule: 'package-missing', message: `no module map for expo ${version} (rerun with --online, or add moduleMap, its bundledNativeModules.json, to the facts file)`, until: null });
  for (const [name, want] of facts.moduleMap ? wanted(repo, facts) : []) {
    const time = facts.packageTimes?.[name]?.[want];
    if (!time) reasons.push({ rule: 'package-missing', message: `SDK ${target} expects ${name} ${want}, which npm does not list; an SDK is adopted only when every package it needs is out`, until: null });
    else if (!isOldEnough(time, nowMs, days)) reasons.push({ rule: 'package-age', message: `${name} ${want} was published ${publishedMinute(time)}; it is not ${days} days old at ${at}`, until: oldEnoughAt(time, days) });
  }
  return reasons;
}

function printPlan(repo, facts, context) {
  const { target, version, line, contract } = context;
  const map = facts.moduleMap;
  const rn = bare(map['react-native']);
  const rootDev = depsOf(repo.rootManifest);
  const has = (name) => name in rootDev;
  const tools = [
    ...['jest-expo', 'eslint-config-expo'].filter((name) => has(name) && map[name]).map((name) => `${name}@${bare(map[name])}`),
    ...RN_TOOLS.filter(has).map((name) => `${name}@${rn}`),
    ...(line ? [['@types/react', line.typesReact], ['test-renderer', line.testRenderer]].filter(([name]) => has(name)).map(([name, want]) => `${name}@${want}`) : []),
  ];
  if (line && has('jest') && lineOrder(rootDev.jest, line.jest) !== 0) {
    tools.push(`jest@${line.jest}`);
    if (has('babel-jest')) tools.push(`babel-jest@${majorOf(line.jest)}`);
  }
  if (line && has('@types/jest') && bare(rootDev['@types/jest']) !== line.typesJest) tools.push(`@types/jest@${line.typesJest}`);
  console.log(`plan 1   git switch -c chore/expo-sdk-${target}`);
  if (repo.mode === 'single') console.log(`plan 2   npx expo install expo@~${version} && npx expo install --fix`);
  else for (const app of repo.apps) console.log(`plan 2   (cd ${app.ws} && npx expo install expo@~${version} && npx expo install --fix)`);
  console.log(`plan 3   npm install -D ${tools.join(' ')}   (one command: jest-expo peers on the new @react-native/jest-preset${line && has('jest') && lineOrder(rootDev.jest, line.jest) !== 0 ? ` and Jest ${line.jest}` : ''})`);
  const used = new Set(usedNames(repo, map));
  const peers = repo.shared.flatMap((pkg) => Object.keys(pkg.manifest?.peerDependencies ?? {}));
  const pinned = [...(repo.mode === 'single' ? [] : ['react', 'react-native', ...['react-native-reanimated', 'react-native-worklets'].filter((name) => used.has(name))]), ...peers, ...Object.keys(repo.rootManifest?.overrides ?? {})];
  const overrides = [...new Set(pinned)].filter((name) => map[name]).map((name) => `"${name}": "<installed, at least ${bare(map[name])}>"`);
  if (overrides.length > 0) console.log(`plan 4   set root "overrides": { ${overrides.join(', ')} } to the exact versions step 2 installed (npm ls <name>), then npm install; npx expo-doctor must report no duplicate native modules`);
  else console.log('plan 4   npm ls react react-native must show one version each; npx expo-doctor must report no duplicate native modules (add an override for any duplicate it names)');
  if (!line) console.log(`plan 5   add an "${target}" entry to ${contract} (the shape of assets/sdk-lines.schema.json: React, test-renderer and @types/react lines, Jest line, Gesture Handler major, Xcode, Android levels, removed APIs) before the alignment check`);
  console.log(`plan 6   breaking changes from references/sdk-${target}-changes.md (or the release notes), then node \${CLAUDE_SKILL_DIR}/scripts/check-sdk-alignment.mjs . until RESULT: PASS`);
}

/** "wait" lines and the verdict for a repo that stays: the latest day any reason can clear. */
function printWait(reasons, sdk) {
  for (const reason of reasons) console.log(`wait     [${reason.rule}] ${reason.message}${reason.until ? `; possible from ${reason.until}` : ''}`);
  const open = reasons.some((reason) => reason.until === null);
  const latest = reasons.map((reason) => reason.until).filter(Boolean).sort().at(-1);
  const when = open ? 'check again at the next session start' : `the trigger can hold from ${latest}; check again then`;
  console.log(`verdict  no SDK move due: stay on SDK ${sdk}; ${when}`);
}

/** App Store and Google Play requirements: in effect and unmet -> problem; later -> notice line. */
function checkStoreRequirements(repo, context, report) {
  const { line, sdk, today, xcodeOption } = context;
  const requirements = loadStoreRequirements();
  const files = repoFiles(repo);
  const target = androidTarget(androidPins(repo, files), line);
  const notice = (message) => console.log(`notice   [store-deadline] ${message}`);
  if (!target && (requirements.play ?? []).length > 0) console.log(`notice   [store-deadline] no Android targetSdk known for SDK ${sdk} (no SDK line): Google Play requirements not judged`);
  for (const requirement of target ? requirements.play ?? [] : []) {
    if (target.value >= requirement.targetSdkMin) continue;
    const message = `Android targetSdk ${target.value} (${target.label}) is below ${requirement.targetSdkMin}: from ${requirement.from} Google Play says ${requirement.rule}${requirement.extensionUntil ? ` (an extension can be requested until ${requirement.extensionUntil})` : ''}`;
    const fix = `Ship targetSdk ${requirement.targetSdkMin} or higher: delete a lower targetSdkVersion pin, or move to an SDK whose default meets it; requesting an extension in Play Console is a human step (${requirement.source}).`;
    if (requirement.from <= today) report.problem({ file: target.file, line: target.line, rule: 'store-deadline', message, fix });
    else notice(`${message}; plan the move before ${requirement.from}`);
  }
  const { sources } = xcodeSources(repo, files, xcodeOption);
  for (const requirement of requirements.appStore ?? []) {
    for (const source of sources) {
      if (compareVersions(source.version, requirement.xcodeMin) >= 0) continue;
      const message = `Xcode ${source.version} (${source.label}) is below ${requirement.xcodeMin}: from ${requirement.from} Apple says ${requirement.rule}`;
      const fix = `Build with Xcode ${requirement.xcodeMin} or newer, selected by version (DEVELOPER_DIR locally, an EAS image name on EAS), in its own commit; a newer Xcode major may need scene support first (references/toolchain.md). Installing Xcode is a human step (${requirement.source}).`;
      if (requirement.from <= today) report.problem({ file: source.file, line: source.line, rule: 'store-deadline', message, fix });
      else notice(`${message}; plan the move before ${requirement.from}`);
    }
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const rootArg = positionals[0] ?? '.';
  if (!options.online && !options.facts) fail('no facts to judge: pass --online (reads npm) or --facts <file> (a facts file saved with --online --save-facts)', 'Run: node check-sdk-trigger.mjs . --online --save-facts reports/sdk-trigger.json');
  const root = requireDir(rootArg, 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${rootArg} has no package.json`, 'Run it from the app repo root, or pass the root folder.');
  const repo = readRepo(root);
  if (!repo.rootManifest) fail(`package.json in ${rootArg} is not valid JSON`, 'Fix the JSON, then rerun.');
  const report = createReporter({ name: 'check-sdk-trigger', json: options.json });
  const sdk = appsSdk(repo);
  if (sdk === null) return report.notApplicable(repo.mode === 'single' ? 'expo is not a dependency in package.json' : 'no workspace in package.json "workspaces" depends on expo');
  const { lines } = loadSdkLines(root, repo.layout, options['sdk-lines']);
  const contract = sdkLinesContractPath(repo.layout, options['sdk-lines']);
  const recommended = recommendedTarget(sdk, lines);
  const target = options.target === undefined ? recommended.target : Number(options.target);
  if (!(Number.isInteger(target) && target > sdk)) fail(`the app is already on SDK ${sdk}; --target ${options.target} is not later`, `Pass --target ${recommended.target} for the next move, or leave --target out.`);
  const nowMs = options.now === undefined ? Date.now() : Date.parse(options.now);
  if (Number.isNaN(nowMs)) fail(`--now "${options.now}" is not an ISO time`, 'Pass a time such as 2026-11-02T12:00:00Z.');
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const age = repoReleaseAge(root);
  const facts = options.facts ? JSON.parse(readFileSync(requireFile(options.facts, 'facts file'), 'utf8')) : onlineFacts(repo, target);
  if (options.online && options['save-facts']) {
    // reports/ is git-ignored and may not exist yet in a fresh clone.
    mkdirSync(dirname(options['save-facts']), { recursive: true });
    writeFileSync(options['save-facts'], `${JSON.stringify(facts, null, 2)}\n`);
  }
  const tags = facts.distTags ?? {};
  // A verdict needs npm's "latest": without it "no move due" would be a guess.
  if (!tags.latest) fail('the facts hold no expo "latest" dist-tag', 'Rerun with --online, or save the facts with --online --save-facts <file>.');
  const problemFile = repo.apps[0].file;
  const version = targetVersion(tags, target);
  const who = repo.mode === 'single' ? 'app' : `${repo.apps.length} apps`;
  console.log(`sdk      ${who} on Expo SDK ${sdk}; target SDK ${target}${version && version !== tags.latest ? ` (expo ${version}, dist-tag sdk-${target})` : ''}; npm latest ${tags.latest}${tags.next ? `, next ${tags.next}` : ''}`);
  if (options.target === undefined && recommended.skipped.length > 0) console.log(`note     SDK ${target} is the next move from SDK ${sdk}, skipping SDK ${recommended.skipped.join(', ')}${recommended.line?.advisory ? `: ${recommended.line.advisory}` : ''}`);
  else if (options.target !== undefined && recommended.target !== sdk + 1 && target < recommended.target) console.log(`note     --target ${target}: this skill's SDK lines move SDK ${sdk} apps straight to SDK ${recommended.target}${recommended.line?.advisory ? ` (${recommended.line.advisory})` : ''}`);
  console.log(`age      ${age.days} days (${age.source}), measured at ${minuteOf(nowMs)}`);
  const checks = version && facts.moduleMap ? wanted(repo, facts) : [];
  for (const [name, want] of checks) console.log(`package  ${name} ${want}${facts.packageTimes?.[name]?.[want] ? ` (published ${facts.packageTimes[name][want].slice(0, 10)})` : ''}`);
  const storeContext = { line: lines[String(sdk)] ?? null, sdk, today, xcodeOption: options.xcode };
  if (!version && majorOf(tags.latest) > target) {
    report.problem({ file: problemFile, line: 0, rule: 'upgrade-due', message: `expo "latest" is ${tags.latest}, past SDK ${target}, and the facts hold no "sdk-${target}" dist-tag: the app on SDK ${sdk} is overdue for a move`, fix: `Rerun with --online (npm keeps an "sdk-${target}" tag for every SDK), then move one SDK at a time (or to the SDK Expo's notes name when they say to skip one).` });
    checkStoreRequirements(repo, storeContext, report);
    return report.finish({ checked: 1, unit: 'trigger conditions and packages' });
  }
  const reasons = waitReasons(repo, facts, { target, version, nowMs, days: age.days });
  if (reasons.length > 0) {
    printWait(reasons, sdk);
  } else {
    report.problem({ file: problemFile, line: 0, rule: 'upgrade-due', message: `SDK ${target} (expo ${version}) meets the trigger and the ${who} ${repo.mode === 'single' ? 'is' : 'are'} still on SDK ${sdk}: the move is due and not yet done`, fix: 'Tell the developer (message 2 of examples/sdk-move-report.md), then follow the plan lines on a branch (references/runbook.md). The move is done when check-sdk-alignment.mjs prints RESULT: PASS and this check prints RESULT: PASS again.' });
    console.log(`trigger  met: expo ${version} is stable and at least ${age.days} days old, and so is every package the repo takes from its module map`);
    printPlan(repo, facts, { target, version, line: lines[String(target)] ?? null, contract });
  }
  checkStoreRequirements(repo, storeContext, report);
  return report.finish({ checked: 2 + checks.length, unit: 'trigger conditions and packages' });
});
