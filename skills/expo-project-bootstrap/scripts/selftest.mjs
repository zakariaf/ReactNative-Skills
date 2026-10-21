#!/usr/bin/env node
// selftest.mjs: proves both scripts of this skill against tests/fixtures/.
//   scaffold-app.mjs: plans a folder with pre-existing files (merging .gitignore, the agent settings
//   and CLAUDE.md), reports conflicts and template leftovers, refuses bad options.
//   check-skeleton.mjs: passes a repo generated from this skill's templates at test time (so the
//   shipped templates are what is tested), with a pre-existing docs/ folder and a lockfile shaped
//   like npm 11 writes it, and fails each planted bug (tests/fixtures/check-skeleton/bad-*/).
//   check-skeleton.mjs, multi-package: the same repo moved into npm workspaces (apps/tasks and
//   packages/ui, with the workspace forms of the scripts) passes, and the workspace rules catch their
//   planted bugs.
//   check-skeleton.mjs, nested: an app inside a larger repository takes its AGENTS.md from there, and
//   only from a folder up to that repository's top level (.git).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { renderedFiles, variablesFrom } from './lib/bootstrap-plan.mjs';
import { runSelftest } from './check-lib.mjs';

const TODAY = ['--today', '2026-10-14'];
const VARS = variablesFrom({ appId: 'com.acme.tasks', name: 'Tasks' });
// The root base as a workspace program extends it, two folders up (built from parts on purpose).
const ROOT_BASE = ['..', '..', 'tsconfig.base.json'].join('/');
// The scripts that take another form when multi-package (root and every workspace); export:audit runs in apps/tasks.
const MULTI_FILE = JSON.parse(readFileSync(new URL('../assets/package-scripts.multi-package.json', import.meta.url), 'utf8'));
const fillApp = (command) => command.replaceAll('<app-dir>', 'apps/tasks').replaceAll('<to-root>', ['..', '..'].join('/'));
const MULTI = { ...MULTI_FILE, scripts: Object.fromEntries(Object.entries(MULTI_FILE.scripts).map(([name, command]) => [name, fillApp(command)])) };

const write = (dir, rel, content) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
};
const readJson = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));
const writeJson = (dir, rel, value) => write(dir, rel, `${JSON.stringify(value, null, 2)}\n`);

/** A package-lock.json as npm 11 writes it, for the manifests of the repo (only what the checker reads). */
function writeLockfile(dir, workspaces = []) {
  const root = readJson(dir, 'package.json');
  const entry = (manifest) => Object.fromEntries(Object.entries({ name: manifest.name, version: manifest.version, dependencies: manifest.dependencies, devDependencies: manifest.devDependencies, peerDependencies: manifest.peerDependencies }).filter(([, value]) => value !== undefined));
  const packages = { '': { ...entry(root), ...(root.workspaces ? { workspaces: root.workspaces } : {}) } };
  for (const ws of workspaces) packages[ws] = entry(readJson(dir, `${ws}/package.json`));
  const exact = (spec) => spec.replace(/^[~^]/, '');
  const runtime = workspaces.length ? readJson(dir, 'apps/tasks/package.json').dependencies : root.dependencies;
  for (const name of ['react', 'react-native', 'react-native-reanimated']) packages[`node_modules/${name}`] = { version: exact(runtime[name]) };
  for (const [name, version] of Object.entries(root.overrides ?? {})) if (name.startsWith('@typescript-eslint/')) packages[`node_modules/${name}`] = { version, dev: true };
  packages['node_modules/lefthook'] = { version: '2.1.14', dev: true, hasInstallScript: true };
  packages['node_modules/unrs-resolver'] = { version: '1.12.2', dev: true, hasInstallScript: true };
  // An optional macOS package npm did not install here: never counted as a pending install script.
  packages['node_modules/fsevents'] = { version: '2.3.3', dev: true, optional: true, hasInstallScript: true };
  writeJson(dir, 'package-lock.json', { name: root.name, version: root.version, lockfileVersion: 3, requires: true, packages });
}

/** The skeleton exactly as scaffold-app.mjs --write produces it, in a folder that already held docs/. */
function writeSkeleton(dir) {
  write(dir, 'docs/notes.md', '# Notes from before the app\n');
  write(dir, 'docs/sketch.ts', 'export const sketch = 1\n');
  for (const file of renderedFiles(dir, VARS)) write(dir, file.rel, file.content);
  writeLockfile(dir);
}

/** The same app moved into npm workspaces: apps/tasks (the Expo app) and packages/ui (a shared package). */
function moveIntoWorkspaces(dir) {
  const root = readJson(dir, 'package.json');
  mkdirSync(join(dir, 'apps', 'tasks'), { recursive: true });
  for (const rel of ['app.config.ts', 'metro.config.js', 'src', 'assets']) renameSync(join(dir, rel), join(dir, 'apps', 'tasks', rel));
  rmSync(join(dir, 'apps', 'tasks', 'src', 'tsconfig.json'));
  writeJson(dir, 'apps/tasks/tsconfig.json', { extends: ROOT_BASE, compilerOptions: { types: ['jest'], paths: { '@/*': ['./src/*'] } }, include: ['**/*', '.expo/types/**/*.ts'] });
  writeJson(dir, 'apps/tasks/package.json', { name: '@acme/tasks', version: '1.0.0', private: true, main: 'expo-router/entry', scripts: { start: 'expo start', android: 'expo start --android', ios: 'expo start --ios', web: 'expo start --web', ...MULTI.workspaceScripts }, dependencies: { '@acme/ui': '*', ...root.dependencies } });
  writeJson(dir, 'packages/ui/package.json', { name: '@acme/ui', version: '1.0.0', private: true, type: 'module', exports: { './*': './src/*' }, scripts: { ...MULTI.workspaceScripts }, peerDependencies: { react: '*', 'react-native': '*', 'react-native-reanimated': '*' } });
  writeJson(dir, 'packages/ui/tsconfig.json', { extends: ROOT_BASE, compilerOptions: { types: ['jest'] }, include: ['src/**/*'] });
  write(dir, 'packages/ui/src/press-scale.ts', 'export const PRESS_SCALE = 0.96;\n');
  const { dependencies, ...rest } = root;
  writeJson(dir, 'package.json', { ...rest, scripts: { ...rest.scripts, ...MULTI.scripts }, workspaces: ['apps/*', 'packages/*'], overrides: { ...root.overrides, react: dependencies.react, 'react-native': dependencies['react-native'], 'react-native-reanimated': dependencies['react-native-reanimated'] } });
  const gates = readJson(dir, 'quality-gates.json');
  writeJson(dir, 'quality-gates.json', { ...gates, npmScripts: { ...gates.npmScripts, ...MULTI.scripts } });
  const knip = readJson(dir, 'knip.json');
  writeJson(dir, 'knip.json', { ...knip, workspaces: { 'packages/ui': { includeEntryExports: true } } });
  writeLockfile(dir, ['apps/tasks', 'packages/ui']);
}

/**
 * An app nested in a larger repository whose root holds AGENTS.md ("agentInstructions": "parent-repo").
 * The .git folder marks the enclosing repository's top level, where the checker's walk stops, so the
 * result never depends on an AGENTS.md above the temporary folder.
 */
function writeNestedApp(dir) {
  write(dir, '.git/HEAD', 'ref: refs/heads/main\n');
  write(dir, 'AGENTS.md', '# Rules for every agent in this repository\n');
  const app = join(dir, 'app');
  writeSkeleton(app);
  rmSync(join(app, 'AGENTS.md'));
  rmSync(join(app, 'CLAUDE.md'));
  writeJson(app, 'rn-skills.config.json', { agentInstructions: 'parent-repo' });
}

/**
 * A display name with an apostrophe renders as the string literal Prettier prints ("Tom's Tasks" in
 * double quotes), and the AGENTS.md heading keeps it as written. Checked before the suites, because a
 * scaffold-app case sees only the plan, never the rendered file.
 */
function checkNameRendering() {
  const files = renderedFiles(join(tmpdir(), 'rn-skills-bootstrap-no-such-folder'), variablesFrom({ appId: 'com.acme.tasks', name: "Tom's Tasks" }));
  const text = (rel) => files.find((file) => file.rel === rel)?.content ?? '';
  const problems = [];
  if (!text('app.config.ts').includes(`  name: "Tom's Tasks",\n`)) problems.push('app.config.ts does not hold  name: "Tom\'s Tasks", (tsStringLiteral, Prettier\'s quote choice)');
  if (!text('AGENTS.md').startsWith("# Tom's Tasks: ")) problems.push('AGENTS.md does not start with the heading # Tom\'s Tasks:');
  for (const problem of problems) console.log(`FAIL scripts/lib/bootstrap-plan.mjs [name-render] ${problem}`);
  if (problems.length) {
    console.log(`RESULT: FAIL (${problems.length} problems)`);
    process.exit(1);
  }
  console.log('ok   name rendering ("Tom\'s Tasks" in app.config.ts and AGENTS.md)');
}

checkNameRendering();

await runSelftest(import.meta.url, [
  {
    script: 'scaffold-app.mjs',
    fixtures: '../tests/fixtures/scaffold-app',
    args: (dir) => [dir, '--app-id', 'com.acme.tasks', '--name', 'Tasks'],
  },
  {
    script: 'check-skeleton.mjs',
    fixtures: '../tests/fixtures/check-skeleton',
    args: (dir) => [dir, ...TODAY],
    base: [{ build: async (dir) => writeSkeleton(dir) }],
  },
  {
    script: 'check-skeleton.mjs',
    fixtures: '../tests/fixtures/check-skeleton-monorepo',
    args: (dir) => [dir, ...TODAY],
    base: [{ build: async (dir) => { writeSkeleton(dir); moveIntoWorkspaces(dir); } }],
  },
  {
    script: 'check-skeleton.mjs',
    fixtures: '../tests/fixtures/check-skeleton-nested',
    args: (dir) => [join(dir, 'app'), ...TODAY],
    base: [{ build: async (dir) => writeNestedApp(dir) }],
  },
]);
