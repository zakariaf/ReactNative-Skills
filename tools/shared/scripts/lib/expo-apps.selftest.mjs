#!/usr/bin/env node
// expo-apps.selftest.mjs: the self-test of lib/expo-apps.mjs. Prints ok / FAIL lines and the RESULT line.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { UsageError, createReporter, makeTempDir, parseArgs, removeTempDir, run } from '../check-lib.mjs';
import { enclosingWorkspaceRepo, expoAppDirs, forEachExpoApp, importExtensionsMode, prefixedReporter } from './expo-apps.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** A workspace repo: an Expo app in apps/mobile, a shared package and a Node backend. */
function workspaceRepo(root) {
  write(join(root, 'package.json'), JSON.stringify({ name: 'tasks', private: true, workspaces: ['apps/*', 'packages/*', 'functions'] }));
  write(join(root, 'apps', 'mobile', 'package.json'), JSON.stringify({ name: '@tasks/mobile', dependencies: { expo: '57.0.27' } }));
  write(join(root, 'apps', 'mobile', 'app.config.ts'), 'export default {};\n');
  write(join(root, 'packages', 'shared', 'package.json'), JSON.stringify({ name: '@tasks/shared' }));
  write(join(root, 'functions', 'package.json'), JSON.stringify({ name: '@tasks/functions', engines: { node: '24' } }));
}

test('a single app is its own app, and writes extensionless imports', () => {
  const root = makeTempDir('expo-apps-single-');
  try {
    write(join(root, 'package.json'), JSON.stringify({ name: 'tasks', dependencies: { expo: '57.0.27' } }));
    write(join(root, 'app.config.ts'), 'export default {};\n');
    assert.deepEqual(expoAppDirs(root), ['.']);
    assert.equal(importExtensionsMode(root), 'node');
    assert.equal(enclosingWorkspaceRepo(root), null);
  } finally {
    removeTempDir(root);
  }
});

test('a workspace repo: the Expo app workspace, the repo of an app folder, extensions everywhere', () => {
  const root = makeTempDir('expo-apps-mono-');
  try {
    workspaceRepo(root);
    assert.deepEqual(expoAppDirs(root), ['apps/mobile'], 'only the workspace with an app config');
    assert.deepEqual(expoAppDirs(join(root, 'apps', 'mobile')), ['.'], 'the app folder itself is one app');
    const enclosing = enclosingWorkspaceRepo(join(root, 'apps', 'mobile'));
    assert.equal(enclosing?.prefix, 'apps/mobile');
    assert.equal(enclosingWorkspaceRepo(join(root, 'apps')), null, 'apps/ is no workspace');
    assert.equal(importExtensionsMode(root), 'all');
    write(join(root, 'rn-skills.config.json'), '// the app resolves extensionless imports\n{ "importExtensions": "node" }\n');
    assert.equal(importExtensionsMode(root), 'node', 'the config key wins');
  } finally {
    removeTempDir(root);
  }
});

test('a workspace repo without app configs falls back to the workspaces that depend on expo', () => {
  const root = makeTempDir('expo-apps-deps-');
  try {
    workspaceRepo(root);
    write(join(root, 'apps', 'mobile', 'app.config.ts'), '');
    assert.deepEqual(expoAppDirs(root), ['apps/mobile']);
    write(join(root, 'app.json'), '{ "expo": { "name": "tasks" } }\n');
    assert.deepEqual(expoAppDirs(root), ['.'], 'a root app config makes the root the app');
  } finally {
    removeTempDir(root);
  }
});

test('forEachExpoApp prefixes files, sums checks, names the app on bad input', async () => {
  const root = makeTempDir('expo-apps-run-');
  try {
    workspaceRepo(root);
    const lines = [];
    const report = createReporter({ name: 'probe' });
    const original = console.log;
    console.log = (text) => lines.push(text);
    try {
      const result = await forEachExpoApp(root, report, async (appRoot, appReport, dir) => {
        assert.equal(appRoot, join(root, 'apps', 'mobile'));
        appReport.problem({ file: 'src/theme/palette.ts', line: 3, rule: 'probe', message: 'planted' });
        appReport.skip({ file: 'app.config.ts', rule: 'probe', message: 'not yet created' });
        return { checked: dir === 'apps/mobile' ? 2 : 0 };
      });
      assert.deepEqual(result, { checked: 2, notApplicable: null });
    } finally {
      console.log = original;
    }
    assert.match(lines.join('\n'), /apps: apps\/mobile/);
    assert.deepEqual(report.problems.map((entry) => entry.file), ['apps/mobile/src/theme/palette.ts']);
    assert.deepEqual(report.skips.map((entry) => entry.file), ['apps/mobile/app.config.ts']);
    const none = await forEachExpoApp(root, createReporter({ name: 'probe' }), async () => ({ notApplicable: 'no audio' }));
    assert.equal(none.notApplicable, 'apps/mobile: no audio');
    await assert.rejects(
      forEachExpoApp(root, createReporter({ name: 'probe' }), async () => {
        throw new UsageError('nothing to check: src/theme does not exist', 'Copy the templates.');
      }),
      (error) => error instanceof UsageError && error.message === 'apps/mobile: nothing to check: src/theme does not exist',
    );
    const same = createReporter({ name: 'probe' });
    assert.equal(prefixedReporter(same, '.'), same);
  } finally {
    removeTempDir(root);
  }
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'expo-apps.selftest', summary: 'Self-test of lib/expo-apps.mjs.', usage: '' });
  const report = createReporter({ name: 'expo-apps.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'lib/expo-apps.mjs', rule: 'lib-selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix the lib (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
