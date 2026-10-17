#!/usr/bin/env node
// ship-placeholders.selftest.mjs: the self-test of lib/ship-placeholders.mjs (the generic placeholder
// list, the in-source scan, the problem shape and the bundle-id rule). Prints ok / FAIL lines and the
// RESULT line.

import assert from 'node:assert/strict';

import { createReporter, parseArgs, run } from '../check-lib.mjs';
import { PLACEHOLDERS, PLACEHOLDER_RULE, bundleIdProblem, isGoogleSampleAdId, placeholderName, placeholderProblem, placeholdersIn, placeholdersInText } from './ship-placeholders.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the list is generic and frozen', () => {
  assert.ok(Object.isFrozen(PLACEHOLDERS) && PLACEHOLDERS.every(Object.isFrozen));
  assert.deepEqual(PLACEHOLDERS.map((entry) => entry.id), ['template-bundle-id', 'google-sample-admob-app-id', 'google-sample-admob-unit-id', 'template-admob-app-id', 'template-admob-unit-id', 'example-email', 'example-domain', 'template-token']);
  const text = JSON.stringify(PLACEHOLDERS.map(({ id, value, name, fix }) => ({ id, value, name, fix })));
  assert.doesNotMatch(text, /owner step|G3|G5|Shell/);
});

test('placeholdersIn / placeholderName on whole values', () => {
  const ids = (value) => placeholdersIn(value).map((entry) => entry.id);
  assert.deepEqual(ids('com.example.tasks'), ['template-bundle-id']);
  assert.deepEqual(ids('com.examples.tasks'), []);
  assert.deepEqual(ids('ca-app-pub-3940256099942544~3347511713'), ['google-sample-admob-app-id']);
  assert.deepEqual(ids('ca-app-pub-3940256099942544/2934735716'), ['google-sample-admob-unit-id']);
  assert.deepEqual(ids('ca-app-pub-1111111111111111/2222222222'), []);
  assert.deepEqual(ids('ca-app-pub-0000000000000000~1234567890'), ['template-admob-app-id']);
  assert.deepEqual(ids('ca-app-pub-0000000000000000/1234567890'), ['template-admob-unit-id']);
  assert.deepEqual(ids('support@example.com'), ['example-email']);
  assert.deepEqual(ids('https://example.com/privacy'), ['example-domain']);
  assert.deepEqual(ids('https://www.example.org'), ['example-domain']);
  assert.deepEqual(ids('https://acme.app/privacy'), []);
  assert.deepEqual(ids('https://example.com.acme.app'), []);
  assert.deepEqual(ids('__APP_NAME__'), ['template-token']);
  assert.deepEqual(ids(42), []);
  assert.equal(placeholderName('com.example.x'), 'the template bundle id (com.example.*)');
  assert.equal(placeholderName('com.acme.tasks'), null);
  assert.ok(isGoogleSampleAdId('ca-app-pub-3940256099942544/6300978111') && !isGoogleSampleAdId('ca-app-pub-1/2'));
});

test('placeholdersInText finds quoted placeholders in app.config.ts, with indexes', () => {
  const source = "export default {\n  name: '__APP_NAME__',\n  ios: { bundleIdentifier: 'com.example.tasks' },\n  extra: { adUnit: \"ca-app-pub-3940256099942544/2934735716\", support: `support@example.com`, site: `https://${host}` },\n  owner: 'acme',\n};\n";
  const found = placeholdersInText(source).map((entry) => `${entry.entry.id}=${entry.value}`);
  assert.deepEqual(found, ['template-token=__APP_NAME__', 'template-bundle-id=com.example.tasks', 'google-sample-admob-unit-id=ca-app-pub-3940256099942544/2934735716', 'example-email=support@example.com']);
  assert.equal(source.slice(placeholdersInText(source)[1].index, placeholdersInText(source)[1].index + 5), "'com.");
});

test('placeholderProblem and bundleIdProblem', () => {
  const [entry] = placeholdersIn('com.example.tasks');
  const problem = placeholderProblem({ entry, value: 'com.example.tasks', where: 'ios.bundleIdentifier', file: 'app.config.ts', line: 3 });
  assert.equal(problem.rule, PLACEHOLDER_RULE);
  assert.equal(problem.message, 'ios.bundleIdentifier is the template bundle id (com.example.*): com.example.tasks');
  assert.match(problem.fix, /no option turns this into a pass/);
  assert.equal(bundleIdProblem('com.acme.tasks'), null);
  assert.match(bundleIdProblem('com.example.tasks'), /template bundle id/);
  assert.match(bundleIdProblem(''), /missing/);
  assert.match(bundleIdProblem('tasks'), /not a reverse-DNS id/);
  assert.equal(bundleIdProblem('com.acme.my-tasks', { platform: 'ios' }), null);
  assert.match(bundleIdProblem('com.acme.my-tasks', { platform: 'android' }), /not a valid Android package/);
  assert.equal(bundleIdProblem('com.acme.my_tasks', { platform: 'android' }), null);
  assert.match(bundleIdProblem('com.acme.my_tasks', { platform: 'ios' }), /not a valid iOS bundle id/);
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'ship-placeholders.selftest', summary: 'Self-test of lib/ship-placeholders.mjs.', usage: '' });
  const report = createReporter({ name: 'ship-placeholders.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'lib/ship-placeholders.mjs', rule: 'lib-selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix lib/ship-placeholders.mjs (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
