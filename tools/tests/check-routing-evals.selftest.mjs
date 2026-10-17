#!/usr/bin/env node
// check-routing-evals.selftest.mjs: the self-test of tools/check-routing-evals.mjs. A good evals file passes;
// one planted bug per rule fails with exactly that rule; bad input exits 2; the repo's own
// tools/routing-evals.json passes against tools/catalog.json.
//   node tools/tests/check-routing-evals.selftest.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkRoutingEvals, promptKey } from '../check-routing-evals.mjs';
import { createReporter, makeTempDir, parseArgs, removeTempDir, run } from '../shared/scripts/check-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, '..', 'check-routing-evals.mjs');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const node = (args) => {
  const result = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', last: (result.stdout ?? '').trim().split('\n').at(-1) };
};

const CATALOG = {
  categories: [{ key: 'data', label: 'Data' }],
  skills: [
    { name: 'tasks-store', category: 'data', plugin: 'core', manual: false },
    { name: 'tasks-sync', category: 'data', plugin: 'core', manual: false },
    { name: 'run-tasks-reset', category: 'data', plugin: 'core', manual: true },
  ],
};
const good = () => ({
  evals: [
    { prompt: 'Add a store for the task list with a selector for overdue tasks', expect: 'tasks-store' },
    { prompt: 'The task list re-renders on every keystroke in the search box', expect: 'tasks-store' },
    { prompt: 'Where should the selected filter of the task list live?', expect: 'tasks-store', near: 'tasks-sync' },
    { prompt: 'Upload changed tasks when the phone comes back online', expect: 'tasks-sync' },
    { prompt: 'Two devices edited the same task offline; which edit wins?', expect: 'tasks-sync' },
    { prompt: 'Retry the task upload with backoff after a 503', expect: 'tasks-sync', near: 'tasks-store' },
    { prompt: '/run-tasks-reset on the staging build', expect: 'run-tasks-reset' },
    { prompt: 'Use run-tasks-reset to wipe the local tasks table', expect: 'run-tasks-reset' },
    { prompt: 'run-tasks-reset after the failed migration', expect: 'run-tasks-reset' },
    { prompt: 'Write a haiku about autumn leaves', expect: null },
  ],
});
const rulesOf = (problems) => [...new Set(problems.map((problem) => problem.rule))].sort();

test('a good file passes, and the planted bugs fail with their own rule', () => {
  assert.deepEqual(checkRoutingEvals(good(), CATALOG), []);
  const cases = {
    'evals-shape': (doc) => ({ prompts: doc.evals }),
    'eval-shape': (doc) => (doc.evals[0].from = 'x', doc),
    'eval-expect': (doc) => (doc.evals.push({ prompt: 'What is the weather in Lisbon?', expect: 'none' }), doc),
    'eval-unknown-skill': (doc) => (doc.evals.push({ prompt: 'Draw the task chart', expect: 'tasks-chart' }), doc),
    'eval-near-self': (doc) => (doc.evals[0].near = 'tasks-store', doc),
    'eval-duplicate': (doc) => (doc.evals.push({ ...doc.evals[3], prompt: 'upload changed tasks, when the phone comes back ONLINE!' }), doc),
    'eval-local-path': (doc) => (doc.evals.push({ prompt: 'Fix /Users/someone/app/src/stores/tasks.ts so the list updates', expect: 'tasks-store' }), doc),
    'eval-coverage': (doc) => (doc.evals = doc.evals.filter((item) => item.prompt !== 'Upload changed tasks when the phone comes back online'), doc),
    'eval-near-miss': (doc) => (doc.evals.forEach((item) => item.near === 'tasks-sync' && delete item.near), doc),
    'eval-null': (doc) => (doc.evals = doc.evals.filter((item) => item.expect !== null), doc),
  };
  for (const [rule, plant] of Object.entries(cases)) assert.deepEqual(rulesOf(checkRoutingEvals(plant(good()), CATALOG)), [rule], rule);
  // A manual runbook needs prompts but no near miss; a plain list is accepted as well as { evals }.
  assert.deepEqual(checkRoutingEvals(good().evals, CATALOG), []);
  assert.equal(promptKey('  Fix THE list, now! '), 'fix the list now');
});

test('the CLI: exit 0 with RESULT: PASS, exit 1 with FAIL lines, exit 2 on bad input', () => {
  const dir = makeTempDir('routing-evals-');
  try {
    const catalog = join(dir, 'catalog.json');
    const evals = join(dir, 'evals.json');
    writeFileSync(catalog, JSON.stringify(CATALOG));
    writeFileSync(evals, JSON.stringify(good()));
    const pass = node(['--evals', evals, '--catalog', catalog]);
    assert.equal(pass.status, 0, pass.stdout);
    assert.equal(pass.last, 'RESULT: PASS');
    const doc = good();
    doc.evals.push({ prompt: 'Draw the task chart', expect: 'tasks-chart' });
    writeFileSync(evals, JSON.stringify(doc));
    const failed = node(['--evals', evals, '--catalog', catalog]);
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /^FAIL \S+ \[eval-unknown-skill\] evals\[10\]/m);
    assert.equal(failed.last, 'RESULT: FAIL (1 problems)');
    const stricter = node(['--evals', evals, '--catalog', catalog, '--min-per-skill', '4']);
    assert.match(stricter.stdout, /\[eval-coverage\] tasks-store has 3 prompts that expect it \(needs 4\)/);
    assert.equal(node(['--evals', join(dir, 'missing.json'), '--catalog', catalog]).status, 2);
    writeFileSync(evals, '{ not json');
    assert.equal(node(['--evals', evals, '--catalog', catalog]).status, 2);
    assert.equal(node(['--min-per-skill', 'three']).status, 2);
    const help = node(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage: /);
  } finally {
    removeTempDir(dir);
  }
});

test('the repo: tools/routing-evals.json passes against tools/catalog.json', () => {
  const repo = node([]);
  assert.equal(repo.status, 0, repo.stdout);
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'check-routing-evals.selftest', summary: 'Self-test of check-routing-evals.mjs.', usage: '' });
  const report = createReporter({ name: 'check-routing-evals.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'tools/check-routing-evals.mjs', rule: 'selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix check-routing-evals.mjs (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
