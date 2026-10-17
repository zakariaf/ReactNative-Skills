#!/usr/bin/env node
// workspaces.selftest.mjs: the self-test of lib/workspaces.mjs, lib/object-literal.mjs and
// lib/ts-literal.mjs. Prints ok / FAIL lines and the RESULT line.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createReporter, makeTempDir, maskComments, parseArgs, removeTempDir, run } from '../check-lib.mjs';
import { callObjectArgument, childObject, extractBlock, topLevelEntries } from './object-literal.mjs';
import { LiteralError, findConstInitializer, parseObjectEntries, parseValue } from './ts-literal.mjs';
import { isExpoApp, listApps, workspaceOf, workspacePackageNames, workspacePackages } from './workspaces.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

test('a single-app repo: no workspaces, listApps is the root', () => {
  const root = makeTempDir('ws-single-');
  try {
    write(join(root, 'package.json'), JSON.stringify({ name: 'tasks', dependencies: { expo: '57.0.0' } }));
    write(join(root, 'packages', 'stray', 'package.json'), JSON.stringify({ name: 'stray' }));
    assert.deepEqual(workspacePackages(root), [], 'packages/* without "workspaces" is not a workspace');
    assert.deepEqual(listApps(root).map((entry) => [entry.dir, entry.name, entry.isRoot]), [['.', 'tasks', true]]);
    assert.ok(isExpoApp(root));
    assert.equal(workspaceOf('src/a.ts', listApps(root)).dir, '.');
  } finally {
    removeTempDir(root);
  }
});

test('a monorepo: workspaces from package.json globs, names longest first, the workspace of a path', () => {
  const root = makeTempDir('ws-mono-');
  try {
    write(join(root, 'package.json'), JSON.stringify({ name: 'acme', workspaces: ['apps/*', 'packages/*'] }));
    write(join(root, 'apps', 'mobile', 'package.json'), JSON.stringify({ name: '@acme/mobile' }));
    write(join(root, 'apps', 'mobile', 'app.config.ts'), 'export default {};\n');
    write(join(root, 'packages', 'ui', 'package.json'), JSON.stringify({ name: '@acme/ui' }));
    write(join(root, 'packages', 'ui-kit', 'package.json'), JSON.stringify({ name: '@acme/ui-kit' }));
    write(join(root, 'packages', 'no-manifest', 'src', 'a.ts'), '');
    assert.deepEqual(workspacePackages(root).map((entry) => entry.dir), ['apps/mobile', 'packages/ui', 'packages/ui-kit']);
    assert.deepEqual(workspacePackageNames(root), ['@acme/mobile', '@acme/ui-kit', '@acme/ui'], 'longest first; equal lengths keep dir order');
    const apps = listApps(root);
    assert.ok(apps.every((entry) => entry.isRoot === false));
    assert.equal(workspaceOf('packages/ui-kit/src/x.ts', apps).dir, 'packages/ui-kit');
    assert.equal(workspaceOf('packages/ui/src/x.ts', apps).dir, 'packages/ui');
    assert.equal(workspaceOf('scripts/x.ts', apps), null);
    assert.ok(isExpoApp(root, 'apps/mobile') && !isExpoApp(root, 'packages/ui'));
  } finally {
    removeTempDir(root);
  }
});

test('object-literal: blocks, top-level entries, child objects, call arguments', () => {
  const source = maskComments("const Stack = createNativeStackNavigator({\n  screens: { Home, 'Task-Detail': { screen: Detail, options: { title: 'x, y' } } }, // c\n  initialRouteName: 'Home',\n});\n");
  const call = callObjectArgument(source, 'createNativeStackNavigator');
  assert.ok(call && call.index > 0);
  const entries = topLevelEntries(call.inner).map((entry) => `${entry.key}=${entry.value.slice(0, 6)}`);
  assert.deepEqual(entries, ['screens={ Home', "initialRouteName='Home'"]);
  const screens = childObject(call.inner, 'screens');
  assert.deepEqual(topLevelEntries(screens).map((entry) => entry.key), ['Home', 'Task-Detail']);
  assert.equal(topLevelEntries(screens)[0].value, 'Home', 'shorthand');
  assert.equal(extractBlock('{ [ ) }', 0), null);
});

test('ts-literal: plain data, named errors, entries parsed one by one', () => {
  const source = "export const BUDGETS = {\n  coldStartMs: 2_000, // comment\n  ratio: -0.5,\n  names: ['a', \"b\",],\n  nested: { on: true, off: null },\n} as const;\n";
  const start = findConstInitializer(source, 'BUDGETS');
  assert.deepEqual(parseValue(source, start).value, { coldStartMs: 2000, ratio: -0.5, names: ['a', 'b'], nested: { on: true, off: null } });
  assert.equal(findConstInitializer(source, 'MISSING'), -1);
  assert.throws(() => parseValue('{ a: SOME_CONST }', 0), (error) => error instanceof LiteralError && /"SOME_CONST" is not literal data/.test(error.message));
  assert.throws(() => parseValue('{ ...base }', 0), /spread is not literal data/);
  const entries = parseObjectEntries('{ a: 1, b: compute(2), c: `t` }', 0);
  assert.deepEqual(entries.map((entry) => (entry.error ? `${entry.key}!` : `${entry.key}=${entry.value}`)), ['a=1', 'b!', 'c!']);
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'workspaces.selftest', summary: 'Self-test of lib/workspaces.mjs, lib/object-literal.mjs and lib/ts-literal.mjs.', usage: '' });
  const report = createReporter({ name: 'workspaces.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'lib/workspaces.mjs', rule: 'lib-selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix the lib (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
