#!/usr/bin/env node
// source-scan.selftest.mjs: the self-test of lib/source-scan.mjs (the lexer, the JSX helpers, the
// small helpers and tsconfig-aware import resolution). Prints ok / FAIL lines and the RESULT line.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createReporter, makeTempDir, parseArgs, removeTempDir, run } from '../check-lib.mjs';
import {
  balancedParens,
  codeLineCount,
  countParams,
  findCalls,
  findClosing,
  findImports,
  findJsxTags,
  functionsOf,
  hasWorkletDirective,
  importsOf,
  isTestFile,
  jsxAttributes,
  literalOf,
  maskCode,
  matchBracket,
  openingTag,
  paramListsOf,
  readRepoFile,
  resolveImport,
  resolveSpecifier,
  scanSource,
  valueImports,
} from './source-scan.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const write = (path, text = 'export {};\n') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const SAMPLE = `// header comment
import type { Task } from '@/core/task';
import { useTasks } from './use-tasks';
import './polyfills';
export { formatDate } from '@/i18n/format-date';
const url = 'http://example.test // not a comment';
const re = /\\/\\/x/g;
const t = \`a \${b ? '}' : 'x'} c\`;
export function TasksScreen({ title }: Props, extra: number) {
  const { tasks } = useTasks();
  const lazy = await import('./lazy');
  return <TaskList items={tasks} testID="tasks.list" isRTL title={title} {...rest} />;
}
const add = (a: number, b: number): number => a + b;
`;

test('scanSource: comments and strings are found, code is blanked with positions kept', () => {
  const scan = scanSource(SAMPLE);
  assert.equal(scan.code.length, SAMPLE.length);
  assert.equal(scan.code.split('\n').length, SAMPLE.split('\n').length);
  assert.ok(scan.comments[0].text.startsWith('// header comment'));
  assert.ok(scan.strings.some((entry) => entry.value === 'http://example.test // not a comment'));
  assert.ok(!scan.code.includes('not a comment'));
  assert.equal(scan.lineOf(SAMPLE.indexOf('export function')), 9);
  const template = scan.strings.find((entry) => entry.quote === '`');
  assert.deepEqual(template.parts, ['a ', ' c']);
  assert.equal(matchBracket(scan.code, scan.code.indexOf('(')), scan.code.indexOf(')'));
  assert.equal(codeLineCount(scan.codeKeep), 13);
});

test('importsOf, functionsOf, paramListsOf, countParams', () => {
  const scan = scanSource(SAMPLE);
  const imports = importsOf(scan).map((entry) => `${entry.form}:${entry.spec}${entry.typeOnly ? ':type' : ''}`);
  assert.deepEqual(imports, ['import:@/core/task:type', 'import:./use-tasks', 'side-effect:./polyfills', 'export:@/i18n/format-date', 'dynamic:./lazy']);
  const fns = functionsOf(scan).map((fn) => `${fn.name}/${fn.kind}/${fn.params}`);
  assert.ok(fns.includes('TasksScreen/function/2') && fns.includes('add/arrow/2'), fns.join(' '));
  assert.ok(paramListsOf(scan).some((entry) => entry.name === 'TasksScreen' && entry.params === 2));
  assert.equal(countParams('a, b,\n'), 2);
  assert.equal(countParams('this: Window, a'), 1);
  assert.equal(countParams(''), 0);
});

test('maskCode and the JSX helpers', () => {
  const masked = maskCode(SAMPLE);
  assert.equal(masked.length, SAMPLE.length);
  const tags = findJsxTags(SAMPLE, masked);
  assert.deepEqual(tags.map((tag) => tag.name), ['TaskList']);
  const attrs = jsxAttributes(SAMPLE, tags[0], masked);
  assert.equal(literalOf(attrs.get('testID')), 'tasks.list');
  assert.equal(attrs.get('isRTL').kind, 'bool');
  assert.equal(attrs.get('items').value, 'tasks');
  assert.ok([...attrs.keys()].some((key) => key.startsWith('...')));
  const calls = findCalls(masked, 'useTasks');
  assert.equal(calls.length, 1);
  assert.equal(findClosing(masked, calls[0].open), calls[0].close);
  assert.deepEqual(findImports(SAMPLE, masked).map((entry) => entry.from), ['@/core/task', './use-tasks', './polyfills']);
});

test('small helpers: worklet directive, value imports, balancedParens, openingTag, isTestFile', () => {
  assert.ok(hasWorkletDirective("// draws\n'worklet';\nexport const x = 1;"));
  assert.ok(!hasWorkletDirective("const a = 'worklet';"));
  assert.deepEqual(valueImports("import { type A, type B } from './types';\nimport { c } from './c';\nimport type D from './d';\n").map((entry) => entry.spec), ['./c']);
  assert.equal(balancedParens("f(a, ')', g(b))", 1), "a, ')', g(b)");
  assert.equal(openingTag('<View style={{ a: 1 }} title=">">x</View>', 0), '<View style={{ a: 1 }} title=">">');
  for (const rel of ['src/a.test.ts', 'src/a.spec.tsx', 'test/render.tsx', '__mocks__/expo.ts', 'src/__tests__/a.ts', 'src/x/__mocks__/y.ts']) assert.ok(isTestFile(rel), rel);
  assert.ok(!isTestFile('src/features/tasks/tasks-screen.tsx'));
});

test('resolveImport / resolveSpecifier: relative paths, tsconfig aliases with extends, extension and platform probing', () => {
  const root = makeTempDir('scan-resolve-');
  try {
    write(join(root, 'tsconfig.base.json'), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"], "#assets": ["./assets/index.ts"] } } }');
    write(join(root, 'tsconfig.json'), '{\n  // the Expo template\n  "extends": "./tsconfig.base.json",\n}\n');
    write(join(root, 'src', 'ui', 'app-text.tsx'));
    write(join(root, 'src', 'ui', 'button.ios.tsx'));
    write(join(root, 'src', 'features', 'tasks', 'index.ts'));
    write(join(root, 'src', 'core', 'money.ts'));
    write(join(root, 'assets', 'index.ts'));
    const from = 'src/features/tasks/tasks-screen.tsx';
    assert.deepEqual(resolveImport(from, '@/ui/app-text', { root }), { kind: 'local', spec: '@/ui/app-text', path: 'src/ui/app-text.tsx', exists: true });
    assert.equal(resolveSpecifier(from, '@/ui/button', { root }), 'src/ui/button.ios.tsx');
    assert.equal(resolveSpecifier(from, '../../core/money', { root }), 'src/core/money.ts');
    assert.equal(resolveSpecifier(from, '../../core/money.js', { root }), 'src/core/money.ts', 'an ESM-style .js specifier names the .ts file');
    assert.equal(resolveSpecifier('src/app/index.tsx', '@/features/tasks', { root }), 'src/features/tasks/index.ts');
    assert.equal(resolveSpecifier(from, '#assets', { root }), 'assets/index.ts');
    assert.deepEqual(resolveImport(from, '@/ui/missing', { root }), { kind: 'local', spec: '@/ui/missing', path: 'src/ui/missing', exists: false });
    assert.deepEqual(resolveImport(from, 'react-native', { root }), { kind: 'external', spec: 'react-native', path: null, exists: false });
    assert.equal(resolveSpecifier(from, '@tanstack/react-query', { root }), null);
    assert.equal(resolveSpecifier(from, 'node:fs', { root }), null);
    // Without root nothing is probed; aliases may be passed in.
    assert.deepEqual(resolveImport(from, './row'), { kind: 'local', spec: './row', path: 'src/features/tasks/row', exists: null });
    assert.equal(resolveSpecifier(from, '~/x', { aliases: [{ pattern: '~/*', targets: ['app/*'] }] }), 'app/x');
    assert.equal(resolveSpecifier(from, '@/ui/app-text'), null, 'no root and no aliases: an alias is just a package name');
    // A monorepo's own packages resolve with root (folder or its src/), longest name first.
    write(join(root, 'package.json'), JSON.stringify({ name: 'acme', workspaces: ['packages/*'] }));
    write(join(root, 'packages', 'core', 'package.json'), JSON.stringify({ name: '@acme/core', main: './src/main.ts' }));
    write(join(root, 'packages', 'core', 'src', 'main.ts'));
    write(join(root, 'packages', 'core', 'src', 'money.ts'));
    write(join(root, 'packages', 'core-ui', 'package.json'), JSON.stringify({ name: '@acme/core-ui' }));
    write(join(root, 'packages', 'core-ui', 'index.ts'));
    assert.equal(resolveSpecifier('packages/app/a.ts', '@acme/core/money', { root }), 'packages/core/src/money.ts');
    assert.equal(resolveSpecifier('packages/app/a.ts', '@acme/core', { root }), 'packages/core/src/main.ts');
    assert.equal(resolveSpecifier('packages/app/a.ts', '@acme/core-ui', { root }), 'packages/core-ui/index.ts');
    assert.equal(resolveSpecifier('packages/app/a.ts', '@acme/core/money'), null, 'without root a package name is external');
    assert.equal(readRepoFile(root, 'src/core/money.ts'), 'export {};\n');
    assert.equal(readRepoFile(root, 'nope.ts'), null);
  } finally {
    removeTempDir(root);
  }
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'source-scan.selftest', summary: 'Self-test of lib/source-scan.mjs.', usage: '' });
  const report = createReporter({ name: 'source-scan.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'lib/source-scan.mjs', rule: 'lib-selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix lib/source-scan.mjs (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
