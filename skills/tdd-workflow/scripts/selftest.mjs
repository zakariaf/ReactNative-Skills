#!/usr/bin/env node
// selftest.mjs: proves check-tests.mjs and check-test-edits.mjs pass their good fixtures and catch
// every planted bug. The check-test-edits-git suite builds a throwaway git repository (fixed author and
// dates) because --range and --staged read a real repository and a skill cannot commit a .git folder.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs

import { join } from 'node:path';

import { runSelftest } from './check-lib.mjs';
import { commit, git, initRepo, stage } from './lib/git-fixture.mjs';

const URGENCY = 'src/features/tasks/task-urgency.ts';
const urgency = (farFuture = '') => [
  '// src/features/tasks/task-urgency.ts',
  "export type Urgency = 'overdue' | 'today' | 'soon' | 'later';",
  '',
  'export function taskUrgency(daysLeft: number): Urgency {',
  '  if (daysLeft < 0) {',
  "    return 'overdue';",
  '  }',
  `${farFuture}  return daysLeft === 0 ? 'today' : daysLeft <= 2 ? 'soon' : 'later';`,
  '}',
  '',
].join('\n');
const urgencyTest = [
  '// src/features/tasks/task-urgency.test.ts',
  "import { taskUrgency } from './task-urgency';",
  '',
  "describe('taskUrgency', () => {",
  "  it('returns today for a task due today (TASKS-12)', () => {",
  "    expect(taskUrgency(0)).toBe('today');",
  '  });',
  '});',
  '',
].join('\n');
// A device-only wrapper long enough that a change near its end leaves the marker out of the diff:
// only --range (git show) and --staged (the index) can still read it.
const driver = (option) => [
  '// src/data/expo-sqlite-sql-driver.ts',
  '// device-only: covered by the e2e flow open-tasks.yaml and the device kill test.',
  "import { openDatabaseSync } from 'expo-sqlite';",
  '',
  ...Array.from({ length: 12 }, (_, index) => `export const TABLE_${index} = 'table_${index}';`),
  '',
  `export const openTasksDatabase = (fileName: string) => openDatabaseSync(fileName${option});`,
  '',
].join('\n');

// A table long enough that a change to its last rows leaves the line that opens it out of the diff:
// only --range and --staged (which read the whole old file) can tell the line is a table row.
const BANDS = [[1, 'soon'], [2, 'soon'], [3, 'later'], [7, 'later'], [14, 'later'], [27, 'later'], [28, 'later']];
const tableTest = (lastRow) => urgencyTest.replace(/\}\);\n$/, [
  '',
  '  it.each([',
  ...[...BANDS, lastRow].map(([days, band]) => `    [${days}, '${band}'],`),
  "  ] as const)('returns %s days ahead as %s', (daysLeft, band) => {",
  '    expect(taskUrgency(daysLeft)).toBe(band);',
  '  });',
  '});',
  '',
].join('\n'));

// The same table in the form the skill's template writes: a type argument list after .each.
const typedTableTest = (lastRow) => tableTest(lastRow).replace("  it.each([\n", "  it.each<[number, string]>([\n").replace('  ] as const)(', '  ])(');

// The digest planner with a pinned expectation in the shape Prettier gives a long one: expect( alone on
// its line, the matcher's object over several lines. Only the lines inside it change in the bad case.
const DIGEST = 'src/features/tasks/tasks-digest.ts';
const DIGEST_TEST = 'src/features/tasks/tasks-digest.test.ts';
const digest = (overdueBefore) => [
  '// src/features/tasks/tasks-digest.ts',
  'export interface DigestTask {',
  '  readonly id: string;',
  '  readonly dueKey: string;',
  '}',
  '',
  'export function planDigest(tasks: readonly DigestTask[], todayKey: string) {',
  `  const overdueBefore = ${overdueBefore};`,
  '  return {',
  '    overdue: tasks.filter((task) => task.dueKey < overdueBefore).map((task) => task.id),',
  '    dueToday: tasks.filter((task) => task.dueKey >= overdueBefore && task.dueKey <= todayKey).map((task) => task.id),',
  '  };',
  '}',
  '',
].join('\n');
const digestTest = (expectation) => [
  '// src/features/tasks/tasks-digest.test.ts',
  "import { planDigest } from './tasks-digest';",
  '',
  "describe('planDigest', () => {",
  "  it('lists a task due yesterday as overdue (TASKS-21)', () => {",
  ...expectation,
  '  });',
  '});',
  '',
].join('\n');
const WRAPPED = (overdue, dueToday) => [
  '    expect(',
  "      planDigest([{ id: 'task-1', dueKey: '2026-10-09' }], '2026-10-10'),",
  '    ).toStrictEqual({',
  `      overdue: [${overdue}],`,
  `      dueToday: [${dueToday}],`,
  '    });',
];
const REWRAPPED = [
  "    expect(planDigest([{ id: 'task-1', dueKey: '2026-10-09' }], '2026-10-10')).toStrictEqual({",
  "      overdue: ['task-1'],",
  '      dueToday: [],',
  '    });',
];

/**
 * An Expo app in a subfolder of a full-stack repo (fullstack/mobile/), its own git repository: a feat
 * commit changes app code and only a server test, then a fix changes the device-only driver far below
 * its marker (only git show <sha>:mobile/<path> can read the marker).
 */
function buildFullStack(dir) {
  initRepo(dir);
  commit(dir, 'chore: add the app and the server', {
    'mobile/package.json': '{ "name": "tasks-mobile", "private": true }\n',
    'mobile/src/features/tasks/next-due.ts': '// src/features/tasks/next-due.ts\nexport function nextDue(days: readonly number[]): number {\n  return Math.min(...days);\n}\n',
    'mobile/src/features/tasks/next-due.test.ts': "// src/features/tasks/next-due.test.ts\nimport { nextDue } from './next-due';\n\ndescribe('nextDue', () => {\n  it('returns the nearest day', () => {\n    expect(nextDue([3, 1])).toBe(1);\n  });\n});\n",
    'mobile/src/data/expo-sqlite-sql-driver.ts': driver(', { useNewConnection: true }'),
    'server/api.test.ts': "// server/api.test.ts\ndescribe('api', () => {\n  it('answers', () => {\n    expect(1).toBe(1);\n  });\n});\n",
  }, 1);
  commit(dir, 'feat(tasks): skip days already past', {
    'mobile/src/features/tasks/next-due.ts': '// src/features/tasks/next-due.ts\nexport function nextDue(days: readonly number[]): number {\n  return Math.min(...days.filter((day) => day >= 0));\n}\n',
    'server/api.test.ts': "// server/api.test.ts\ndescribe('api', () => {\n  it('answers', () => {\n    expect(2).toBe(2);\n  });\n});\n",
  }, 2);
  commit(dir, 'fix(data): open the tasks database on the shared connection', { 'mobile/src/data/expo-sqlite-sql-driver.ts': driver('') }, 3);
}

/** The digest planner and its test with planDigest renamed (a rename refactor: same literals and matchers). */
const renamed = (text) => text.replaceAll('planDigest', 'buildDigest');

// A tally with two counts: the swap cases move an assertion from one property to another in a refactor
// commit that also changes the behaviour. The shape of the assertion stays, so only the names tell.
const TALLY = 'src/features/tasks/task-tally.ts';
const TALLY_TEST = 'src/features/tasks/task-tally.test.ts';
const tally = (body) => [
  '// src/features/tasks/task-tally.ts',
  'export function tallyTasks(done: readonly boolean[]) {',
  `  return ${body};`,
  '}',
  '',
].join('\n');
const tallyTest = (property) => [
  '// src/features/tasks/task-tally.test.ts',
  "import { tallyTasks } from './task-tally';",
  '',
  "describe('tallyTasks', () => {",
  "  it('counts the open tasks (TASKS-30)', () => {",
  `    expect(tallyTasks([false, false, true]).${property}).toBe(2);`,
  '  });',
  '});',
  '',
].join('\n');
const TALLY_BODY = '{ openCount: done.filter((isDone) => !isDone).length, doneCount: done.filter(Boolean).length }';

/**
 * main: chore (driver) -> feat (code + test) -> fix (driver, marker outside the diff); staged: code only.
 * Branch table (from main): test (a band table) -> fix (its last row and the code change together).
 * Branch wrapped (from main): feat (digest + wrapped pinned expectation) -> fix (moves the task inside it).
 * Branch rewrap (from wrapped~1): fix (code change; the expectation only re-wrapped).
 * Branch typed (from main): test (a typed it.each<[number, string]> table) -> fix (its last row and the code).
 * Branch rename (from wrapped~1): refactor (planDigest renamed to buildDigest in code and test).
 * Branch renamelit (from wrapped~1): refactor (the same rename, plus a changed value inside the expectation).
 * Branch tally (from main): feat (tallyTasks + a test on openCount). From it:
 *   swapold: refactor drops openCount and moves the assertion onto doneCount, which already existed;
 *   swapkeep: refactor adds pendingCount, keeps openCount (now 0) and moves the assertion onto pendingCount.
 * fullstack/: a separate repository whose Expo app lives in mobile/ (buildFullStack).
 */
function buildHistory(dir) {
  initRepo(dir);
  commit(dir, 'chore(data): add the expo-sqlite driver', { 'src/data/expo-sqlite-sql-driver.ts': driver(', { useNewConnection: true }') }, 1);
  commit(dir, 'feat(tasks): show how urgent each open task is\n\nTASKS-12: due today is "today", within 2 days "soon".', { [URGENCY]: urgency(), 'src/features/tasks/task-urgency.test.ts': urgencyTest }, 2);
  commit(dir, 'fix(data): open the tasks database on the shared connection', { 'src/data/expo-sqlite-sql-driver.ts': driver('') }, 3);
  git(dir, ['checkout', '-q', '-b', 'table']);
  commit(dir, 'test(tasks): cover every urgency band edge\n\nTASKS-12: one row per band edge.', { 'src/features/tasks/task-urgency.test.ts': tableTest([29, 'later']) }, 4);
  commit(dir, 'fix(tasks): stop calling far-away tasks later', { 'src/features/tasks/task-urgency.test.ts': tableTest([29, 'someday']), [URGENCY]: urgency("  if (daysLeft > 28) {\n    return 'someday';\n  }\n") }, 5);
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['checkout', '-q', '-b', 'wrapped']);
  commit(dir, 'feat(tasks): group open tasks by due date\n\nTASKS-21: a task due before today is overdue.', { [DIGEST]: digest('todayKey'), [DIGEST_TEST]: digestTest(WRAPPED("'task-1'", '')) }, 6);
  commit(dir, 'fix(tasks): count yesterday as today', { [DIGEST]: digest("'2026-10-09'"), [DIGEST_TEST]: digestTest(WRAPPED('', "'task-1'")) }, 7);
  git(dir, ['checkout', '-q', '-b', 'rewrap', 'wrapped~1']);
  commit(dir, 'fix(tasks): compare due keys once', { [DIGEST]: digest('todayKey.slice(0, 10)'), [DIGEST_TEST]: digestTest(REWRAPPED) }, 8);
  git(dir, ['checkout', '-q', '-b', 'typed', 'main']);
  commit(dir, 'test(tasks): cover every urgency band edge\n\nTASKS-12: one typed row per band edge.', { 'src/features/tasks/task-urgency.test.ts': typedTableTest([29, 'later']) }, 9);
  commit(dir, 'fix(tasks): stop calling far-away tasks later', { 'src/features/tasks/task-urgency.test.ts': typedTableTest([29, 'someday']), [URGENCY]: urgency("  if (daysLeft > 28) {\n    return 'someday';\n  }\n") }, 10);
  git(dir, ['checkout', '-q', '-b', 'rename', 'wrapped~1']);
  commit(dir, 'refactor(tasks): rename planDigest to buildDigest', { [DIGEST]: renamed(digest('todayKey')), [DIGEST_TEST]: renamed(digestTest(WRAPPED("'task-1'", ''))) }, 11);
  git(dir, ['checkout', '-q', '-b', 'renamelit', 'wrapped~1']);
  commit(dir, 'refactor(tasks): rename planDigest to buildDigest', { [DIGEST]: renamed(digest('todayKey')), [DIGEST_TEST]: renamed(digestTest(WRAPPED('', "'task-1'"))) }, 12);
  git(dir, ['checkout', '-q', '-b', 'tally', 'main']);
  commit(dir, 'feat(tasks): count open and done tasks\n\nTASKS-30: the header shows how many tasks are open.', { [TALLY]: tally(TALLY_BODY), [TALLY_TEST]: tallyTest('openCount') }, 13);
  git(dir, ['checkout', '-q', '-b', 'swapold', 'tally']);
  commit(dir, 'refactor(tasks): tidy the tally', { [TALLY]: tally('{ doneCount: 2 }'), [TALLY_TEST]: tallyTest('doneCount') }, 14);
  git(dir, ['checkout', '-q', '-b', 'swapkeep', 'tally']);
  commit(dir, 'refactor(tasks): tidy the tally', { [TALLY]: tally('{ openCount: 0, doneCount: 1, pendingCount: 2 }'), [TALLY_TEST]: tallyTest('pendingCount') }, 15);
  git(dir, ['checkout', '-q', 'main']);
  buildFullStack(join(dir, 'fullstack'));
  stage(dir, { [URGENCY]: urgency("  if (daysLeft > 30) {\n    return 'later';\n  }\n") });
}

await runSelftest(import.meta.url, [
  { script: 'check-tests.mjs', fixtures: '../tests/fixtures/check-tests', args: (dir) => [dir] },
  { script: 'check-test-edits.mjs', fixtures: '../tests/fixtures/check-test-edits', args: (dir) => ['--log', join(dir, 'history.log')] },
  { script: 'check-test-edits.mjs', fixtures: '../tests/fixtures/check-test-edits-git', base: [{ build: async (dir) => buildHistory(dir) }], args: (dir) => [dir, '--range', 'HEAD~2..HEAD'] },
]);
