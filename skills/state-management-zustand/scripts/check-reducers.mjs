#!/usr/bin/env node
// check-reducers.mjs: runs the app's own pure reducers in Node (type stripping) against their rules,
// independent of the app's tests: every *-reducer.ts loads without runtime imports, and the cases
// table beside it (<name>-reducer-cases.ts) holds: each expectation, the same object for a change
// that changes nothing, no mutation of a deep-frozen input, the same output for the same input.
// The undoable session reducer (it exports undoableSessionReducer) is run against the session rules
// with a built-in counter instead.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-reducers.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, notYetCreated, parseArgs, readWorkspaces, requireDir, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { enableAppImports, lineOfExport, reasonOf } from './lib/app-modules.mjs';
import { runCaseTable, tablesOf } from './lib/reducer-cases.mjs';
import { SESSION_CHECKS } from './lib/session-checks.mjs';
import { isTestFile } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-reducers',
  summary: "Runs an Expo app's pure reducers (every src/**/*-reducer.ts) against the cases table beside each one and the generic reducer invariants, and the undoable session reducer against the session rules.",
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'The app source folder (default: from resolveLayout, src)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  module-load               a reducer or its cases file cannot be imported in Node (a runtime import, an enum,',
    '                            other syntax type stripping cannot erase): itself a purity failure',
    '  reducer-cases-missing     a *-reducer.ts without its <name>-reducer-cases.ts table',
    '  reducer-cases-invalid     the table names no exported reducer (or rules export, for a rules-bound reducer run as',
    '                            reducer(rules, state, action)), a case lacks rule/action/expect-or-same, or no',
    '                            case pins a change that changes nothing (same: true)',
    '  reducer-case              a case\'s expectation does not hold, or the reducer throws on it',
    '  reducer-no-op-new-object  a "same: true" case returned a new object (the store would write and re-render)',
    '  reducer-mutates           the reducer changed its deep-frozen state or action',
    '  reducer-nondeterministic  the same state and action gave different results twice (hidden module state, time)',
    '  session-command           apply-command does not record the state, the past, the log and a new revision, or',
    '                            a refused command changed the session',
    '  session-undo              undo ignores the undo policy (none, limited) or does not step back exactly one command',
    '  session-paused            a paused session takes commands or time, or resume does not return to active',
    '  session-finished          a finished session takes commands or undo',
    '',
    'NOT APPLICABLE when zustand is not in package.json, or when src/ holds no *-reducer.ts (no stores yet).',
    'SKIP <file> [reducer-cases-missing] for a reducer another skill ships until its cases file exists',
    '(src/stores/settings/settings-reducer.ts: settings-and-preferences).',
    'Example: node check-reducers.mjs .',
  ].join('\n'),
};

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${what} ${path} is not valid JSON: ${error.message}`, 'Fix the JSON syntax.');
  }
}

function hasZustand(root) {
  const manifests = [readJson(join(root, 'package.json'), 'package.json'), ...readWorkspaces(root).map((entry) => entry.manifest ?? {})];
  return manifests.some((manifest) => ['dependencies', 'devDependencies', 'peerDependencies'].some((key) => 'zustand' in (manifest?.[key] ?? {})));
}

/** Reducers other skills ship: their cases file is that skill's to add (a SKIP until it lands). */
const OWNED_ELSEWHERE = [{ path: (layout) => `${layout.storesDir}/settings/settings-reducer.ts`, owner: 'settings-and-preferences' }];

function checkSession(report, rel, mod, source) {
  let checked = 0;
  for (const check of SESSION_CHECKS) {
    checked += 1;
    try {
      check.run(mod);
    } catch (error) {
      report.problem({ file: rel, line: lineOfExport(source, 'undoableSessionReducer'), rule: check.rule, message: `undoableSessionReducer: ${check.name}: ${reasonOf(error)}`, fix: check.fix });
    }
  }
  return checked;
}

async function checkReducer(ctx, rel) {
  const { app, report, root, layout } = ctx;
  const source = readFileSync(join(root, rel), 'utf8');
  let mod;
  try {
    mod = await app.load(rel);
  } catch (error) {
    report.problem({ file: rel, line: 1, rule: 'module-load', message: `cannot be imported: ${String(error.message).split('\n')[0]}`, fix: 'Keep reducers pure: import only types and pure modules (no React, React Native, Expo, Zustand or services), and no enums or other syntax type stripping cannot erase.' });
    return 0;
  }
  if (typeof mod.undoableSessionReducer === 'function') return checkSession(report, rel, mod, source);
  const casesRel = rel.replace(/\.ts$/, '-cases.ts');
  if (!app.exists(casesRel)) {
    const owned = OWNED_ELSEWHERE.find((entry) => entry.path(layout) === rel);
    const reason = owned ? notYetCreated(root, { file: casesRel, owner: owned.owner }) : null;
    if (reason) report.skip({ file: casesRel, rule: 'reducer-cases-missing', message: reason });
    else report.problem({ file: rel, line: 1, rule: 'reducer-cases-missing', message: `${posix.basename(rel)} has no ${posix.basename(casesRel)}`, fix: 'Write the cases table beside the reducer (templates/src/stores/tasks-reducer-cases.ts shows the shape): the rules as plain data, at least one same: true case; its test runs the same table with caseProblem.' });
    return 0;
  }
  let cases;
  try {
    cases = await app.load(casesRel);
  } catch (error) {
    report.problem({ file: casesRel, line: 1, rule: 'module-load', message: `cannot be imported: ${String(error.message).split('\n')[0]}`, fix: 'A cases file imports only types (its reducer\'s and ReducerCases) and holds plain data.' });
    return 0;
  }
  const tables = tablesOf(cases);
  if (tables.length === 0) {
    report.problem({ file: casesRel, line: 1, rule: 'reducer-cases-invalid', message: 'exports no cases table ({ reducer, initial, cases })', fix: 'Export one ReducerCases object: export const TASKS_REDUCER_CASES: ReducerCases<TasksState, TasksAction> = { reducer, initial, cases }.' });
    return 0;
  }
  let checked = 0;
  for (const { name, table } of tables) {
    checked += runCaseTable({ report, rel, casesRel, source, mod, casesMod: cases, name, table });
  }
  return checked;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  const report = createReporter({ name: 'check-reducers', json: options.json });
  if (!existsSync(join(root, 'package.json'))) throw new UsageError('package.json not found', 'Run from the app repo root, or pass it as the first argument.');
  if (!hasZustand(root)) return report.notApplicable('zustand is not in package.json (no client stores to check)');
  const srcDirs = layout.mode === 'monorepo' && options['src-dir'] === undefined
    ? layout.workspaces.map((entry) => entry.layout.srcDir).filter((dir) => existsSync(join(root, dir)))
    : [layout.srcDir];
  for (const dir of srcDirs.length > 0 ? srcDirs : [layout.srcDir]) requireDir(join(root, dir), `app source folder (${dir})`);
  const reducers = walkRepo(root, { include: ['*-reducer.ts'] }).filter((rel) => srcDirs.some((dir) => rel.startsWith(`${dir}/`)) && !isTestFile(rel));
  if (reducers.length === 0) return report.notApplicable(`no reducers: no *-reducer.ts under ${srcDirs.join(', ')} (the app keeps no client state in stores yet)`);
  const app = enableAppImports(root, { aliases: layout.aliases });
  const ctx = { app, report, root, layout };
  let checked = 0;
  for (const rel of reducers) checked += await checkReducer(ctx, rel);
  return report.finish({ checked: reducers.length, unit: 'reducers' });
});
