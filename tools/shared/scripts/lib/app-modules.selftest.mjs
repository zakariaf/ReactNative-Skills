#!/usr/bin/env node
// app-modules.selftest.mjs: the self-test of lib/app-modules.mjs. It writes small repos and imports
// their TypeScript through the hooks: tsconfig aliases (with extends), relative imports without an
// extension, platform files, JSON, workspace package names, two roots in one process, and the
// helpers. Prints ok / FAIL lines and the RESULT line.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createReporter, makeTempDir, parseArgs, removeTempDir, run } from '../check-lib.mjs';
import { deepFreeze, enableAppImports, errorText, lineOfExport, reasonOf } from './app-modules.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const temps = [];
process.on('exit', () => temps.forEach((dir) => removeTempDir(dir)));

test('a single app: @/ aliases from tsconfig (with extends), extensionless relative imports, .native files and JSON', async () => {
  const root = makeTempDir('app-modules-single-');
  temps.push(root);
  write(join(root, 'tsconfig.base.json'), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }');
  write(join(root, 'tsconfig.json'), '{ "extends": "./tsconfig.base.json", /* Expo */ }');
  write(join(root, 'src', 'core', 'money.ts'), "import { round } from './round';\nimport rates from './rates.json';\nimport { label } from '@/core/label';\nexport type Cents = number;\nexport function toCents(value: number): Cents { return round(value * 100 * rates.factor); }\nexport const name: string = label;\n");
  write(join(root, 'src', 'core', 'round.ts'), 'export const round = (value: number): number => Math.round(value);\n');
  write(join(root, 'src', 'core', 'rates.json'), '{ "factor": 1 }\n');
  write(join(root, 'src', 'core', 'label.native.ts'), "export const label: string = 'native';\n");
  write(join(root, 'src', 'features', 'tasks', 'tasks-reducer.ts'), "import { toCents } from '@/core/money';\nexport interface State { total: number }\nexport function tasksReducer(state: State, add: number): State { return { total: state.total + toCents(add) }; }\n");
  const app = enableAppImports(root);
  assert.equal(app.root, root);
  assert.ok(app.exists('src/core/money.ts') && !app.exists('src/core/nope.ts'));
  const money = await app.load('src/core/money.ts');
  assert.equal(money.toCents(1.234), 123);
  assert.equal(money.name, 'native');
  const { tasksReducer } = await app.load('src/features/tasks/tasks-reducer.ts');
  assert.deepEqual(tasksReducer(deepFreeze({ total: 1 }), 2), { total: 201 });
});

test('a monorepo: workspace package names resolve to their folder or its src/, and a second root keeps its own aliases', async () => {
  const root = makeTempDir('app-modules-mono-');
  temps.push(root);
  write(join(root, 'package.json'), JSON.stringify({ name: 'acme', workspaces: ['packages/*'] }));
  write(join(root, 'packages', 'core', 'package.json'), JSON.stringify({ name: '@acme/core', main: './src/index.ts' }));
  write(join(root, 'packages', 'core', 'src', 'index.ts'), "export const VERSION: number = 2;\n");
  write(join(root, 'packages', 'core', 'src', 'dates', 'day-key.ts'), "export function dayKey(year: number, month: number, day: number): string { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }\n");
  write(join(root, 'packages', 'app', 'package.json'), JSON.stringify({ name: '@acme/app' }));
  write(join(root, 'packages', 'app', 'src', 'streak.ts'), "import { VERSION } from '@acme/core';\nimport { dayKey } from '@acme/core/dates/day-key';\nexport const today = (): string => `${VERSION}:${dayKey(2026, 10, 3)}`;\n");
  const other = makeTempDir('app-modules-other-');
  temps.push(other);
  write(join(other, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "@/*": ["./app-src/*"] } } }');
  write(join(other, 'app-src', 'value.ts'), 'export const value: number = 7;\n');
  write(join(other, 'app-src', 'main.ts'), "import { value } from '@/value';\nexport const doubled: number = value * 2;\n");
  const mono = enableAppImports(root);
  const second = enableAppImports(other);
  assert.equal((await mono.load('packages/app/src/streak.ts')).today(), '2:2026-10-03');
  assert.equal((await second.load('app-src/main.ts')).doubled, 14);
});

test('a module that imports React Native or holds JSX does not load (the purity the rules need)', async () => {
  const root = makeTempDir('app-modules-impure-');
  temps.push(root);
  write(join(root, 'src', 'view.ts'), "import { View } from 'react-native';\nexport const v = View;\n");
  write(join(root, 'src', 'screen.tsx'), 'export const Screen = () => <div />;\n');
  const app = enableAppImports(root);
  await assert.rejects(() => app.load('src/view.ts'), /react-native/);
  await assert.rejects(() => app.load('src/screen.tsx'));
});

test('helpers: deepFreeze, lineOfExport, reasonOf, errorText', () => {
  const frozen = deepFreeze({ a: { b: [1] } });
  assert.ok(Object.isFrozen(frozen.a.b));
  assert.equal(lineOfExport('// x\nexport function tasksReducer() {}\n', 'tasksReducer'), 2);
  assert.equal(lineOfExport('nothing', 'missing'), 1);
  try {
    assert.equal(1, 2);
  } catch (error) {
    assert.equal(reasonOf(error), 'expected 2, got 1');
  }
  assert.equal(reasonOf(new Error('first line\nsecond')), 'first line');
  assert.equal(errorText(new TypeError('bad\nstack')), 'TypeError: bad');
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'app-modules.selftest', summary: 'Self-test of lib/app-modules.mjs.', usage: '' });
  const report = createReporter({ name: 'app-modules.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'lib/app-modules.mjs', rule: 'lib-selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix lib/app-modules.mjs (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
