#!/usr/bin/env node
// check-skeleton.mjs: checks that a repo holds the skeleton of an Expo app the way scaffold-app.mjs
// writes it, and that the policy parts of every root config still match this skill's templates:
// root files, the manifest and its pins, the .npmrc policy, ignores, the tsconfig set, the app config
// and its variants, the gate wiring, the agent settings, the lockfile and install-script approvals,
// template leftovers and unfilled placeholders. When multi-package (package.json "workspaces"), it
// also checks the workspace layout, lockstep versions and the root overrides of shared peers.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-skeleton.mjs [repo-root]

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';

import { ASSETS, PRINT_WIDTH, TEMPLATES, holdsTypeScript, leftoversIn, preExistingEntries, reservedIdPartProblem } from './lib/bootstrap-plan.mjs';
import { EXACT_VERSION, NPMRC_POLICY, lineMatching, npmrcExcludeProblems, npmrcMissingPolicy, npmrcPolicyOverrides, readJsonFile, readTextFile } from './lib/repo-read.mjs';
import { bundleIdProblem, placeholdersIn } from './lib/ship-placeholders.mjs';
import { createReporter, fail, maskComments, parseArgs, readWorkspaces, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';

const SPEC = {
  name: 'check-skeleton',
  summary: 'Checks the skeleton of an Expo app (single app at the repo root, or npm workspaces): root files, manifest and pins, .npmrc policy and dated excludes, ignores, the tsconfig set, app.config.ts and its variants, metro cache key, gate files and their wiring, agent settings, AGENTS.md, the lockfile and install-script approvals, template leftovers and unfilled placeholders.',
  usage: '[repo-root] [options]',
  options: {
    today: { type: 'string', value: 'YYYY-MM-DD', help: 'Date for the .npmrc exclude expiry check (default: today, UTC)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (any layout): root-file root-manifest root-scripts root-overrides pin-exact npmrc-policy npmrc-exclude',
    '  node-pin gitignore prettier-config format-ignore lint-ignore format-width tsconfig-base tsconfig-program',
    '  app-manifest banned app-config app-id platforms metro-cache app-files app-env tooling-files knip-config',
    '  lefthook quality-gates gate-scope stryker-config claude-settings agents lockfile install-scripts one-react',
    '  template-leftover placeholder',
    'When multi-package (package.json "workspaces"): workspace-layout package-manifest app-lockstep root-runtime,',
    '  and root-overrides also covers react, react-native and every "*" peer of a shared package. root-scripts',
    '  then expects the workspace forms of assets/package-scripts.multi-package.json (typecheck; export:audit run',
    '  inside the Expo app workspace, <app-dir> filled in), and every workspace its own typecheck (workspace-layout).',
    '  A workspace declaring "engines.node" or a "bin" is Node tooling (a Cloud Functions backend): node types, and',
    '  no exports map needed. Every declared workspace folder counts as app code, never as pre-existing.',
    'Reads rn-skills.config.json (optional): the layout keys (srcDir, routesDir, contractsDir; per workspace under',
    '  "workspaces", relative to the workspace), "dependencyPolicy", "layoutEntries" (extra top-level names that',
    '  belong to the app) and "agentInstructions": "parent-repo" (an app nested in a repository: AGENTS.md must sit',
    '  in a folder up to that repository\'s top level, the first ancestor holding .git, below the home folder);',
    '  <contractsDir>/dependency-policy.json for the allowed specifiers and versions (pin-exact: a range only where',
    '  the policy writes it, an exact pin only at the policy\'s version or inside its ~ range) and the banned and',
    '  doNotAdd lists (banned).',
    'An app id under com.example is printed as a NOTE (the ship gates refuse it), not a problem.',
    '',
    'Example: node check-skeleton.mjs .      (from the repo root)',
  ].join('\n'),
};

/** Root files every skeleton holds (an app's files are checked per app; the contracts follow contractsDir). */
const ROOT_FILES = ['package.json', 'package-lock.json', '.npmrc', '.gitignore', '.prettierrc.json', '.prettierignore', 'tsconfig.base.json', 'tsconfig.json', 'tsconfig.stryker.json', 'eslint.config.mjs', 'knip.json', 'lefthook.yml', 'quality-gates.json', '.claude/settings.json', 'babel.config.js', 'jest.config.js', 'jest.setup.ts', 'jest.sim.config.js', 'stryker.config.json'];
/** Files that pin the Node version (any one; .nvmrc is what the skeleton writes and CI reads). */
const NODE_PIN_FILES = ['.nvmrc', '.node-version', '.mise.toml', '.tool-versions'];
/** Gate and tool scripts the npm scripts, hooks, metro config and agent settings call. */
const TOOLING_FILES = ['quality/check-quality-gates.ts', 'quality/gate-diff.ts', 'quality/gated-paths.ts', 'quality/verify-plan.ts', 'quality/run-verify.ts', 'quality/device-only.ts', 'hooks/after-edit.ts', 'hooks/install-git-hooks.ts', 'hooks/hook-install-plan.ts', 'git/check-commit-message.ts', 'git/commit-message-rules.ts', 'git/commit-trailer-rules.ts', 'git/commit-config.ts', 'deps/check-deps.ts', 'deps/check-npm-config.ts', 'audit/audit-licenses.ts', 'clock/system-clock.ts', 'metro/public-env-cache-version.ts'];
/** typescript-eslint's own packages: eslint-config-expo asks for ^8.59.0 of them, so they float without an override. */
const TS_ESLINT_PACKAGES = ['eslint-plugin', 'parser', 'project-service', 'scope-manager', 'tsconfig-utils', 'type-utils', 'types', 'typescript-estree', 'utils', 'visitor-keys'].map((name) => `@typescript-eslint/${name}`);
/** What every Expo app of the skeleton depends on (expo-system-ui: userInterfaceStyle 'automatic'). */
const APP_RUNTIME = ['expo', 'expo-router', 'expo-system-ui', 'react', 'react-native'];
/** App runtime packages that never belong in a multi-package root manifest (autolinking reads the app's). */
const RUNTIME_AT_ROOT = /^(expo|expo-.+|@expo\/.+|react|react-native|react-native-.+|@react-native-.+|@shopify\/react-native-.+)$/;
/** npm scripts that are the app's own (expo start or expo run), not gates (quality-gates treats them the same way). */
const APP_OWN_SCRIPTS = new Set(['start', 'android', 'ios', 'web']);
/** Agent folders no gate may reach into (installed skills hold planted bugs on purpose). */
const AGENT_FOLDERS = ['skills', '.agents', '.claude'];
const TEMPLATE_TOKEN = /__[A-Z][A-Z0-9_]*__/g;
const NOT_PLACEHOLDERS = new Set(['__DEV__']);

const template = (rel) => readFileSync(join(TEMPLATES, rel), 'utf8');
/** The scripts that change when multi-package: { scripts (root; export:audit names the Expo app), workspaceScripts (every workspace) }. */
/**
 * A workspace-form command for one Expo app workspace: <app-dir> is its folder, <to-root> the way back up.
 * With several apps the one the repo's own script names is the canonical one (else the first).
 */
function fillAppDir(command, appDirs, actual) {
  if (!command.includes('<app-dir>') || appDirs.length === 0) return command;
  const forms = appDirs.map((dir) => command.replaceAll('<app-dir>', dir).replaceAll('<to-root>', dir.split('/').map(() => '..').join('/')));
  return forms.find((form) => form === actual) ?? forms[0];
}
const multiPackageScripts = () => JSON.parse(readFileSync(join(ASSETS, 'package-scripts.multi-package.json'), 'utf8'));
const templateJson = (rel) => JSON.parse(template(rel));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const depsOf = (manifest) => ({ ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) });

function context(root, today) {
  const resolved = resolveLayout(root);
  // resolveLayout gives each workspace its folders; readWorkspaces adds its parsed package.json.
  const manifests = new Map(readWorkspaces(root).map((ws) => [ws.dir, ws.manifest]));
  const layout = { ...resolved, workspaces: resolved.workspaces.map((ws) => ({ ...ws, manifest: manifests.get(ws.dir) ?? {} })) };
  const json = (rel, opts) => readJsonFile(join(root, rel), opts);
  const text = (rel) => readTextFile(join(root, rel));
  const rootManifest = json('package.json').value ?? {};
  const monorepo = layout.workspaces.length > 0;
  const apps = monorepo
    ? layout.workspaces.filter((ws) => ['app.config.ts', 'app.config.js', 'app.json'].some((file) => existsSync(join(root, ws.dir, file)))).map((ws) => ({ dir: ws.dir, manifest: ws.manifest, srcDir: ws.layout.srcDir, routesDir: ws.layout.routesDir }))
    : [{ dir: '.', manifest: rootManifest, srcDir: layout.srcDir, routesDir: layout.routesDir }];
  // The app's own dependency scripts find the policy the same way: "dependencyPolicy", else <contractsDir>/dependency-policy.json.
  const policyFile = typeof layout.config.dependencyPolicy === 'string' ? layout.config.dependencyPolicy : posix.join(layout.contractsDir, 'dependency-policy.json');
  const rootFiles = [...ROOT_FILES, policyFile, posix.join(layout.contractsDir, 'knip-ignores.json')];
  const policy = json(policyFile).value ?? templateJson('contracts/dependency-policy.json');
  return { root, today, layout, json, text, rootManifest, monorepo, apps, policy, rootFiles, preExisting: preExistingEntries(root) };
}

const at = (dir, rel) => (dir === '.' ? rel : posix.join(dir, rel));

function checkRootFiles(ctx, add) {
  for (const rel of ctx.rootFiles) if (!existsSync(join(ctx.root, rel))) add(rel, 0, 'root-file', 'is missing', rel === 'package-lock.json' ? 'Run npm install once (inside a git repository) and commit package-lock.json; fresh clones and CI use npm ci.' : 'Run scaffold-app.mjs . --app-id <id> --name <name> --write (or copy the file from the templates).');
  for (const rel of TOOLING_FILES) {
    const file = posix.join(ctx.layout.scriptsDir, rel);
    if (!existsSync(join(ctx.root, file))) add(file, 0, 'tooling-files', 'is missing: an npm script, hook, metro.config.js or the agent settings call it', 'Copy it from the templates (the gates fail without it); never stub it.');
  }
}

function checkRootManifest(ctx, add) {
  const read = ctx.json('package.json');
  if (!read.ok) return read.error === 'missing' ? undefined : add('package.json', 1, 'root-manifest', read.error, 'Fix the JSON.');
  const pkg = read.value;
  const want = JSON.parse(readFileSync(join(ASSETS, 'skeleton-package.json'), 'utf8'));
  // When multi-package, typecheck and export:audit take their workspace forms (quality-gates' list).
  if (ctx.monorepo) want.scripts = { ...want.scripts, ...Object.fromEntries(Object.entries(multiPackageScripts().scripts).map(([name, command]) => [name, fillAppDir(command, ctx.apps.map((app) => app.dir), pkg.scripts?.[name])])) };
  if (pkg.private !== true) add('package.json', 1, 'root-manifest', 'must be "private": true (an app is never published to npm)', 'Set "private": true.');
  if (!same(pkg.engines, want.engines)) add('package.json', 1, 'root-manifest', `engines must be ${JSON.stringify(want.engines)} (Node 22.18 strips types for app.config.ts and the scripts; npm 11.17 reads the dated excludes)`, 'Copy "engines" from the template.');
  if (!ctx.monorepo) {
    if (pkg.type !== undefined) add('package.json', 1, 'root-manifest', `sets "type": "${pkg.type}"; metro.config.js, babel.config.js and jest.config.js are CommonJS`, 'Remove "type" (the scripts folder has its own package.json).');
    const main = pkg.main;
    if (main !== 'expo-router/entry' && !(typeof main === 'string' && existsSync(join(ctx.root, main)))) add('package.json', 1, 'root-manifest', `"main" is ${JSON.stringify(main)}: neither expo-router/entry nor an entry file that exists`, 'Set "main": "expo-router/entry", or an index.ts that imports its polyfills and then expo-router/entry (app-startup-and-bootstrap).');
  } else if (!Array.isArray(pkg.workspaces) && !Array.isArray(pkg.workspaces?.packages)) {
    add('package.json', 1, 'root-manifest', '"workspaces" must be a list of globs', 'Declare "workspaces": ["apps/*", "packages/*"].');
  }
  for (const [name, command] of Object.entries(want.scripts)) {
    // start, android, ios and web are the app's own (prebuild rewrites android and ios to expo run:*).
    if (APP_OWN_SCRIPTS.has(name)) continue;
    if (pkg.scripts?.[name] !== command) add('package.json', lineMatching(readTextFile(join(ctx.root, 'package.json')), new RegExp(`"${name.replace(/[:]/g, '\\:')}":`)), 'root-scripts', `script "${name}" ${pkg.scripts?.[name] === undefined ? 'is missing' : 'differs from the canonical command'}`, `Set it to: ${command}`);
  }
  const rows = ctx.policy.packages ?? {};
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    if (!EXACT_VERSION.test(version)) add('package.json', 1, 'pin-exact', `devDependency ${name} is "${version}", not an exact version`, `Pin it exactly (npm install -D ${name}@<x.y.z>; .npmrc save-exact=true).`);
    else reportOffPolicy(add, 'package.json', name, version, rows);
  }
  if (ctx.monorepo) {
    for (const name of Object.keys(pkg.dependencies ?? {})) if (RUNTIME_AT_ROOT.test(name)) add('package.json', 1, 'root-runtime', `${name} is an app runtime package listed at the root`, 'Install it in each app workspace (npx expo install inside apps/<app>); the root pins react and react-native only through "overrides".');
  }
  checkOneTypescriptEslint(pkg, add);
}

/**
 * One typescript-eslint: eslint-config-expo asks for ^8.59.0 of the @typescript-eslint/* packages,
 * so a fresh install can hoist the newest release next to typescript-eslint's own copy, and every
 * ESLint run then crashes with 'Cannot redefine plugin "@typescript-eslint"'. The overrides pin all ten.
 */
function checkOneTypescriptEslint(pkg, add) {
  const pin = pkg.devDependencies?.['typescript-eslint'];
  if (pin === undefined) return;
  for (const name of TS_ESLINT_PACKAGES) {
    if (pkg.overrides?.[name] !== pin) add('package.json', 1, 'root-overrides', `overrides.${name} is ${pkg.overrides?.[name] ?? 'missing'}; one typescript-eslint means all ten @typescript-eslint/* packages at the typescript-eslint pin ${pin} (a second copy crashes ESLint: Cannot redefine plugin "@typescript-eslint")`, `Set "${name}": "${pin}" in "overrides" (the template lists all ten), then npm install; npm ls ${name} must show one version.`);
  }
}

/**
 * An exact pin must be the dependency policy's version (or lie inside its specifier, for the ~ of an
 * Expo SDK module after a newer patch): a hand-typed or stale exact pin is as off-policy as a range.
 */
function reportOffPolicy(add, rel, name, spec, rows) {
  const row = rows[name];
  if (!row || spec === row.version || (row.spec && inRange(spec, row.spec))) return;
  add(rel, 1, 'pin-exact', `${name} is pinned at ${spec}, but the dependency policy says "${row.spec ?? row.version}" (${row.version})`, `Install the policy's version (${row.install === 'expo' ? `npx expo install ${name}` : `npm install ${name}@${row.version} --save-exact`}), or move the policy row first with dependency-management.`);
}

/** True when an exact version lies in a specifier (~x.y.z, ^x.y.z, x.y.z). */
function inRange(version, spec) {
  const want = String(spec).replace(/^[~^]/, '');
  const [major, minor, patch] = want.split('.').map(Number);
  const [gotMajor, gotMinor, gotPatch] = String(version).split('-')[0].split('.').map(Number);
  const atLeast = gotMajor > major || (gotMajor === major && (gotMinor > minor || (gotMinor === minor && gotPatch >= patch)));
  if (String(spec).startsWith('~')) return gotMajor === major && gotMinor === minor && atLeast;
  if (String(spec).startsWith('^')) return gotMajor === major && atLeast;
  return version === want;
}

function checkAppManifests(ctx, add) {
  const rows = ctx.policy.packages ?? {};
  for (const app of ctx.apps) {
    const rel = at(app.dir, 'package.json');
    const m = app.manifest ?? {};
    for (const name of APP_RUNTIME) if (!m.dependencies?.[name]) add(rel, 1, 'app-manifest', `lacks the dependency ${name}`, name === 'expo-system-ui' ? 'Run npx expo install expo-system-ui (userInterfaceStyle "automatic" needs it on Android).' : `Run npx expo install ${name}${ctx.monorepo ? ` inside ${app.dir}` : ''}.`);
    for (const name of ['react', 'react-native']) {
      const spec = m.dependencies?.[name];
      if (spec !== undefined && !EXACT_VERSION.test(spec)) add(rel, 1, 'app-manifest', `${name} is "${spec}"; React and React Native are exact pins (one React in the tree)`, `Pin it exactly: npx expo install ${name} writes the SDK's exact version.`);
    }
    if (ctx.monorepo) {
      if (m.private !== true) add(rel, 1, 'app-manifest', 'an app workspace must be "private": true', 'Set "private": true.');
      if (m.type !== undefined) add(rel, 1, 'app-manifest', 'apps have no "type" field (metro.config.js is CommonJS)', 'Remove "type".');
      const names = new Set(ctx.layout.workspaces.map((ws) => ws.name).filter(Boolean));
      for (const [name, spec] of Object.entries(depsOf(m))) if (names.has(name) && spec !== '*') add(rel, 1, 'app-manifest', `${name} must be "*" (a workspace link)`, 'Use "*" for workspace packages.');
    }
    for (const [name, spec] of Object.entries(m.dependencies ?? {})) {
      if (ctx.layout.workspaces.some((ws) => ws.name === name)) continue;
      if (EXACT_VERSION.test(spec)) {
        reportOffPolicy(add, rel, name, spec, rows);
        continue;
      }
      const row = rows[name];
      if (row?.spec === spec) continue;
      add(rel, 1, 'pin-exact', `${name} is "${spec}": a range is allowed only where the dependency policy's specifier is that range (the ~ that npx expo install writes for an Expo SDK module)${row?.spec ? `; the policy says "${row.spec}"` : '; the policy has no row for it'}`, row?.spec ? `Install it as the policy says: npx expo install ${name} (or npm install ${name}@${row.version}).` : `Pin it exactly and add its row (dependency-management): npm install ${name}@<x.y.z>.`);
    }
  }
}

function checkMonorepo(ctx, add) {
  const ws = ctx.layout.workspaces;
  if (ctx.apps.length === 0) add('package.json', 1, 'workspace-layout', 'no workspace holds an Expo app (app.config.ts)', 'Move the app into apps/<app> (references/project-layout.md, When multi-package).');
  const declared = new Set(ws.map((w) => w.dir));
  for (const w of ws) if (!existsSync(join(ctx.root, w.dir, 'tsconfig.json'))) add(`${w.dir}/tsconfig.json`, 0, 'workspace-layout', 'is missing: every workspace has its own program extending the root tsconfig.base.json', 'Create it (types and include only).');
  for (const parent of new Set(ws.map((w) => w.dir.split('/')[0]).concat(['apps', 'packages']))) {
    const abs = join(ctx.root, parent);
    if (!existsSync(abs)) continue;
    for (const rel of walkRepo(ctx.root, { include: [`${parent}/*/package.json`] })) {
      const dir = posix.dirname(rel);
      if (!declared.has(dir)) add(rel, 1, 'workspace-layout', `${dir} has a package.json but no "workspaces" glob matches it, so npm never links or installs it`, 'Add it to "workspaces" (a new package is an architecture decision: ask first), or remove the folder.');
    }
  }
  checkWorkspaceScripts(ctx, add);
  const scopes = new Set(ws.map((w) => /^(@[^/]+)\//.exec(w.name ?? '')?.[1]).filter(Boolean));
  for (const w of ws.filter((item) => !ctx.apps.some((app) => app.dir === item.dir))) {
    const rel = `${w.dir}/package.json`;
    const m = w.manifest ?? {};
    if (m.private !== true || !/^@[^/]+\/[a-z0-9-]+$/.test(m.name ?? '') || scopes.size > 1) add(rel, 1, 'package-manifest', `must be private and named @<org>/<package> in the one workspace scope (found ${JSON.stringify(m.name)})`, 'Name every workspace @<org>/<name> with the same scope and set "private": true.');
    // Node tooling nothing imports (a Cloud Functions backend: its deploy bundle is "main") may have no exports map.
    const nodeTooling = m.engines?.node !== undefined || m.bin !== undefined;
    const sourceExports = same(m.exports, { './*': './src/*' }) || (typeof m.exports === 'object' && m.exports?.['./*'] === './src/*');
    if (!sourceExports && !(nodeTooling && m.exports === undefined)) add(rel, 1, 'package-manifest', 'exports must map "./*" to "./src/*" (TypeScript source, no build step, no barrel)', 'Set "exports": { "./*": "./src/*" }.');
    for (const [name, spec] of Object.entries(depsOf(m))) {
      if (ws.some((item) => item.name === name)) continue;
      if (!EXACT_VERSION.test(spec)) add(rel, 1, 'pin-exact', `${name} is "${spec}", not an exact version`, 'Pin it exactly; a native module a shared package imports is a "*" peer instead.');
      else reportOffPolicy(add, rel, name, spec, ctx.policy.packages ?? {});
    }
  }
  const versions = new Map();
  for (const app of ctx.apps) for (const [name, spec] of Object.entries(depsOf(app.manifest))) if (spec !== '*') versions.set(name, [...(versions.get(name) ?? []), `${app.dir}=${spec}`]);
  for (const [name, list] of versions) if (new Set(list.map((item) => item.split('=')[1])).size > 1) add(`${list[0].split('=')[0]}/package.json`, 1, 'app-lockstep', `${name} differs between apps: ${list.join(', ')}`, 'Move every app to the same specifier in one commit (one native module version per repo).');
  const pkg = ctx.rootManifest;
  for (const name of ['react', 'react-native']) {
    const pinned = pkg.overrides?.[name];
    if (typeof pinned !== 'string' || !EXACT_VERSION.test(pinned)) add('package.json', 1, 'root-overrides', `overrides.${name} must be the exact version the apps use`, 'Add "overrides": { "react": "<x.y.z>", "react-native": "<x.y.z>" } (one React in the tree).');
    for (const app of ctx.apps) {
      const used = app.manifest?.dependencies?.[name];
      if (pinned !== undefined && used !== undefined && used !== pinned) add('package.json', 1, 'root-overrides', `overrides.${name} is ${pinned} but ${app.dir} uses ${used}`, 'Change both in the same commit; npm ls react react-native must show one version.');
    }
  }
  for (const w of ws.filter((item) => !ctx.apps.some((app) => app.dir === item.dir))) {
    for (const [name, spec] of Object.entries(w.manifest?.peerDependencies ?? {})) {
      if (spec !== '*' || ['react', 'react-native'].includes(name)) continue;
      const specs = ctx.apps.map((app) => app.manifest?.dependencies?.[name]).filter(Boolean);
      if (specs.length === 0) continue;
      const pinned = pkg.overrides?.[name];
      if (typeof pinned !== 'string' || !EXACT_VERSION.test(pinned) || !specs.every((item) => inRange(pinned, item))) add('package.json', 1, 'root-overrides', `overrides.${name} is ${pinned ?? 'missing'}; ${w.dir} peers on it with "*", so it must be pinned at the exact version the apps install for "${specs[0]}"`, `Set "${name}": "<the version npm ls ${name} shows for the apps>" in "overrides", then npm install (a "*" peer otherwise lets npm put its newest release at the root next to the app's: duplicate native modules).`);
    }
  }
}

/** The root runs typecheck in every workspace (npm run -s typecheck --workspaces, no --if-present), so each keeps its own script. */
function checkWorkspaceScripts(ctx, add) {
  const { workspaceScripts } = multiPackageScripts();
  for (const w of ctx.layout.workspaces) {
    const isApp = ctx.apps.some((app) => app.dir === w.dir);
    const rel = `${w.dir}/package.json`;
    for (const [name, command] of Object.entries(workspaceScripts)) {
      const actual = w.manifest?.scripts?.[name];
      if (actual === command) continue;
      add(rel, lineMatching(ctx.text(rel) ?? '', new RegExp(`"${name.replace(/[:]/g, '\\:')}":`)), isApp ? 'app-manifest' : 'workspace-layout', `script "${name}" ${actual === undefined ? 'is missing' : 'differs from the canonical command'} (the root runs it in every workspace with --workspaces and fails on a workspace without it)`, `Set it to: ${command}`);
    }
  }
}

function checkNpmrcAndNode(ctx, add) {
  const npmrc = ctx.text('.npmrc');
  if (npmrc !== null) {
    for (const key of npmrcMissingPolicy(npmrc)) add('.npmrc', 1, 'npmrc-policy', `lacks the line ${key}=${NPMRC_POLICY[key]}`, 'Restore the policy lines from templates/dot-npmrc (quality-gates.json npmrcLines checks the first three too).');
    for (const hit of npmrcPolicyOverrides(npmrc)) add('.npmrc', hit.line, 'npmrc-policy', `sets ${hit.key}=${hit.value}; npm keeps the last value of a key, so this switches the policy ${hit.key}=${hit.want} off`, `Delete the line; the policy stays ${hit.key}=${hit.want} (a young release needs a dated exclude block instead).`);
    for (const hit of npmrcExcludeProblems(npmrc, ctx.today)) {
      add('.npmrc', hit.line, 'npmrc-exclude', hit.kind === 'expired' ? `exclude ${hit.pattern} is in a block that expired on ${hit.expires}` : `exclude ${hit.pattern} is not inside a dated "# exclude-block expires=YYYY-MM-DD reason=..." block`, hit.kind === 'expired' ? 'Delete the whole expired block (never extend it); the lockfile keeps the installed versions.' : 'Put it under a dated block header with the reason (dependency-management), or remove it.');
    }
  }
  const pins = [['.nvmrc', ctx.text('.nvmrc')?.trim()], ['.node-version', ctx.text('.node-version')?.trim()], ['.mise.toml', /^node\s*=\s*"([^"]+)"/m.exec(ctx.text('.mise.toml') ?? '')?.[1]], ['.tool-versions', /^nodejs\s+(\S+)/m.exec(ctx.text('.tool-versions') ?? '')?.[1]]].filter(([, value]) => value !== undefined && value !== null);
  for (const [file, value] of pins) {
    const [major, minor] = value.replace(/^v/, '').split('.').map(Number);
    if (!(major > 22 || (major === 22 && minor >= 18))) add(file, 1, 'node-pin', `pins Node "${value}", below 22.18 (app.config.ts, metro.config.js and the scripts need type stripping)`, 'Pin Node 26.4.0 (the version the stack was verified on), or the newest 26.x LTS at least 7 days old.');
  }
  if (pins.length === 0) add('.nvmrc', 0, 'node-pin', `no file pins the Node version (${NODE_PIN_FILES.join(', ')}): every machine and CI image runs whatever Node it has`, 'Write .nvmrc with 26.4.0 (templates/dot-nvmrc); CI reads it (actions/setup-node node-version-file).');
  const values = new Set(pins.map(([, value]) => value.replace(/^v/, '')));
  if (values.size > 1) add(pins[1][0], 1, 'node-pin', `Node pins disagree: ${pins.map(([file, value]) => `${file} ${value}`).join(', ')}`, 'Pin the same Node version in every file that names one.');
}

function checkIgnoresAndFormat(ctx, add) {
  const gitignore = ctx.text('.gitignore');
  if (gitignore !== null) {
    const have = new Set(gitignore.split('\n').map((line) => line.trim()));
    for (const line of template('dot-gitignore').split('\n').map((item) => item.trim()).filter((item) => item && !item.startsWith('#'))) if (!have.has(line)) add('.gitignore', 1, 'gitignore', `lacks "${line}"`, 'Append the missing line (generated native folders, build output, signing files and keys never reach git).');
  }
  const prettierrc = ctx.json('.prettierrc.json');
  if (prettierrc.ok) {
    for (const [key, value] of Object.entries(templateJson('dot-prettierrc.json'))) if (key !== '$schema' && !same(prettierrc.value[key], value)) add('.prettierrc.json', lineMatching(ctx.text('.prettierrc.json'), new RegExp(`"${key}"`)), 'prettier-config', `${key} must be ${JSON.stringify(value)}`, 'Restore the canonical Prettier options (typescript-and-lint-rules).');
  }
  const prettierignore = ctx.text('.prettierignore');
  const ignoreLines = new Set((prettierignore ?? '').split('\n').map((line) => line.trim()));
  if (prettierignore !== null) for (const line of ['package-lock.json', '/ios/', '/android/', 'skills/', '.agents/', '.claude/']) if (!ignoreLines.has(line)) add('.prettierignore', 1, 'format-ignore', `lacks "${line}"`, `Add the line ${line}.`);
  const eslint = ctx.text('eslint.config.mjs');
  if (eslint !== null) {
    if (!/noInlineConfig:\s*true/.test(eslint)) add('eslint.config.mjs', lineMatching(eslint, /linterOptions/), 'lint-ignore', 'does not switch inline eslint-disable comments off (noInlineConfig: true)', 'Restore block 0 of the canonical config; every exception is a files-scoped block.');
    for (const glob of ["'skills/**'", "'.agents/**'", "'.claude/**'"]) if (!eslint.includes(glob)) add('eslint.config.mjs', lineMatching(eslint, /globalIgnores\(/), 'lint-ignore', `globalIgnores lacks ${glob}`, `Add ${glob} to globalIgnores (installed skills hold planted bugs on purpose).`);
    const preLine = eslint.split('\n').find((line) => line.startsWith('const PRE_EXISTING = ['));
    if (preLine !== undefined && preLine.length > PRINT_WIDTH) add('eslint.config.mjs', lineMatching(eslint, /PRE_EXISTING = /), 'format-width', `the PRE_EXISTING line is ${preLine.length} characters, over Prettier's printWidth ${PRINT_WIDTH}, so format:check fails on a fresh skeleton`, 'Write one entry per line (scaffold-app.mjs does when the list is long), or run npm run format.');
  }
  const exclude = ctx.json('tsconfig.json', { jsonc: true }).value?.exclude ?? [];
  for (const entry of ctx.preExisting) {
    const line = entry.isDir ? `${entry.name}/` : entry.name;
    if (prettierignore !== null && !ignoreLines.has(line) && !ignoreLines.has(`/${line}`)) add('.prettierignore', 1, 'format-ignore', `the pre-existing ${entry.isDir ? 'folder' : 'file'} ${line} is not ignored, so Prettier would reformat the developer's files`, `Add the line ${line} (or declare it in rn-skills.config.json "layoutEntries" when it is app code).`);
    const glob = entry.isDir ? `'${entry.name}/**'` : `'${entry.name}'`;
    if (eslint !== null && !eslint.includes(glob)) add('eslint.config.mjs', lineMatching(eslint, /PRE_EXISTING = /), 'lint-ignore', `the pre-existing ${entry.isDir ? 'folder' : 'file'} ${entry.name} is not in PRE_EXISTING, so ESLint would lint it`, `Add ${glob} to PRE_EXISTING.`);
    if (holdsTypeScript(ctx.root, entry) && !exclude.some((item) => String(item).replace(/^\.\//, '').replace(/\/(\*\*(\/\*)?)?$/, '') === entry.name)) add('tsconfig.json', 1, 'tsconfig-program', `the pre-existing ${entry.isDir ? 'folder' : 'file'} ${entry.name} holds .ts files but is not in "exclude", so npm run typecheck would type-check it`, `Add "${entry.name}" to "exclude" in tsconfig.json.`);
  }
}

function checkTsconfigs(ctx, add) {
  const base = ctx.json('tsconfig.base.json', { jsonc: true });
  if (base.ok) {
    const want = templateJson('tsconfig.base.json');
    if (base.value.extends !== want.extends) add('tsconfig.base.json', 1, 'tsconfig-base', `must extend ${want.extends}`, 'Restore "extends".');
    const text = ctx.text('tsconfig.base.json');
    for (const [key, value] of Object.entries(want.compilerOptions)) {
      if (key === 'tsBuildInfoFile') continue;
      if (!same(base.value.compilerOptions?.[key], value)) add('tsconfig.base.json', lineMatching(text, new RegExp(`"${key}"`)), 'tsconfig-base', `compilerOptions.${key} must be ${JSON.stringify(value)}`, 'Restore the strict option; never loosen the shared compiler settings (typescript-and-lint-rules).');
    }
  }
  const rootTs = ctx.json('tsconfig.json', { jsonc: true });
  if (rootTs.ok) {
    const want = templateJson('tsconfig.json');
    if (!same(rootTs.value.compilerOptions?.types, want.compilerOptions.types)) add('tsconfig.json', 1, 'tsconfig-program', 'the root program must use types ["jest", "node"]', 'Restore compilerOptions.types.');
    if (!ctx.monorepo && !same(rootTs.value.compilerOptions?.paths?.['@/*'], [`./${ctx.layout.srcDir}/*`])) add('tsconfig.json', 1, 'tsconfig-program', `paths "@/*" must map to ["./${ctx.layout.srcDir}/*"] (the Expo template alias; Jest and ESLint read it)`, 'Restore compilerOptions.paths.');
    for (const glob of want.include) if (!(rootTs.value.include ?? []).includes(glob)) add('tsconfig.json', 1, 'tsconfig-program', `include lacks ${glob}`, 'Restore the include list.');
  }
  for (const app of ctx.apps) {
    const rel = ctx.monorepo ? at(app.dir, 'tsconfig.json') : posix.join(app.srcDir, 'tsconfig.json');
    const cfg = checkProgram(ctx, add, rel, { kind: 'app' });
    if (cfg === null) continue;
    if (!(cfg.include ?? []).some((glob) => /\.expo\/types\/\*\*\/\*\.ts$/.test(glob))) add(rel, lineMatching(ctx.text(rel), /"include"/), 'tsconfig-program', 'include lacks the typed-routes declarations (.expo/types/**/*.ts): every href then type-checks as a plain string', `Add "${posix.relative(posix.dirname(rel), '.expo') || '.expo'}/types/**/*.ts" to include.`);
  }
  // When multi-package, a shared package's program follows the same contract (workspace-layout reports a missing one).
  for (const ws of ctx.layout.workspaces.filter((item) => !ctx.apps.some((app) => app.dir === item.dir))) {
    const rel = `${ws.dir}/tsconfig.json`;
    // Node tooling (a package that declares engines.node or a bin) may see Node globals; app-side code never does.
    const nodeTooling = ws.manifest?.engines?.node !== undefined || ws.manifest?.bin !== undefined;
    if (existsSync(join(ctx.root, rel))) checkProgram(ctx, add, rel, { kind: nodeTooling ? 'node-tooling' : 'package' });
  }
}

/**
 * One TypeScript program below the root: it extends the shared strict base, sets only types, paths and
 * tsBuildInfoFile, and lists its types (an omitted list loads every installed @types package, @types/node
 * included). App code gets ["jest"]; a shared package may not list node unless it is Node tooling.
 */
function checkProgram(ctx, add, rel, { kind }) {
  const read = ctx.json(rel, { jsonc: true });
  if (!read.ok) {
    if (read.error === 'missing') add(rel, 0, 'tsconfig-program', 'is missing: the app program (types jest only, no Node globals) does not exist', 'Copy templates/src/tsconfig.json.');
    else add(rel, 1, 'tsconfig-program', read.error, 'Fix the JSON.');
    return null;
  }
  const cfg = read.value;
  const text = ctx.text(rel);
  const up = posix.relative(posix.dirname(rel), '.') || '.';
  if (cfg.extends !== `${up}/tsconfig.base.json`) add(rel, lineMatching(text, /"extends"/), 'tsconfig-program', `must extend ${up}/tsconfig.base.json`, 'Every program uses the shared strict base.');
  const extraKeys = Object.keys(cfg.compilerOptions ?? {}).filter((key) => !['types', 'paths', 'tsBuildInfoFile'].includes(key));
  if (extraKeys.length) add(rel, lineMatching(text, new RegExp(`"${extraKeys[0]}"`)), 'tsconfig-program', `sets ${extraKeys.join(', ')}; a program may only set types, paths and tsBuildInfoFile`, 'Remove them; change shared options in tsconfig.base.json with a Gate-Change trailer.');
  const types = cfg.compilerOptions?.types;
  const typesLine = lineMatching(text, /"types"/);
  if (kind === 'app') {
    if (!same(types, ['jest'])) add(rel, typesLine, 'tsconfig-program', 'the app program must use types ["jest"] (no Node globals in app code)', 'Set "types": ["jest"].');
  } else if (!Array.isArray(types)) {
    add(rel, typesLine, 'tsconfig-program', 'sets no compilerOptions.types, so TypeScript loads every installed @types package (@types/node included) into this program', 'List the types the package uses: ["jest"] for app-side code.');
  } else if (kind === 'package' && types.includes('node')) {
    add(rel, typesLine, 'tsconfig-program', 'lists types "node" in a package the app imports: Node globals (process, Buffer, require) then type-check in code that runs on a phone', 'Remove "node"; a Node tooling package declares "engines": { "node": ... } (or a "bin") in its package.json.');
  }
  return cfg;
}

function checkPolicyLists(ctx, add) {
  const banned = Array.isArray(ctx.policy.banned) ? ctx.policy.banned : [];
  const doNotAdd = Array.isArray(ctx.policy.doNotAdd) ? ctx.policy.doNotAdd : [];
  const manifests = [['package.json', ctx.rootManifest], ...ctx.layout.workspaces.map((ws) => [`${ws.dir}/package.json`, ws.manifest ?? {}])];
  for (const [rel, m] of manifests) {
    for (const name of Object.keys({ ...depsOf(m), ...(m.peerDependencies ?? {}) })) {
      const hit = banned.find((row) => new RegExp(row.pattern).test(name));
      if (hit) add(rel, 1, 'banned', `${name} is banned: ${hit.reason}`, `Remove it (npm uninstall ${name}); use instead: ${hit.useInstead ?? 'see the dependency policy'}.`);
      else if (doNotAdd.includes(name)) add(rel, 1, 'banned', `${name} is on the dependency policy's doNotAdd list`, `Remove it (npm uninstall ${name}); the dependency-management skill says what replaces it.`);
    }
  }
}

/** Relative .ts imports in a config Node loads with type stripping. */
const RELATIVE_IMPORT = /from\s+['"](\.{1,2}\/[^'"]+)['"]/g;

function checkApps(ctx, add) {
  for (const app of ctx.apps) {
    const configRel = at(app.dir, 'app.config.ts');
    // @expo/config (SDK 57) loads the first dynamic config in the order .ts .mts .cts .mjs .cjs .js, and passes
    // app.config.json (else app.json, the leftover rule) into it as the static base.
    for (const other of ['app.config.mts', 'app.config.cts', 'app.config.mjs', 'app.config.cjs', 'app.config.js', 'app.config.json']) {
      if (existsSync(join(ctx.root, app.dir, other))) add(at(app.dir, other), 1, 'app-config', other === 'app.config.json' ? 'sits next to app.config.ts; Expo reads app.config.json as the static base it passes into app.config.ts (like app.json), so its values are merged into the config unseen' : `sits next to app.config.ts; Expo loads app.config.ts first and never reads ${other}, so an edit there changes nothing`, `Move the values you still need into app.config.ts, then delete ${other}; app.config.ts is the only app config.`);
    }
    const source = ctx.text(configRel);
    // Comments are blanked (lines kept), so a sentence that names a key never counts as setting it.
    const config = source === null ? null : maskComments(source);
    if (config === null) {
      add(configRel, 0, 'app-config', 'is missing: the app has no typed, variant-aware config', 'Copy templates/app.config.ts and fill its identity (scaffold-app.mjs does).');
    } else {
      for (const match of config.matchAll(RELATIVE_IMPORT)) if (!/\.(ts|json)$/.test(match[1])) add(configRel, lineMatching(config, new RegExp(match[1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))), 'app-config', `imports ${match[1]} without its .ts extension: Node loads app.config.ts with type stripping and fails with "Cannot find module"`, `Import '${match[1]}.ts'.`);
      if (!/^export default /m.test(config)) add(configRel, 1, 'app-config', 'has no default export (Expo reads the default export)', 'Export the config function as the default export.');
      for (const [pattern, what] of [[/reactCompiler:\s*true/, 'experiments.reactCompiler: true (the React Compiler; no hand-written memo)'], [/typedRoutes:\s*true/, 'experiments.typedRoutes: true'], [/userInterfaceStyle:\s*'automatic'/, "userInterfaceStyle: 'automatic' (light and dark follow the system)"], [/resolveAppVariant\(process\.env\)/, 'resolveAppVariant(process.env) (one variant resolver for the config and the bundle)']]) {
        if (!pattern.test(config)) add(configRel, 1, 'app-config', `lacks ${what}`, 'Restore it from templates/app.config.ts.');
      }
      const appId = /appId:\s*'([^']*)'/.exec(config)?.[1];
      const idLine = lineMatching(config, /appId:/);
      if (appId === undefined) add(configRel, 1, 'app-id', 'declares no production identity appId (one id for iOS and Android; the variants extend it)', "Declare const BASE: VariantIdentity = { appId: 'com.<org>.<app>', name, scheme }.");
      else {
        const problems = ['ios', 'android'].map((platform) => bundleIdProblem(appId, { platform })).filter(Boolean);
        const isTemplateId = placeholdersIn(appId).some((entry) => entry.id === 'template-bundle-id');
        if (isTemplateId) ctx.note(`NOTE ${configRel}:${idLine} [app-id] ${appId} is the template id: the ship gates refuse it; set the registered id before the first store build`);
        else if (problems.length) add(configRel, idLine, 'app-id', `appId: ${problems[0]}`, 'Set the reverse-DNS id registered with App Store Connect and Google Play (lower case letters and digits, dot-separated, each part starting with a letter).');
        else if (appId !== appId.toLowerCase()) add(configRel, idLine, 'app-id', `appId ${appId} has capitals; the variant ids and the Android package should be lower case`, 'Use a lower-case id.');
        else if (reservedIdPartProblem(appId)) add(configRel, idLine, 'app-id', `appId ${appId}: ${reservedIdPartProblem(appId)}`, 'Register an id whose parts are not Kotlin or Java keywords (com.acme.classes, not com.acme.class).');
      }
      if (!/bundleIdentifier:\s*\S/.test(config) || !/\bpackage:\s*\S/.test(config)) add(configRel, 1, 'platforms', 'does not set both ios.bundleIdentifier and android.package from the identity: one platform builds with no id (prebuild asks interactively or fails in CI)', 'Set ios.bundleIdentifier and android.package to identity.appId.');
      if (!/adaptiveIcon:\s*\{/.test(config)) add(configRel, 1, 'platforms', 'sets no android.adaptiveIcon: Android launchers crop the legacy icon into a circle or squircle', 'Restore android.adaptiveIcon (foreground, background and monochrome layers) from templates/app.config.ts.');
      for (const match of config.matchAll(/['`](\.\/assets\/[^'`$]+)['`]/g)) {
        if (!existsSync(join(ctx.root, app.dir, match[1]))) add(at(app.dir, match[1].slice(2)), 0, 'app-files', `is named by app.config.ts but does not exist: prebuild and EAS Build stop with ENOENT`, 'Run scaffold-app.mjs --write (it draws placeholder art), or add the file (icons-app-icon-and-splash).');
      }
      for (const match of config.matchAll(/`\$\{folder\}\/([^`]+)`/g)) {
        const storeIcon = match[1].includes('${STORE_IOS_ICON}');
        for (const variant of storeIcon ? ['production'] : ['development', 'preview', 'production']) {
          const rel = at(app.dir, `assets/icons/${variant}/${match[1].replace('${STORE_IOS_ICON}', /STORE_IOS_ICON = '([^']+)'/.exec(config)?.[1] ?? 'icon.png')}`);
          if (!existsSync(join(ctx.root, rel))) add(rel, 0, 'app-files', 'is an icon app.config.ts names for a variant but does not exist: prebuild and EAS Build stop with ENOENT', 'Run scaffold-app.mjs --write (it draws placeholder art for every variant), or add the file (icons-app-icon-and-splash).');
        }
      }
    }
    const metroRel = at(app.dir, 'metro.config.js');
    const metro = ctx.text(metroRel);
    if (metro === null) add(metroRel, 0, 'metro-cache', 'is missing: Metro\'s cache is shared by every build on the machine and is not keyed on the variant', 'Copy templates/metro.config.js and templates/scripts/metro/.');
    else if (!/config\.cacheVersion\s*=.*(publicEnvCacheVersion|EXPO_PUBLIC)/.test(metro)) add(metroRel, lineMatching(metro, /cacheVersion|module\.exports/), 'metro-cache', 'Metro\'s cacheVersion is not keyed on the EXPO_PUBLIC_* values: a production export can reuse development transforms (the variant and test-only code included)', 'Set config.cacheVersion = publicEnvCacheVersion(process.env) (templates/metro.config.js).');
    const layoutRel = posix.join(app.routesDir, '_layout.tsx');
    if (!existsSync(join(ctx.root, layoutRel))) add(layoutRel, 0, 'app-files', 'is missing: Expo Router has no root layout to render the routes in', 'Copy templates/src/app/_layout.tsx (app-startup-and-bootstrap later replaces it with the root skeleton).');
    const variantRel = posix.join(app.srcDir, 'config', 'app-variant.ts');
    if (!existsSync(join(ctx.root, variantRel))) add(variantRel, 0, 'app-files', 'is missing: app.config.ts and the bundle resolve the variant through it', 'Copy templates/src/config/app-variant.ts and its test.');
    const appEnvRel = posix.join(app.srcDir, 'app-env.d.ts');
    const appEnv = ctx.text(appEnvRel);
    if (appEnv === null || !/declare const process/.test(appEnv)) add(appEnvRel, appEnv === null ? 0 : 1, 'app-env', appEnv === null ? 'is missing: the app program has no process declaration for EXPO_PUBLIC_* dot access' : 'does not `declare const process` for EXPO_PUBLIC_* dot access', 'Copy templates/src/app-env.d.ts.');
    const envRel = posix.join(app.srcDir, 'env.d.ts');
    const env = ctx.text(envRel);
    if (env === null || !env.includes('EXPO_PUBLIC_APP_VARIANT')) add(envRel, env === null ? 0 : 1, 'app-env', 'does not declare EXPO_PUBLIC_APP_VARIANT (every public variable is declared and typed)', 'Copy templates/src/env.d.ts.');
  }
}

function checkGates(ctx, add) {
  const knip = ctx.json('knip.json');
  const knipWant = templateJson('knip.json');
  if (knip.ok) {
    if (!same(knip.value.rules, knipWant.rules)) add('knip.json', lineMatching(ctx.text('knip.json'), /"rules"/), 'knip-config', 'rules must list every issue type as "error" (cycles defaults to warn, which never fails)', 'Restore the rules block.');
    const ignore = Array.isArray(knip.value.ignore) ? knip.value.ignore : [];
    const mayIgnore = new Set([...knipWant.ignore, ...ctx.preExisting.map((entry) => (entry.isDir ? `${entry.name}/**` : entry.name))]);
    for (const glob of knipWant.ignore) if (!ignore.includes(glob)) add('knip.json', lineMatching(ctx.text('knip.json'), /"ignore"/), 'knip-config', `"ignore" lacks "${glob}": knip's Jest plugin falls back to Jest's default test globs and analyses installed skills' templates and fixtures (hundreds of "Unlisted dependencies")`, `Add "${glob}" to "ignore".`);
    for (const glob of ignore.filter((entry) => !mayIgnore.has(entry))) add('knip.json', lineMatching(ctx.text('knip.json'), new RegExp(JSON.stringify(glob).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))), 'knip-config', `"ignore" lists ${glob}; only agent folders and pre-existing top-level entries may be ignored (a wider ignore hides dead code)`, 'Remove it; fix the unused file, export or dependency instead (ignoreDependencies with a reason in contracts/knip-ignores.json for a tool knip cannot see).');
    if (ctx.monorepo) for (const ws of ctx.layout.workspaces.filter((item) => !ctx.apps.some((app) => app.dir === item.dir))) if (knip.value.workspaces?.[ws.dir]?.includeEntryExports !== true) add('knip.json', 1, 'knip-config', `workspaces.${ws.dir}.includeEntryExports must be true (its exports map makes every file an entry, so dead files are never reported otherwise)`, 'Set it.');
  }
  const lefthook = ctx.text('lefthook.yml');
  if (lefthook !== null) {
    for (const line of ['assert_lefthook_installed: true', 'name: no-secrets', 'run: node scripts/git/check-commit-message.ts {1}', 'run: npm run verify', 'run: npm run -s typecheck']) if (!lefthook.includes(line)) add('lefthook.yml', 1, 'lefthook', `lacks "${line}"`, 'Restore the hook from templates/lefthook.yml (quality-gates).');
  }
  const settings = ctx.json('.claude/settings.json');
  if (settings.ok) {
    const s = settings.value;
    for (const rule of ['Read(**/*.p8)', 'Read(**/*.keystore)', 'Read(**/credentials.json)', 'Bash(git commit *--no-verify*)', 'Bash(git push *--no-verify*)']) if (!(s.permissions?.deny ?? []).includes(rule)) add('.claude/settings.json', 1, 'claude-settings', `permissions.deny lacks ${rule}`, 'Restore the deny list from the template.');
    const stop = JSON.stringify(s.hooks?.Stop ?? []);
    const post = JSON.stringify(s.hooks?.PostToolUse ?? []);
    if (!stop.includes('check:fast') || !stop.includes('exit 2')) add('.claude/settings.json', 1, 'claude-settings', 'the Stop hook must run npm run -s check:fast and exit 2 on failure (an agent never stops on a red tree)', 'Restore hooks.Stop from the template.');
    if (!post.includes('Edit|Write') || !post.includes('scripts/hooks/after-edit.ts')) add('.claude/settings.json', 1, 'claude-settings', 'the PostToolUse Edit|Write hook must run scripts/hooks/after-edit.ts', 'Restore hooks.PostToolUse from the template (node "$(git rev-parse --show-toplevel)/scripts/hooks/after-edit.ts").');
    for (const rule of s.permissions?.ask ?? []) if (/^Edit\(\*\*\//.test(rule)) add('.claude/settings.json', 1, 'gate-scope', `permissions.ask has ${rule}, which also prompts for every matching file inside installed skills`, 'Anchor it at the repo root (Edit(/tsconfig*.json), Edit(/src/tsconfig.json)) in both .claude/settings.json and quality-gates.json.');
  }
  const gates = ctx.json('quality-gates.json');
  if (gates.ok) {
    const g = gates.value;
    for (const [name, command] of Object.entries(g.npmScripts ?? {})) if (ctx.rootManifest.scripts?.[name] !== command) add('quality-gates.json', 1, 'quality-gates', `npmScripts.${name} differs from package.json`, 'Restore the script; never edit quality-gates.json to match a weakened gate (a Gate-Change trailer changes both together).');
    if (settings.ok) {
      for (const key of ['deny', 'ask']) if (!same(g.claudeSettings?.permissions?.[key], settings.value.permissions?.[key])) add('quality-gates.json', 1, 'quality-gates', `claudeSettings.permissions.${key} differs from .claude/settings.json`, 'Make both lists identical (the guardrail compares them).');
      if (!same(g.claudeSettings?.hooks, settings.value.hooks)) add('quality-gates.json', 1, 'quality-gates', 'claudeSettings.hooks differs from .claude/settings.json', 'Make both identical.');
    }
    const npmrc = (ctx.text('.npmrc') ?? '').split('\n').map((line) => line.trim());
    for (const line of g.npmrcLines ?? []) if (!npmrc.includes(line)) add('quality-gates.json', 1, 'quality-gates', `npmrcLines lists "${line}" but .npmrc lacks it`, 'Restore the .npmrc line.');
    if (knip.ok && g.knip?.rules !== undefined && !same(g.knip.rules, knip.value.rules)) add('quality-gates.json', 1, 'quality-gates', 'knip.rules differs from knip.json', 'Make both identical.');
    const base = ctx.json('tsconfig.base.json', { jsonc: true });
    if (base.ok) for (const [key, value] of Object.entries(g.typescript?.shared ?? {})) if (!same(base.value.compilerOptions?.[key], value)) add('quality-gates.json', 1, 'quality-gates', `typescript.shared.${key} differs from tsconfig.base.json`, 'Keep the strict options identical in both files.');
  }
  const stryker = ctx.json('stryker.config.json');
  if (stryker.ok) {
    const ignored = Array.isArray(stryker.value.ignorePatterns) ? stryker.value.ignorePatterns : [];
    for (const folder of AGENT_FOLDERS) if (!ignored.includes(folder)) add('stryker.config.json', lineMatching(ctx.text('stryker.config.json'), /"ignorePatterns"/), 'stryker-config', `ignorePatterns lacks "${folder}": Stryker copies it into every sandbox (thousands of skill files)`, `Add "${folder}" to ignorePatterns.`);
  }
  const gatedRel = posix.join(ctx.layout.scriptsDir, 'quality', 'gated-paths.ts');
  const gated = ctx.text(gatedRel);
  if (gated !== null && !['skills/', '.agents/', '.claude/'].every((folder) => gated.includes(`'${folder}'`) && /AGENT_FOLDERS/.test(gated))) add(gatedRel, lineMatching(gated, /AGENT_FOLDERS|isGatedFile/), 'gate-scope', 'gated-path matching does not keep wildcard patterns out of the agent folders (skills/, .agents/, .claude/): an edit to an installed skill would demand a Gate-Change trailer', 'Restore scripts/quality/gated-paths.ts from the template (AGENT_FOLDERS and isGatedFile).');
  checkAgents(ctx, add);
}

/**
 * AGENTS.md is the session contract every coding agent reads; CLAUDE.md imports it so nothing is
 * written twice. An app nested inside a larger repository whose root holds the agent files sets
 * rn-skills.config.json "agentInstructions": "parent-repo"; a folder between the app and the enclosing
 * repository's top level (the first ancestor holding .git) must then hold AGENTS.md. The walk never
 * passes that top level, the user's home folder or the filesystem root, so an unrelated ~/AGENTS.md
 * or /tmp/AGENTS.md never counts.
 */
function parentRepoAgents(root) {
  if (existsSync(join(root, '.git'))) return { found: null, why: 'the app root is itself the git top level (it holds .git), so there is no enclosing repository' };
  const home = resolve(homedir());
  for (let dir = dirname(root); dir !== dirname(dir) && dir !== home; dir = dirname(dir)) {
    if (existsSync(join(dir, 'AGENTS.md'))) return { found: dir, why: '' };
    if (existsSync(join(dir, '.git'))) return { found: null, why: `the enclosing repository's top level ${dir} holds no AGENTS.md, and no folder between it and the app does` };
  }
  return { found: null, why: 'no enclosing git repository (no ancestor below the home folder holds .git)' };
}

/** True when link is a symlink that resolves to the same file as target. */
function linksTo(link, target) {
  try {
    return lstatSync(link).isSymbolicLink() && existsSync(target) && realpathSync(link) === realpathSync(target);
  } catch {
    return false;
  }
}

function checkAgents(ctx, add) {
  if (ctx.layout.config.agentInstructions === 'parent-repo') {
    const { found, why } = parentRepoAgents(ctx.root);
    if (found === null) add('rn-skills.config.json', 1, 'agents', `"agentInstructions": "parent-repo" but no enclosing folder of the repository holds AGENTS.md: ${why}`, 'Write AGENTS.md (templates/AGENTS.md) at the app root and remove the key, or add it to the enclosing repository.');
    return;
  }
  const agents = ctx.text('AGENTS.md');
  const claude = ctx.text('CLAUDE.md');
  if (agents === null) add('AGENTS.md', 0, 'agents', 'is missing: agents get no session contract (start green, stop and ask, never bypass a hook)', 'Copy templates/AGENTS.md (scaffold-app.mjs fills the app name).');
  else if (!agents.includes('npm run -s check:fast')) add('AGENTS.md', 1, 'agents', 'does not tell a session to start from a green npm run -s check:fast', 'Copy AGENTS.md from the template.');
  if (claude === null) add('CLAUDE.md', 0, 'agents', 'is missing: Claude Code reads CLAUDE.md, not AGENTS.md', 'Write the one line @AGENTS.md (templates/CLAUDE.md).');
  // A CLAUDE.md symlink to AGENTS.md also gives one source (the import line is the default: references/root-files.md).
  else if (linksTo(join(ctx.root, 'CLAUDE.md'), join(ctx.root, 'AGENTS.md'))) return;
  else if (!claude.split('\n').some((line) => line.trim() === '@AGENTS.md')) add('CLAUDE.md', 1, 'agents', 'must import AGENTS.md with the line @AGENTS.md (one source for every agent)', 'Add the line @AGENTS.md.');
}

function checkLockfile(ctx, add) {
  const read = ctx.json('package-lock.json');
  if (!read.ok) return read.error === 'missing' ? undefined : add('package-lock.json', 1, 'lockfile', read.error, 'Regenerate it with npm install and commit it.');
  const lock = read.value;
  if (lock.lockfileVersion !== 3) add('package-lock.json', 1, 'lockfile', `lockfileVersion is ${lock.lockfileVersion}, expected 3 (npm 11)`, 'Reinstall with the pinned npm (engine-strict).');
  if (!same(depsOf(lock.packages?.[''] ?? {}), depsOf(ctx.rootManifest))) add('package-lock.json', 1, 'lockfile', 'the root dependencies differ from package.json (the lockfile is stale)', 'Run npm install, then commit package.json and package-lock.json together.');
  for (const ws of ctx.layout.workspaces) {
    const entry = lock.packages?.[ws.dir];
    if (!entry) add('package-lock.json', 1, 'lockfile', `has no entry for the workspace ${ws.dir}`, 'Run npm install at the root and commit the lockfile.');
    else if (!same(depsOf(entry), depsOf(ws.manifest))) add('package-lock.json', 1, 'lockfile', `dependencies of ${ws.dir} differ from its package.json`, 'Run npm install at the root and commit the lockfile.');
  }
  const allow = ctx.rootManifest.allowScripts ?? {};
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry.hasInstallScript || !path.includes('node_modules/') || entry.inBundle) continue;
    // Optional packages for another platform are in the lockfile but never installed or run.
    if (entry.optional && !existsSync(join(ctx.root, path))) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!Object.keys(allow).some((key) => key === name || key === `${name}@${entry.version}`)) add('package.json', 1, 'install-scripts', `${name}@${entry.version} has an install script that allowScripts does not cover`, `Read what the script does (npm view ${name}@${entry.version} scripts), then npm approve-scripts ${name} (or npm deny-scripts ${name}).`);
  }
  const installedAs = (name) => new Set(Object.entries(lock.packages ?? {}).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)).map(([, entry]) => entry.version));
  for (const name of ['react', 'react-native']) {
    const found = installedAs(name);
    const declared = ctx.monorepo ? ctx.rootManifest.overrides?.[name] : ctx.apps[0]?.manifest?.dependencies?.[name];
    // A range in the manifest is app-manifest's finding; here only an exact pin is compared.
    const pinned = typeof declared === 'string' && EXACT_VERSION.test(declared) ? declared : undefined;
    if (found.size > 1 || (pinned && found.size === 1 && !found.has(pinned))) add('package-lock.json', 1, 'one-react', `${name} is installed as ${[...found].join(', ')}; the tree must hold exactly ${pinned ?? 'one version'}`, `${ctx.monorepo ? 'Fix "overrides" in the root package.json' : 'Pin it exactly in package.json'} and reinstall; check with npm ls react react-native.`);
  }
  for (const [name, pinned] of Object.entries(ctx.rootManifest.overrides ?? {})) {
    const found = [...installedAs(name)].sort();
    if (found.length > 0 && (found.length > 1 || found[0] !== pinned)) add('package-lock.json', 1, 'root-overrides', `${name} is installed as ${found.join(', ')} but "overrides" pins ${pinned} (the lockfile predates the override)`, `Run npm install so the override applies, then commit the lockfile; npm ls ${name} must show only ${pinned}.`);
  }
}

function checkLeftoversAndPlaceholders(ctx, add) {
  for (const app of ctx.apps) {
    const dir = app.dir === '.' ? ctx.root : join(ctx.root, app.dir);
    for (const item of leftoversIn(dir, { routesDir: posix.relative(app.dir, app.routesDir) })) add(at(app.dir, item.rel), 0, 'template-leftover', `is a template leftover: ${item.why}`, item.fix);
  }
  const files = ['package.json', 'app.config.ts', 'AGENTS.md', 'eslint.config.mjs', '.prettierignore', ...ctx.apps.map((app) => at(app.dir, 'app.config.ts'))];
  const scanned = new Set(files);
  for (const app of ctx.apps) for (const rel of walkRepo(ctx.root, { include: [`${app.srcDir}/**/*.{ts,tsx,json}`] })) scanned.add(rel);
  for (const rel of [...scanned].sort()) {
    const text = ctx.text(rel);
    if (text === null) continue;
    for (const match of text.matchAll(TEMPLATE_TOKEN)) {
      if (NOT_PLACEHOLDERS.has(match[0])) continue;
      add(rel, text.slice(0, match.index).split('\n').length, 'placeholder', `holds the unfilled template placeholder ${match[0]}`, 'Fill it (scaffold-app.mjs fills __APP_ID__, __APP_NAME__, __APP_SLUG__ and __APP_SCHEME__ from its options).');
    }
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const target = positionals[0] ?? '.';
  const root = requireDir(target, 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${target} has no package.json`, 'Scaffold the app first: node scaffold-app.mjs . --app-id <id> --name <name> --write');
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail(`--today "${today}" is not YYYY-MM-DD`, 'Pass a date such as 2026-10-14.');
  const report = createReporter({ name: 'check-skeleton', json: options.json });
  const add = (file, line, rule, message, fix) => report.problem({ file, line, rule, message, fix });
  const ctx = { ...context(root, today), note: (text) => report.note(text) };
  checkRootFiles(ctx, add);
  checkRootManifest(ctx, add);
  checkAppManifests(ctx, add);
  if (ctx.monorepo) checkMonorepo(ctx, add);
  checkNpmrcAndNode(ctx, add);
  checkIgnoresAndFormat(ctx, add);
  checkTsconfigs(ctx, add);
  checkPolicyLists(ctx, add);
  checkApps(ctx, add);
  checkGates(ctx, add);
  checkLockfile(ctx, add);
  checkLeftoversAndPlaceholders(ctx, add);
  return report.finish({ checked: ctx.rootFiles.length + ctx.apps.length + ctx.layout.workspaces.length, unit: 'root files and apps' });
});

