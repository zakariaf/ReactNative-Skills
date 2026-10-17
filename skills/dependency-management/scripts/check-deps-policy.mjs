#!/usr/bin/env node
// check-deps-policy.mjs: checks every package.json, the lockfile and .npmrc of an Expo app repo
// against its dependency policy (contracts/dependency-policy.json): table versions and specifiers,
// exact pins, Expo specifiers, held-back majors, do-not-add and banned packages, one copy of
// everything (overrides, companions, one React), deprecated packages, the .npmrc policy (release age
// and dated excludes, engine-strict with package.json engines, strict install scripts, no line that
// switches a guard off), NPM_CONFIG_* variables in eas.json and CI workflows (they beat the
// project .npmrc) and EAS_NO_FROZEN_LOCKFILE in eas.json (EAS then runs npm install instead of
// npm ci), committed npx calls that would install a package the policy keeps out (EAS CLI in the
// seed), policy rows inside the Expo module map, a lockfile in sync, reviewed install
// scripts approved by pinned keys, and native modules that some code uses. When
// multi-package it also checks workspace peers, every app's native peers and one specifier per
// package across workspaces.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-deps-policy.mjs .

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ENGINE_FLOORS, ENGINE_RANGES, EXACT_VERSION, MODULE_MAP_SOURCE, NPMRC_POLICY, RELEASE_AGE_MIN_DAYS, bareVersion, banFix, describePlace, effectiveBans, entriesOf, installed, isAppRow, isDevRow, loadBanLists, lockName, manifestFile, missingBans, moduleMapFor, npmConfigFinding, npmEnvKey, npmrcExcludeProblems, npmrcForbidden, npmrcPolicyMissing, npmrcPolicyOverrides, npxCalls, parseAllowScriptsKey, placeOf, placesOf, policyPath, rangeAdmitsBelow, readPolicy, readRepo, releaseAgeDays, repoSdk, resolveOverride, specAccepts, todayUtc, yamlRunLines } from './lib/policy.mjs';
import { createReporter, fail, notYetCreated, parseArgs, parseJsonc, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';

const SPEC = {
  name: 'check-deps-policy',
  summary: 'Checks the dependencies of an Expo app repo against its dependency policy (contracts/dependency-policy.json): every direct dependency is a table row at its specifier and in the right place, pins are exact (or the specifier npx expo install writes), no held-back major, no do-not-add, banned or unaccepted deprecated package, one copy of everything, the .npmrc policy (release age with dated excludes, engine-strict with package.json engines, exact saves, strict install scripts, no line that switches a guard off), no NPM_CONFIG_* variable in eas.json or a GitHub workflow that weakens it and no EAS_NO_FROZEN_LOCKFILE in eas.json, no committed npx call (package.json scripts, workflows, lefthook) that installs a package the policy keeps out, a lockfile in sync, install scripts reviewed and approved by pinned keys, and no native module that no code uses. With npm workspaces it also checks workspace peers, native peers in every app and one specifier per package.',
  usage: '[repo-root] [options]',
  options: {
    policy: { type: 'string', value: 'file', help: 'The dependency policy, repo-relative (default: rn-skills.config.json "dependencyPolicy", else <contractsDir>/dependency-policy.json)' },
    today: { type: 'string', value: 'YYYY-MM-DD', help: 'Date for the exclude-block checks: expired, and no later than today + the release age (default: today, UTC)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: policy-contract npmrc-policy npmrc-exclude engines pin-exact expo-spec table-sdk table-map',
    '  table-version not-in-table wrong-workspace held-back do-not-add banned deprecated overrides',
    '  stale-override companion lockfile-missing lockfile-sync install-scripts unpinned-approval',
    '  stale-approval one-react one-version license-exceptions unused-dependency npm-env npx-install',
    '  When multi-package (package.json "workspaces"): every-app lockstep workspace-peer peer-override',
    '',
    'SKIP: src [unused-dependency] not yet created (expo-project-bootstrap creates it), while the app has no source folder.',
    'Example: node check-deps-policy.mjs .      (from the app repo root)',
  ].join('\n'),
};

/** Why the spec is passed explicitly, and what a same-day Expo patch is. */
const SAME_DAY_PATCH = 'Pass the spec: a plain npx expo install writes what Expo\'s online versions list names today, which can be a patch published that day. Such a patch is a WARN with its due date in scripts/deps/check-deps.ts, and it moves on that date through the upgrade procedure (references/procedures.md).';
const ONE_REACT = ['react', 'react-native'];

/** The one command that writes an Expo-managed specifier: the table's spec, given explicitly. */
const expoInstall = (repo, ws, name, spec) => (repo.mode === 'single' ? `npx expo install ${name}@${spec}` : `(cd ${ws} && npx expo install ${name}@${spec})`);
const npmTarget = (repo, ws) => (ws === '' ? '' : ` -w ${ws}`);

/** 1-based line of a dependency key inside its section of a manifest text (1 when not found). */
function lineOfDep(text, section, name) {
  if (!text) return 1;
  const start = text.indexOf(`"${section}"`);
  const at = text.indexOf(`"${name}"`, start < 0 ? 0 : start);
  return at < 0 ? 1 : text.slice(0, at).split('\n').length;
}

/** 1-based line of the first occurrence of a JSON key in a text (1 when not found). */
function lineOfKey(text, key) {
  const at = text ? text.indexOf(`"${key}"`) : -1;
  return at < 0 ? 1 : text.slice(0, at).split('\n').length;
}

function checkPolicyContract(ctx, read, banLists) {
  const { add, policyRel } = ctx;
  if (!read.exists) return add(policyRel, 0, 'policy-contract', 'is missing: the versions table, held-back majors, do-not-add list, bans and licence policy of this app live there', `Copy templates/contracts/dependency-policy.json of the dependency-management skill to ${policyRel}, delete the rows the app will never use, and commit it.`);
  for (const error of read.errors) {
    // An unknown key names its own line ("packages.x.implicituse is not a key ..."); other shape problems point at the file.
    const unknown = /^(?:\S*\.)?([^.\s]+) is not a key of the contract/.exec(error);
    add(policyRel, unknown ? lineOfKey(ctx.policyText, unknown[1]) : 1, 'policy-contract', error, 'Fix the entry; references/policy-contract.md describes every key.');
  }
  if (!read.policy) return;
  const text = ctx.policyText;
  for (const profile of read.policy.profiles) {
    if (!banLists.profiles[profile]) add(policyRel, lineOfKey(text, 'profiles'), 'policy-contract', `profile "${profile}" is unknown (known: ${Object.keys(banLists.profiles).join(', ')})`, 'Use a known profile name, or remove it and list the app\'s own bans in "banned".');
  }
  for (const { entry, from } of missingBans(read.policy, banLists)) {
    const { regex, ...plain } = entry;
    add(policyRel, lineOfKey(text, 'banned'), 'policy-contract', `"banned" lacks ${entry.pattern} (${from})`, `Add ${JSON.stringify(plain)} to "banned": the app's own gate (scripts/deps/check-deps.ts) reads only this file.`);
  }
}

/** Why each policy line is there, for the message of a missing one. */
const NPMRC_WHY = {
  'min-release-age': 'a release younger than this many days never resolves, so most malicious or broken releases are pulled before the app adopts them',
  'engine-strict': 'npm refuses to run when package.json "engines" says it is too old (npm 10 ignores the release age and allowScripts)',
  'save-exact': 'every npm install writes an exact version',
  'strict-allow-scripts': 'without it npm 11.17 runs an install script nobody reviewed and only prints a notice afterwards; with it the install stops before anything runs (ESTRICTALLOWSCRIPTS)',
};

/** One finding per exclude-block problem, with the fix computed from the .npmrc release age. */
function excludeFinding(hit, days) {
  const header = `"# exclude-block expires=<publish date + ${days} days, the .npmrc min-release-age> reason=<link or changelog line>"`;
  switch (hit.kind) {
    case 'expired': return [`exclude ${hit.pattern} sits in a block that expired on ${hit.expires}`, 'Delete the whole block (never extend it); locked versions stay installed.'];
    case 'bad-header': return ['exclude-block header must read "# exclude-block expires=YYYY-MM-DD reason=<why>"', `Write the header as ${header}.`];
    case 'outlives': return [`exclude block expires ${hit.expires}, after ${hit.limit} (today + the ${days}-day release age): a block can never outlive its release by more than the release age; it was extended or invented`, `Set expires= to the publish date of the youngest release it covers + ${days} days (plan-dependency.mjs <pkg>@<version> . --online prints it), or delete the block when that date has passed.`];
    case 'catch-all': return [`exclude ${hit.pattern} matches every ${hit.pattern.includes('/') ? 'scoped ' : ''}package, so it switches the release age off for the whole tree`, 'Name the exact packages the needed release brings, as few as possible (prove each necessary by removing it and resolving again).'];
    default: return [`exclude ${hit.pattern} is not inside a dated exclude block`, `Put excludes under ${header}.`];
  }
}

function checkNpmrc(ctx) {
  const { repo, add, today } = ctx;
  if (repo.npmrc === null) return add('.npmrc', 0, 'npmrc-policy', 'is missing', `Restore the root .npmrc (min-release-age=${RELEASE_AGE_MIN_DAYS}, engine-strict=true, save-exact=true, strict-allow-scripts=true); templates/dot-npmrc holds it.`);
  const overrides = npmrcPolicyOverrides(repo.npmrc);
  const policyLine = (key) => (key === 'min-release-age' ? `min-release-age=${RELEASE_AGE_MIN_DAYS} or higher` : `${key}=${NPMRC_POLICY[key]}`);
  for (const key of npmrcPolicyMissing(repo.npmrc).filter((item) => !overrides.some((hit) => hit.key === item))) {
    add('.npmrc', 1, 'npmrc-policy', `lacks the line ${policyLine(key)}: ${NPMRC_WHY[key]}`, 'Restore the policy line (templates/dot-npmrc), with a Gate-Change trailer in the commit.');
  }
  for (const hit of overrides) {
    add('.npmrc', hit.line, 'npmrc-policy', `sets ${hit.key}=${hit.value}, outside the policy (${policyLine(hit.key)}); npm keeps the last value of a key, so this line switches the policy off`, `Make it ${policyLine(hit.key)}, or delete it when an earlier line already holds the policy (a young release needs a dated exclude block instead).`);
  }
  for (const hit of npmrcForbidden(repo.npmrc)) {
    add('.npmrc', hit.line, 'npmrc-policy', `sets ${hit.key}${hit.value === 'true' ? '' : `=${hit.value}`}: ${hit.why}`, `Delete the line. ${hit.key === 'allow-scripts' ? 'Approve a reviewed package in the root package.json allowScripts ("<name>@<x.y.z>": true).' : hit.key === 'dangerously-allow-all-scripts' ? 'Review each script and approve it in allowScripts instead.' : hit.key === 'before' ? 'A needed young release goes into a dated exclude block.' : hit.key === 'package-lock' ? 'Commit package-lock.json and keep package-lock=true (the default); install fresh clones and CI with npm ci.' : 'On ERESOLVE, go back to the policy row: the request is off the SDK set.'}`);
  }
  const days = releaseAgeDays(repo.npmrc);
  for (const hit of npmrcExcludeProblems(repo.npmrc, today)) {
    const [message, fix] = excludeFinding(hit, days);
    add('.npmrc', hit.line, 'npmrc-exclude', message, fix);
  }
}

/** 1-based line of an env key inside build.<profile> of an eas.json text (1 when not found). */
function lineOfEasEnv(text, profile, name) {
  const build = text.indexOf('"build"');
  const at = text.indexOf(`"${profile}"`, Math.max(build, 0));
  const key = text.indexOf(`"${name}"`, Math.max(at, 0));
  return key < 0 ? 1 : text.slice(0, key).split('\n').length;
}

/** The EAS Build variable that turns its frozen-lockfile install (npm ci) into npm install. */
const EAS_NO_FROZEN_LOCKFILE = 'EAS_NO_FROZEN_LOCKFILE';

/** A GitHub workflow line that sets an npm_config_* variable ("KEY: value", "KEY=value", "export KEY=value"). */
const WORKFLOW_NPM_ENV = /\b(npm_config_[A-Za-z0-9_]+)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s#'"]*))/gi;

/**
 * npm reads its config in this order of precedence: command line, then NPM_CONFIG_* environment
 * variables, then the project .npmrc, then ~/.npmrc. So a variable in eas.json build.<profile>.env
 * (EAS Build runs its install with it) or in a GitHub workflow beats the project policy: verified
 * on npm 11.17 for NPM_CONFIG_LEGACY_PEER_DEPS, NPM_CONFIG_STRICT_ALLOW_SCRIPTS, NPM_CONFIG_PACKAGE_LOCK,
 * npm_config_before and npm_config_min_release_age. Every variable that weakens a policy key, sets a
 * forbidden key or an exclude is a finding. Inherited env ("extends") was reported at its profile.
 * EAS Build installs with `npm ci --include=dev` (a frozen lockfile) for SDK 53 and newer, and with
 * `npm install --include=dev` when EAS_NO_FROZEN_LOCKFILE holds any non-empty value
 * (shouldUseFrozenLockfile in @expo/build-tools 24.9.0, read 2026-10-03), so that variable in
 * eas.json is a finding too. EAS environment variables stored on expo.dev and ~/.npmrc are outside
 * the repo: the app's gate checks the effective npm config (scripts/deps/check-npm-config.ts).
 */
function checkNpmEnv(ctx) {
  const { repo, add } = ctx;
  const easInstall = 'the install EAS Build runs (npm ci, or npm install under EAS_NO_FROZEN_LOCKFILE)';
  const fix = (name, kind) => `Delete ${name}${kind === 'exclude' ? '; a needed young release goes into a dated exclude block of the project .npmrc' : kind === 'policy' ? ' (the project .npmrc holds the policy)' : npmEnvKey(name) === 'allow-scripts' ? ' (with it npm ci itself stops with EALLOWSCRIPTS); reviewed approvals go in the root package.json allowScripts, and a one-off tool runs outside npx (EAS CLI from a global install)' : '; on ERESOLVE go back to the policy row'}. Never set NPM_CONFIG_* policy keys in eas.json, a CI workflow or EAS environment variables.`;
  // eas.json sits at the root of a single app, and in each Expo app folder when multi-package.
  for (const rel of ['eas.json', ...repo.apps.filter(Boolean).map((app) => `${app}/eas.json`)]) {
    if (!existsSync(join(repo.root, rel))) continue;
    const text = readFileSync(join(repo.root, rel), 'utf8');
    let eas = null;
    try {
      eas = parseJsonc(text);
    } catch (error) {
      add(rel, 1, 'npm-env', `cannot be read as JSON (${String(error.message).split('\n')[0]}), so its build env cannot be checked for NPM_CONFIG_* variables`, 'Write eas.json as JSON (comments and trailing commas are fine); EAS reads JSON too.');
    }
    for (const [profile, config] of Object.entries(eas?.build ?? {})) {
      for (const [name, value] of Object.entries(config?.env ?? {})) {
        if (name === EAS_NO_FROZEN_LOCKFILE && String(value ?? '') !== '') {
          add(rel, lineOfEasEnv(text, profile, name), 'npm-env', `build.${profile}.env sets ${name}=${String(value)}: EAS Build then installs with npm install instead of npm ci (any non-empty value, even "0"), so whatever package.json asks for and package-lock.json lacks is resolved on the worker, outside the reviewed lockfile, instead of failing the build, and package-lock=false from any layer drops the lockfile altogether`, `Delete ${name}. When the build fails in "Install dependencies" with npm error code EUSAGE (package.json and package-lock.json not in sync), run npm install locally and commit package.json and package-lock.json together. Never set it in eas.json or EAS environment variables.`);
          continue;
        }
        const key = npmEnvKey(name);
        const finding = key === null ? null : npmConfigFinding(key, String(value));
        if (finding) add(rel, lineOfEasEnv(text, profile, name), 'npm-env', `build.${profile}.env sets ${name}: ${finding.text}; an NPM_CONFIG_* variable beats the project .npmrc in ${easInstall}`, fix(name, finding.kind));
      }
    }
  }
  const workflows = join(repo.root, '.github', 'workflows');
  if (!existsSync(workflows)) return;
  for (const file of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name)).sort()) {
    const rel = `.github/workflows/${file}`;
    readFileSync(join(workflows, file), 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (/^\s*#/.test(line)) return;
      for (const match of line.matchAll(WORKFLOW_NPM_ENV)) {
        const key = npmEnvKey(match[1]);
        const finding = npmConfigFinding(key, match[2] ?? match[3] ?? match[4] ?? '');
        if (finding) add(rel, index + 1, 'npm-env', `sets ${match[1]}: ${finding.text}; an NPM_CONFIG_* variable beats the project .npmrc for every npm command of the job`, fix(match[1], finding.kind));
      }
    });
  }
}

/** Where a repo keeps command lines npm may run: GitHub workflows and the git-hook file (package.json scripts are read per workspace). */
const LEFTHOOK_FILES = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml'];

/** The global install that replaces npx eas-cli inside the repo (the supply-chain reference, "npx and one-off tools"). */
const EAS_GLOBAL = 'npm install -g --min-release-age=7 --ignore-scripts eas-cli@<x.y.z> (the newest release at least 7 days old, after reading the install scripts a --strict-allow-scripts run lists), then call eas';

/**
 * npx and `npm exec` run inside the repo read the project .npmrc (the release age and
 * strict-allow-scripts apply), but npm 11.17 skips the root package.json allowScripts for them
 * (resolve-allow-scripts.js, skipProjectConfig) and installs into the npx cache, outside the
 * lockfile. So a committed command (a package.json script, a GitHub workflow step, a lefthook
 * command) that makes npx install EAS CLI is a finding whatever the policy says: `npx eas-cli`
 * stops with ESTRICTALLOWSCRIPTS on a fresh runner (its tree holds dtrace-provider and protobufjs
 * install scripts; verified 2026-10-03), and a warm npx cache hides that on the machine that wrote
 * it. So is `npx eas` without a local eas bin (npm's unrelated "eas" package), and an npx install of
 * a package the policy keeps out (doNotAdd) or bans. A package npx finds in the local tree (a
 * dependency, a hoisted package or one of their bins) installs nothing and is fine. Whether another
 * tool's tree holds an install script cannot be known offline, so other npx calls pass.
 */
function checkNpxInstalls(ctx) {
  const { repo, policy, bans, add } = ctx;
  const packages = repo.lockfile?.packages ?? {};
  const local = new Set([...repo.workspaceNames, ...[...repo.manifests.values()].flatMap((m) => Object.keys(installed(m)))]);
  const bins = new Set();
  const lockVersions = new Map();
  for (const [path, entry] of Object.entries(packages)) {
    if (path.split('node_modules/').length !== 2) continue;
    const name = lockName(path);
    local.add(name);
    lockVersions.set(name, new Set([...(lockVersions.get(name) ?? []), entry.version]));
    for (const bin of Object.keys(entry.bin ?? {})) bins.add(bin);
  }
  const isLocal = (call, spec) => (!call.viaPackageFlag && spec.version === null && bins.has(spec.name)) || (local.has(spec.name) && (spec.version === null || lockVersions.get(spec.name)?.has(spec.version) === true));
  const sources = [];
  for (const [ws, manifest] of repo.manifests) {
    for (const [script, command] of Object.entries(manifest.scripts ?? {})) if (typeof command === 'string') sources.push({ file: manifestFile(ws), line: lineOfDep(repo.texts.get(ws), 'scripts', script), command });
  }
  const workflows = join(repo.root, '.github', 'workflows');
  const yamlFiles = [...(existsSync(workflows) ? readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name)).sort().map((name) => `.github/workflows/${name}`) : []), ...LEFTHOOK_FILES.filter((name) => existsSync(join(repo.root, name)))];
  for (const rel of yamlFiles) for (const { line, command } of yamlRunLines(readFileSync(join(repo.root, rel), 'utf8'))) sources.push({ file: rel, line, command });
  const where = 'into its own cache, where the project .npmrc applies (the release age, strict-allow-scripts) but the root package.json allowScripts and the lockfile do not';
  for (const { file, line, command } of sources) {
    for (const call of npxCalls(command)) {
      for (const spec of call.packages) {
        if (isLocal(call, spec)) continue;
        const shown = command.length > 80 ? `${command.slice(0, 77)}...` : command;
        if (spec.name === 'eas' && !call.viaPackageFlag) {
          add(file, line, 'npx-install', `"${shown}" makes npx install npm's "eas" package, an unrelated templating library, not EAS CLI (its command is eas, its package eas-cli)`, `Install EAS CLI globally: ${EAS_GLOBAL}.`);
          continue;
        }
        if (spec.name === 'eas-cli') {
          add(file, line, 'npx-install', `"${shown}" makes npx install eas-cli ${where}: EAS CLI's tree holds install scripts (dtrace-provider and protobufjs, verified 2026-10-03), so the call stops with ESTRICTALLOWSCRIPTS on a fresh runner while a warm npx cache hides it, and expo-doctor refuses eas-cli as a dependency`, `Install EAS CLI globally instead: ${EAS_GLOBAL}.`);
          continue;
        }
        const reason = policy?.doNotAdd?.[spec.name];
        const ban = bans.find((entry) => entry.regex.test(spec.name));
        if (reason) add(file, line, 'npx-install', `"${shown}" makes npx install ${spec.name}, a package the policy keeps out of the repo (doNotAdd), ${where}`, `Follow the policy's reason for ${spec.name} instead of npx: ${reason}.`);
        else if (ban) add(file, line, 'npx-install', `"${shown}" makes npx install ${spec.name}, which is banned: ${ban.reason}`, `Remove the call.${banFix(ban)}`);
      }
    }
  }
}

/**
 * engine-strict=true guards nothing without "engines" in the root package.json: npm checks the
 * root project's engines only when they are declared. The ranges must keep out every npm before
 * 11.17.0 (npm below it ignores the dated exclude blocks; npm 10, the EAS default, also ignores the
 * release age and allowScripts and runs every install script) and every Node before 22.18 (the gate
 * scripts run by type stripping).
 */
function checkEngines(ctx) {
  const { repo, add } = ctx;
  const root = repo.manifests.get('');
  if (!root) return;
  const text = repo.texts.get('');
  for (const [tool, floor] of Object.entries(ENGINE_FLOORS)) {
    const range = root.engines?.[tool];
    if (typeof range === 'string' && !rangeAdmitsBelow(range, floor)) continue;
    const where = range === undefined ? lineOfKey(text, 'engines') : lineOfDep(text, 'engines', tool);
    const message = range === undefined ? `has no "engines.${tool}", so engine-strict=true lets any ${tool} run the install` : `"engines.${tool}" is "${range}", which admits ${tool} below ${floor}`;
    const why = tool === 'npm' ? 'npm below 11.17.0 ignores the dated exclude blocks, and npm 10 also ignores the release age and allowScripts and runs every install script' : 'the gate scripts run by Node type stripping from 22.18';
    add('package.json', where, 'engines', `${message} (${why})`, `Set "engines": { "${tool}": "${ENGINE_RANGES[tool]}" } in the root package.json (with engine-strict=true in .npmrc); on EAS, set build.<profile>.node in eas.json to a Node that ships npm 11.17 or newer.`);
  }
}

function checkTableSdk(ctx) {
  const { repo, policy, add } = ctx;
  const sdk = repoSdk(repo);
  if (!policy || sdk === null || sdk === policy.sdk) return;
  const app = repo.apps.find((ws) => repo.manifests.get(ws)?.dependencies?.expo) ?? '';
  add(manifestFile(app), lineOfDep(repo.texts.get(app), 'dependencies', 'expo'), 'table-sdk', `the app is on Expo SDK ${sdk} but the dependency policy is for SDK ${policy.sdk}`, 'Finish the expo-sdk-upgrade runbook: move the policy rows (and "sdk") in the same commit as the SDK move.');
}

/**
 * Every policy row of a package in the SDK's module map pins a version the map's specifier accepts
 * (an exact map specifier must be equal). npx expo install --check verifies only the packages of the
 * app it runs in, so a stale row for a root dev tool (jest-expo, eslint-config-expo when
 * multi-package), with a root pin to match, would otherwise pass every check after an SDK move.
 */
function checkTableMap(ctx) {
  const { policy, map, add, mapSource, sameSdk } = ctx;
  if (!policy || !sameSdk) return;
  for (const [name, row] of Object.entries(policy.packages)) {
    const mapSpec = map[name];
    if (typeof mapSpec !== 'string' || !/^[~^]?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(mapSpec) || specAccepts(mapSpec, row.version)) continue;
    add(ctx.policyRel, lineOfKey(ctx.policyText, name), 'table-map', `the policy pins ${name} ${row.version}, outside "${mapSpec}", the specifier of the SDK ${policy.sdk} module map (${mapSource})`, `Move the row, and the package with it, to a version that "${mapSpec}" accepts (${row.install === 'expo' ? `npx expo install ${name}@${mapSpec}` : `npm install${isDevRow(row) ? ' -D' : ''} ${name}@${bareVersion(mapSpec)}, or a newer version inside the range, pinned exactly`}), in one commit.`);
  }
}

/** One direct dependency against the policy, the module map and the ban lists. */
function checkDependency(ctx, ws, section, name, spec) {
  const { repo, policy, map, bans, sameSdk, add } = ctx;
  const file = manifestFile(ws);
  const line = lineOfDep(repo.texts.get(ws), section, name);
  const report = (rule, message, fix) => add(file, line, rule, message, fix);
  if (repo.workspaceNames.has(name)) {
    if (spec !== '*') report('pin-exact', `${name} is "${spec}"; workspace packages are linked with "*"`, 'Use "*".');
    return;
  }
  const row = policy?.packages[name];
  const mapSpec = map?.[name];
  const runtime = repo.apps.includes(ws) && section !== 'devDependencies';
  const doNotAdd = policy?.doNotAdd[name];
  if (doNotAdd) report('do-not-add', `${name}: ${doNotAdd}`, `Remove it: npm uninstall ${name}${npmTarget(repo, ws)}.`);
  const ban = bans.find((entry) => entry.regex.test(name));
  if (ban) report('banned', `${name} is banned: ${ban.reason}`, `Remove it (npm uninstall ${name}${npmTarget(repo, ws)}) with its imports and plugin entries.${banFix(ban)}`);
  // npx expo install <pkg>@<table spec> writes the module map's specifier, and "~x.y.z" for expo itself.
  const expoManaged = runtime && ((mapSpec !== undefined && spec === mapSpec) || (name === 'expo' && /^~\d+\.\d+\.\d+$/.test(spec)));
  // An Expo-managed package with another specifier is expo-spec's finding (one line, the right command).
  const expoSpecCase = runtime && mapSpec !== undefined && name !== 'expo' && sameSdk;
  if (!EXACT_VERSION.test(spec) && !expoManaged && !expoSpecCase && !(row && spec === row.spec)) report('pin-exact', `${name} is "${spec}", not an exact version`, row?.install === 'expo' && runtime ? `Run ${expoInstall(repo, ws, name, row.spec)} (it writes "${row.spec}").` : `Pin it exactly: npm install ${name}@${bareVersion(spec)}${section === 'devDependencies' ? ' -D' : ''}${npmTarget(repo, ws)} (.npmrc has save-exact=true).`);
  if (expoSpecCase && spec !== mapSpec) report('expo-spec', `${name} is "${spec}", not "${mapSpec}", the specifier of this SDK's module map`, `Run ${expoInstall(repo, ws, name, row?.spec ?? mapSpec)} and keep what it writes. ${SAME_DAY_PATCH}`);
  if (!policy) return;
  const held = policy.heldBack.find((entry) => entry.package === name);
  if (held && !new RegExp(held.allowed).test(bareVersion(spec))) report('held-back', `${name} ${spec} is past a held-back major`, `Stay on the pinned line until: ${held.trigger}.`);
  if (!row) {
    if (!ban && !doNotAdd) report('not-in-table', `${name} is not in the dependency policy`, 'A new dependency needs the developer\'s approval and a row in the policy (version at least 7 days old, allowed licence, reviewed install script); see references/procedures.md.');
    return;
  }
  if (sameSdk && spec !== row.spec) report('table-version', `${name} is "${spec}" but the policy pins "${row.spec}"`, `${runtime && row.install === 'expo' ? `Run ${expoInstall(repo, ws, name, row.spec)}` : `Use "${row.spec}"`}, or finish the upgrade procedure and change the row in the same commit.`);
  const place = placeOf(repo, ws, section);
  if (!placesOf(row).includes(place)) report('wrong-workspace', `${name} belongs in ${describePlace(repo, row.where)}, not in ${describePlace(repo, place)}`, `Uninstall it there and install it where the row says (${row.install === 'expo' ? `npx expo install ${name}@${row.spec}` : `npm install ${name}@${row.version}${isDevRow(row) ? ' -D' : ''}`}${repo.mode === 'single' ? '' : ' in the right workspace'})${repo.shared.includes(ws) && !row.native && row.install === 'npm' ? `, or, when the code of ${ws} imports it, add "${ws}" to the row's "where" list` : ''}.`);
}

function checkManifests(ctx) {
  for (const [ws, manifest] of ctx.repo.manifests) for (const [section, name, spec] of entriesOf(manifest)) checkDependency(ctx, ws, section, name, spec);
}

/** Native table rows a shared workspace's own code imports. */
function importedNativeRows(ctx, ws) {
  const { policy } = ctx;
  const texts = walkRepo(join(ctx.repo.root, ws), { include: CODE_FILES, ignore: NOT_CODE }).map((rel) => readFileSync(join(ctx.repo.root, ws, rel), 'utf8')).join('\n');
  return Object.entries(policy.packages).filter(([name, row]) => row.native && !ONE_REACT.includes(name) && usesPackage(texts, name)).map(([name]) => name);
}

/**
 * When multi-package: a shared workspace never depends on a native module; it lists the ones its
 * code imports as "*" peers, every app that depends on it installs them, and one specifier per
 * package holds across the root and every workspace. Since SDK 54 autolinking does find a native
 * module that arrives through a shared package (it resolves dependencies and peers recursively),
 * but npx expo install --check and expo-doctor verify only an app's direct dependencies: such a copy
 * escapes the SDK alignment check and resolves on its own range, and only one copy of a native module
 * can be compiled into an app build (Expo's monorepo guide).
 */
function checkWorkspaces(ctx) {
  const { repo, policy, add } = ctx;
  if (repo.mode !== 'monorepo' || !policy) return;
  for (const ws of repo.shared) {
    const manifest = repo.manifests.get(ws);
    const peers = manifest.peerDependencies ?? {};
    for (const [section, name] of entriesOf(manifest)) {
      if (policy.packages[name]?.native && section !== 'devDependencies') add(manifestFile(ws), lineOfDep(repo.texts.get(ws), section, name), 'workspace-peer', `${name} is a native module in ${section} of a shared package; npx expo install --check and expo-doctor verify only an app's direct dependencies, so a copy that arrives through ${manifest.name || ws} escapes the SDK alignment check, and only one copy of a native module can be compiled into an app`, `Move it to peerDependencies as "*" (with its root override) and install it in every app that depends on ${manifest.name || ws}.`);
    }
    for (const name of importedNativeRows(ctx, ws)) {
      if (!(name in peers) && !(name in installed(manifest))) add(manifestFile(ws), lineOfKey(repo.texts.get(ws), 'peerDependencies'), 'workspace-peer', `${name} is imported by ${ws} but is not one of its peerDependencies`, `Add "${name}": "*" to ${manifestFile(ws)} peerDependencies (with its root override), and install it in every app that depends on ${manifest.name || ws}.`);
    }
  }
  for (const app of repo.apps) {
    const appDeps = installed(repo.manifests.get(app));
    for (const ws of repo.shared) {
      const manifest = repo.manifests.get(ws);
      if (!manifest.name || !(manifest.name in appDeps)) continue;
      for (const name of Object.keys(manifest.peerDependencies ?? {})) {
        const row = policy.packages[name];
        if (!row || !isAppRow(row) || name in appDeps) continue;
        add(manifestFile(app), lineOfKey(repo.texts.get(app), 'dependencies'), 'every-app', `lacks ${name}, a peer of ${manifest.name} that this app depends on; without its own entry the app gets whatever npm resolves for the "*" peer, which npx expo install --check and expo-doctor never compare because they verify only the app's direct dependencies`, `Install it with the same specifier: ${row.install === 'expo' ? expoInstall(repo, app, name, row.spec) : `npm install ${name}@${row.version} -w ${app}`}.`);
      }
    }
  }
  const byName = new Map();
  for (const [ws, manifest] of repo.manifests) for (const [section, name, spec] of entriesOf(manifest)) if (spec !== '*') byName.set(name, [...(byName.get(name) ?? []), [ws, spec, section]]);
  for (const [name, list] of byName) {
    if (new Set(list.map(([, spec]) => spec)).size < 2) continue;
    const [ws, , section] = list[0];
    add(manifestFile(ws), lineOfDep(repo.texts.get(ws), section, name), 'lockstep', `${name} differs between workspaces: ${list.map(([dir, spec]) => `${dir || '.'}=${spec}`).join(', ')}`, 'Move every workspace to the same specifier in one commit.');
  }
}

/** "*" peers of shared workspaces that are app rows (react and react-native have their own rule). */
function sharedPeerRows(ctx) {
  const { repo, policy } = ctx;
  if (repo.mode !== 'monorepo' || !policy) return [];
  const names = new Set(repo.shared.flatMap((ws) => Object.keys(repo.manifests.get(ws).peerDependencies ?? {})));
  return [...names].filter((name) => isAppRow(policy.packages[name]) && !ONE_REACT.includes(name)).map((name) => [name, policy.packages[name]]);
}

/** Companions pinned through the root overrides, for every row installed somewhere: name -> [version, row name]. */
function overrideCompanions(ctx) {
  const { repo, policy } = ctx;
  const out = new Map();
  if (!policy) return out;
  const direct = new Set([...repo.manifests.values()].flatMap((m) => Object.keys(installed(m))));
  for (const [name, row] of Object.entries(policy.packages)) {
    if (!direct.has(name)) continue;
    for (const companion of row.companions ?? []) if (companion.via === 'overrides') out.set(companion.package, [companion.version, name]);
  }
  return out;
}

/**
 * The root overrides hold one React, the "*" peers of shared workspaces at the version the apps
 * install, the companions a row lets float, and rows marked "override"; anything else is stale.
 */
function checkOverrides(ctx) {
  const { repo, policy, add } = ctx;
  const root = repo.manifests.get('') ?? {};
  const overrides = root.overrides ?? {};
  const text = repo.texts.get('');
  const at = (name) => (name in overrides ? lineOfDep(text, 'overrides', name) : lineOfKey(text, 'overrides'));
  // "$react" stands for the root's own specifier of react (npm's override reference); an object
  // override pins its "." value. Compare what npm would apply, and show what the file says.
  const pinnedOf = (name) => resolveOverride(root, overrides[name]);
  const shown = (name) => {
    if (!(name in overrides)) return 'missing';
    const raw = typeof overrides[name] === 'string' ? overrides[name] : JSON.stringify(overrides[name]);
    const value = pinnedOf(name);
    return raw === value ? raw : `${raw} (${value === undefined ? 'which names nothing the root package.json declares' : `= ${value}`})`;
  };
  for (const name of ONE_REACT) {
    const pinned = pinnedOf(name);
    const used = new Set(repo.apps.map((ws) => repo.manifests.get(ws)?.dependencies?.[name]).filter(Boolean));
    const required = repo.mode === 'monorepo' && used.size > 0;
    if ((required && pinned === undefined) || ((name in overrides) && [...used].some((spec) => spec !== pinned))) add('package.json', at(name), 'overrides', `overrides.${name} is ${shown(name)} but the app${repo.mode === 'monorepo' ? 's use' : ' uses'} ${[...used].join(', ')}`, `Set "overrides": { "${name}": "${[...used][0]}" } and change it only together with the app${repo.mode === 'monorepo' ? 's' : ''}.`);
  }
  if (!policy) return;
  for (const [name, row] of Object.entries(policy.packages)) if (row.override && name in overrides && pinnedOf(name) !== row.version) add('package.json', at(name), 'overrides', `overrides.${name} is ${shown(name)} but its row pins ${row.version}`, `Set "overrides": { "${name}": "${row.version}" }, or change the row in the same commit.`);
  const peers = sharedPeerRows(ctx);
  for (const [name, row] of peers) {
    if (pinnedOf(name) !== row.version) add('package.json', at(name), 'peer-override', `overrides.${name} is ${shown(name)}; a shared package's "*" peer needs it pinned at ${row.version}, the version the apps install, or npm puts its newest release at the root next to the apps' copy (two native copies; expo-doctor reports duplicates)`, `Set "overrides": { "${name}": "${row.version}" } in the root package.json, then npm install.`);
  }
  const companions = overrideCompanions(ctx);
  for (const [name, [version, neededBy]] of companions) {
    if (pinnedOf(name) !== version) add('package.json', at(name), 'companion', `overrides.${name} is ${shown(name)}; ${neededBy} ${policy.packages[neededBy].version} needs it pinned at ${version}`, `Set "overrides": { "${name}": "${version}" } in the root package.json, then npm install (npm ls ${name} must show one version).`);
  }
  const allowed = new Set([...ONE_REACT, ...peers.map(([name]) => name), ...companions.keys(), ...Object.entries(policy.packages).filter(([, row]) => row.override).map(([name]) => name)]);
  for (const name of Object.keys(overrides).filter((key) => !allowed.has(key))) add('package.json', at(name), 'stale-override', `overrides.${name} is neither react, react-native, a shared package's "*" peer, a companion of an installed row nor a row marked "override"`, `Remove it from the root overrides (it forces ${JSON.stringify(overrides[name])} on the whole tree), or add the row that needs it.`);
}

/** Where a companion with its own row is installed, seen from the workspace of the row that needs it. */
function companionHome(repo, companionRow, ws) {
  if (repo.mode === 'single') return '';
  const places = placesOf(companionRow);
  if (places.length === 0 || places.includes(ws) || (places.includes('app') && repo.apps.includes(ws))) return ws;
  if (places.includes('dev')) return '';
  return places.find((place) => place !== 'app') ?? ws;
}

/** Companions installed with their row (in the same command, at the same exact version). */
function checkInstallCompanions(ctx) {
  const { repo, policy, add } = ctx;
  if (!policy) return;
  for (const [ws, manifest] of repo.manifests) {
    for (const name of Object.keys(installed(manifest))) {
      for (const companion of policy.packages[name]?.companions ?? []) {
        if (companion.via !== 'install') continue;
        const home = companionHome(repo, policy.packages[companion.package], ws);
        if (companion.package in installed(repo.manifests.get(home) ?? {})) continue;
        add(manifestFile(home), lineOfKey(repo.texts.get(home), 'dependencies'), 'companion', `${name} ${policy.packages[name].version} is installed but its companion ${companion.package} ${companion.version} is not (${companion.why})`, `Install them together: plan-dependency.mjs ${name} prints the command (npm picks the wrong ${companion.package} on its own).`);
      }
    }
  }
}

const sortedJson = (record) => JSON.stringify(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));

function checkLockfile(ctx) {
  const { repo, policy, bans, add } = ctx;
  if (repo.lockfile === null) return add('package-lock.json', 0, 'lockfile-missing', 'is missing', 'Run npm install once and commit package-lock.json; install fresh clones and CI with npm ci.');
  const packages = repo.lockfile.packages ?? {};
  const lockText = ctx.lockText;
  const lineOf = (path) => lineOfKey(lockText, path);
  for (const [ws, manifest] of repo.manifests) {
    const entry = packages[ws];
    if (!entry) add('package-lock.json', 1, 'lockfile-sync', `has no entry for ${ws === '' ? 'the root' : ws}`, 'Run npm install at the root and commit the lockfile.');
    else if (sortedJson(installed(entry)) !== sortedJson(installed(manifest))) add('package-lock.json', ws === '' ? 1 : lineOf(ws), 'lockfile-sync', `dependencies of ${ws === '' ? 'the root' : ws} differ from its package.json (stale lockfile)`, 'Run npm install at the root, then commit package.json and package-lock.json together.');
  }
  const direct = new Set([...repo.manifests.values()].flatMap((m) => Object.keys(installed(m))));
  for (const path of Object.keys(packages).filter((p) => p.includes('node_modules/'))) {
    const name = lockName(path);
    const ban = bans.find((entry) => entry.regex.test(name));
    if (ban && (ban.scope === 'anywhere' || direct.has(name))) add('package-lock.json', lineOf(path), 'banned', `${name} is in the lockfile (${path}): ${ban.reason}`, `Find what pulls it in (npm explain ${name}) and remove that dependency.${banFix(ban)}`);
  }
  checkDeprecated(ctx, packages, lineOf);
  checkScripts(ctx, packages);
  const versionsOf = (name) => new Set(Object.entries(packages).filter(([path]) => path.includes('node_modules/') && lockName(path) === name).map(([, entry]) => entry.version));
  for (const name of ONE_REACT) {
    const found = versionsOf(name);
    if (found.size > 1) add('package-lock.json', 1, 'one-react', `${name} is installed as ${[...found].join(', ')}; the tree must hold one version`, 'Pin it in the root "overrides" at the app\'s version and reinstall; npm ls react react-native must show one version each.');
  }
  if (policy) checkOneVersion(ctx, versionsOf);
}

/**
 * A direct dependency npm marks deprecated, unless its row says why it is accepted. Without a usable
 * policy the accepted holds are unknown, so the check waits for policy-contract to be fixed first
 * (otherwise a typo in the policy would turn the seed's accepted ESLint 9 into a false finding).
 */
function checkDeprecated(ctx, packages, lineOf) {
  const { repo, policy, add } = ctx;
  if (!policy) return;
  const seen = new Set();
  for (const [ws, manifest] of repo.manifests) {
    for (const name of Object.keys(installed(manifest))) {
      const path = [`${ws === '' ? '' : `${ws}/`}node_modules/${name}`, `node_modules/${name}`].find((key) => packages[key]);
      const entry = path ? packages[path] : null;
      if (!entry?.deprecated || seen.has(name) || policy?.packages[name]?.deprecated) continue;
      seen.add(name);
      add('package-lock.json', lineOf(path), 'deprecated', `${name}@${entry.version} is deprecated on npm: "${String(entry.deprecated).slice(0, 160)}"`, `Replace it with what the message names (the upgrade procedure), or, for a deliberate hold, say why in its policy row: "deprecated": "<why it stays and until when>".`);
    }
  }
}

/**
 * Install scripts against the root allowScripts, matched the way npm 11.17 does (arborist
 * script-allowed.js): a name (or name@*) covers every version, name@x.y.z one version, name@x.y.z ||
 * a.b.c the listed versions, and only the values true (approve) and false (deny) count. Ranges never
 * match in npm, and git, file and URL keys match a resolved source this check cannot see: each such
 * key is reported once as a form this check cannot evaluate, instead of the packages it may cover.
 * A name-only true covers every future version without a review, so it is a finding of its own
 * (unpinned-approval); a name-only false is a reviewed denial of every version and passes.
 */
function checkScripts(ctx, packages) {
  const { repo, add } = ctx;
  const allow = repo.manifests.get('')?.allowScripts ?? {};
  const text = repo.texts.get('');
  const keys = Object.keys(allow).map((key) => ({ key, value: allow[key], ...parseAllowScriptsKey(key) }));
  const unsupported = keys.filter((entry) => entry.kind === 'unsupported');
  const decided = keys.filter((entry) => entry.kind !== 'unsupported' && typeof entry.value === 'boolean');
  const versionsOf = (name) => new Set(Object.entries(packages).filter(([path]) => path.includes('node_modules/') && lockName(path) === name).map(([, entry]) => entry.version));
  const keyLine = (key) => lineOfDep(text, 'allowScripts', key);
  for (const entry of unsupported) add('package.json', keyLine(entry.key), 'install-scripts', `allowScripts key "${entry.key}" is a form this check cannot evaluate (${entry.why})`, `Write the reviewed package as "<name>@x.y.z" or "<name>@x.y.z || a.b.c" (or "<name>": false to deny every version); npm approve-scripts <name> writes the pinned form.`);
  for (const entry of keys.filter((key) => key.kind !== 'unsupported' && typeof key.value !== 'boolean')) add('package.json', keyLine(entry.key), 'install-scripts', `allowScripts "${entry.key}" is ${JSON.stringify(entry.value)}; npm counts only true (approve) and false (deny) and ignores anything else, so the package stays unreviewed`, `Write true after reading the script (npm approve-scripts ${entry.name} writes the pinned key), or false to deny it.`);
  for (const entry of keys.filter((key) => key.kind === 'any' && key.value === true)) {
    const found = [...versionsOf(entry.name)].sort();
    const pinned = found.length ? found.map((version) => `"${entry.name}@${version}": true`).join(' and ') : `"${entry.name}@<x.y.z>": true`;
    add('package.json', keyLine(entry.key), 'unpinned-approval', `allowScripts approves "${entry.key}" for every version, so the install script of every future release runs without a review`, `Read the installed version's script, then npm approve-scripts ${entry.name} (it replaces the key with ${pinned}); "${entry.name}": false denies every version instead.`);
  }
  for (const [path, entry] of Object.entries(packages)) {
    if (!entry.hasInstallScript || !path.includes('node_modules/') || entry.inBundle) continue;
    if (entry.optional && !existsSync(join(repo.root, path))) continue;
    const name = lockName(path);
    const covered = decided.some((key) => key.name === name && (key.kind === 'any' || key.versions.includes(entry.version)));
    const unsure = unsupported.some((key) => key.name === null || key.name === name);
    if (!covered && !unsure) add('package.json', lineOfKey(text, 'allowScripts'), 'install-scripts', `${name}@${entry.version} has an install script that allowScripts does not cover`, `Read it (npm view ${name}@${entry.version} scripts, then the file it runs), then npm approve-scripts ${name} and npm rebuild ${name} (it was installed with --ignore-scripts or before strict-allow-scripts=true), or npm deny-scripts ${name}.`);
  }
  for (const entry of decided.filter((key) => key.kind === 'versions')) {
    const found = versionsOf(entry.name);
    if (found.size > 0 && !entry.versions.some((version) => found.has(version))) add('package.json', keyLine(entry.key), 'stale-approval', `allowScripts ${entry.value ? 'approves' : 'denies'} ${entry.key} but ${[...found].join(', ')} is installed`, `Review the new version's script, then npm approve-scripts ${entry.name} (it rewrites the pin); with strict-allow-scripts=true the next install of that version stops until you do.`);
  }
}

/** The release line a caret range stays on: the major, or major.minor below 1.0. */
const releaseLine = (version) => {
  const [major, minor] = bareVersion(version).split('.');
  return major === '0' ? `0.${minor}` : major;
};

/**
 * No table row and no companion is installed twice on its own release line (a caret range that
 * floated past the pin: two @typescript-eslint/* copies crash ESLint, two native copies break the
 * build), and a companion never sits at another version than its pin. Runtime rows allow no second
 * copy at all. Older majors that other tools need (globals 14, @types/node 24) are fine.
 */
function checkOneVersion(ctx, versionsOf) {
  const { policy, add } = ctx;
  const pins = new Map(Object.entries(policy.packages).filter(([name]) => !ONE_REACT.includes(name)).map(([name, row]) => [name, { version: row.version, strict: !isDevRow(row), neededBy: null }]));
  for (const [name, row] of Object.entries(policy.packages)) for (const companion of row.companions ?? []) if (!pins.has(companion.package)) pins.set(companion.package, { version: companion.version, strict: false, neededBy: name });
  for (const [name, pin] of pins) {
    const found = [...versionsOf(name)].sort();
    if (found.length === 0) continue;
    const offLine = found.filter((version) => version !== pin.version && (pin.strict || releaseLine(version) === releaseLine(pin.version)));
    if (offLine.length === 0 || (found.length === 1 && pin.neededBy === null)) continue;
    const why = pin.neededBy ? `${pin.neededBy} needs ${name} ${pin.version}` : `the policy pins ${pin.version}`;
    add('package-lock.json', 1, 'one-version', `${name} is installed as ${found.join(', ')}; ${why}, so ${offLine.join(', ')} is a second copy that floated in on a range`, `Pin it: "overrides": { "${name}": "${pin.version}" } in the root package.json (or install it at ${pin.version} next to what needs it), npm install, then npm ls ${name} must show one version.`);
  }
}

function checkLicenseExceptions(ctx) {
  const { policy, add, policyRel } = ctx;
  if (!policy) return;
  for (const [name, entry] of Object.entries(policy.licenses.exceptions)) {
    if (typeof entry?.license !== 'string' || !entry.license || typeof entry?.reason !== 'string' || entry.reason.trim().length < 10) add(policyRel, lineOfDep(ctx.policyText, 'exceptions', name), 'license-exceptions', `licenses.exceptions.${name} needs an exact "license" and a real "reason"`, 'Write { "license": "<exact SPDX>", "reason": "<why it is acceptable>" }; the developer approves every exception.');
  }
}

const CODE_FILES = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'];
/** Files that name packages without using them: tooling, lint and Jest configs, the contracts. */
const NOT_CODE = ['scripts/**', 'eslint.config.*', 'jest.config.*', 'jest.sim.config.*', 'knip.*', 'contracts/**', 'reports/**', '**/*.d.ts'];
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const usesPackage = (code, name) => new RegExp(`['"\`]${escapeRegex(name)}['"\`/]`).test(code);

/** Package names knip's config ignores: the one place an app records an implicit use for knip. */
function knipIgnored(root) {
  const names = new Set();
  for (const file of ['knip.json', 'knip.jsonc', '.knip.json', '.knip.jsonc']) {
    if (!existsSync(join(root, file))) continue;
    let config;
    try {
      config = parseJsonc(readFileSync(join(root, file), 'utf8'));
    } catch {
      continue;
    }
    const lists = [config?.ignoreDependencies, ...Object.values(config?.workspaces ?? {}).map((w) => w?.ignoreDependencies)];
    for (const list of lists) for (const name of Array.isArray(list) ? list : []) if (typeof name === 'string') names.add(name);
  }
  return names;
}

/**
 * Install a package in the same change as the code that uses it. knip cannot see an unused native
 * module once a shared package lists it as a peer (the peer counts as a use), so every native row
 * an app installs must be imported, required or named (config plugin, Babel, Jest setup, a mock)
 * by some code file. Rows marked implicitUse and packages in knip's ignoreDependencies are used by
 * something the scan cannot see.
 */
function checkUnused(ctx) {
  const { repo, policy, add, layout, report } = ctx;
  if (!policy) return;
  const sourceDirs = repo.mode === 'single' ? [layout.srcDir, layout.routesDir] : layout.workspaces.filter((w) => repo.apps.includes(w.dir)).flatMap((w) => [w.layout.srcDir, w.layout.routesDir]);
  if (!sourceDirs.some((dir) => existsSync(join(repo.root, dir)))) {
    const file = sourceDirs[0] ?? layout.srcDir;
    return report.skip({ file, rule: 'unused-dependency', message: notYetCreated(repo.root, { file, owner: 'expo-project-bootstrap' }) });
  }
  const ignored = knipIgnored(repo.root);
  const candidates = [];
  for (const app of repo.apps) {
    const manifest = repo.manifests.get(app) ?? {};
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
      const row = policy.packages[name];
      if (row?.native && !row.implicitUse && !['expo', ...ONE_REACT].includes(name) && !ignored.has(name)) candidates.push([app, name]);
    }
  }
  if (candidates.length === 0) return;
  const ignore = [...NOT_CODE, ...repo.shared.concat(repo.apps).filter(Boolean).map((ws) => `${ws}/scripts/**`)];
  const code = walkRepo(repo.root, { include: CODE_FILES, ignore }).map((rel) => readFileSync(join(repo.root, rel), 'utf8')).join('\n');
  for (const [app, name] of candidates) {
    if (!usesPackage(code, name)) add(manifestFile(app), lineOfDep(repo.texts.get(app), 'dependencies', name), 'unused-dependency', `${name} is a native module the app installs, but no code file, config plugin entry, Jest setup or mock uses it`, `Write the code that needs ${name} in the same change, or remove it${repo.mode === 'monorepo' ? ' from every app and from the shared peerDependencies' : ''}; if something the scan cannot see loads it, say so in its row ("implicitUse").`);
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const target = positionals[0] ?? '.';
  const root = requireDir(target, 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${target} has no package.json`, 'Run it from the repo root, or pass the root folder: check-deps-policy.mjs <repo-root>.');
  const today = options.today ?? todayUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail(`--today "${today}" is not YYYY-MM-DD`, 'Pass a date such as 2026-10-03.');
  const layout = resolveLayout(root);
  const repo = readRepo(root);
  repo.texts = new Map([...repo.manifests.keys()].map((ws) => [ws, readFileSync(join(root, manifestFile(ws)), 'utf8')]));
  const policyRel = policyPath(layout, options.policy);
  const read = readPolicy(root, policyRel);
  const banLists = loadBanLists();
  const policy = read.policy;
  const sdk = repoSdk(repo);
  const map = moduleMapFor(repo, policy?.sdk ?? sdk);
  if (!map && sdk !== null) fail(`no Expo module map for SDK ${policy?.sdk ?? sdk}: node_modules/expo is not installed and this skill carries the SDK ${MODULE_MAP_SOURCE.sdk} map only`, 'Run npm ci first (the installed expo has the exact map), or update the dependency-management skill.');
  const report = createReporter({ name: 'check-deps-policy', json: options.json });
  const add = (file, line, rule, message, fix) => report.problem({ file, line, rule, message, fix });
  const ctx = {
    repo, policy, layout, report, add, today, policyRel,
    map: map?.map ?? {},
    mapSource: map?.source ?? 'none',
    bans: effectiveBans(policy, banLists),
    sameSdk: sdk === null || !policy || sdk === policy.sdk,
    policyText: read.exists ? readFileSync(join(root, policyRel), 'utf8') : '',
    lockText: existsSync(join(root, 'package-lock.json')) ? readFileSync(join(root, 'package-lock.json'), 'utf8') : '',
  };
  for (const error of repo.errors) add(error.file, 1, 'lockfile-sync', error.message, 'Fix the JSON (or regenerate the lockfile with npm install).');
  checkPolicyContract(ctx, read, banLists);
  checkNpmrc(ctx);
  checkNpmEnv(ctx);
  checkNpxInstalls(ctx);
  checkEngines(ctx);
  checkTableSdk(ctx);
  checkTableMap(ctx);
  checkManifests(ctx);
  checkWorkspaces(ctx);
  checkOverrides(ctx);
  checkInstallCompanions(ctx);
  checkLockfile(ctx);
  checkLicenseExceptions(ctx);
  checkUnused(ctx);
  return report.finish({ checked: repo.manifests.size, unit: 'package.json files' });
});
