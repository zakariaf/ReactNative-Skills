// reducer-cases.mjs: runs one cases table (src/stores/<name>-reducer-cases.ts) against its reducer,
// with the generic reducer invariants on every case. The semantics of `expect` match the app's own
// src/stores/reducer-cases.ts (mismatchOf), written again here so a broken app helper cannot pass.

import { isDeepStrictEqual } from 'node:util';

import { deepFreeze, lineOfExport, reasonOf } from './app-modules.mjs';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MUTATION = /read[- ]only|not extensible|Cannot assign|Cannot add property|Cannot delete|Cannot redefine|object is not extensible|frozen/i;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Where `actual` differs from `expected` (objects key by key, arrays item by item), or null. */
export function mismatchOf(actual, expected, path = '$') {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return `${path}: expected ${expected.length} items, got ${JSON.stringify(actual)}`;
    for (let index = 0; index < expected.length; index += 1) {
      const problem = mismatchOf(actual[index], expected[index], `${path}[${index}]`);
      if (problem !== null) return problem;
    }
    return null;
  }
  if (!isRecord(expected)) return Object.is(actual, expected) ? null : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  if (!isRecord(actual)) return `${path}: expected an object, got ${JSON.stringify(actual)}`;
  for (const [key, value] of Object.entries(expected)) {
    const problem = mismatchOf(actual[key], value, `${path}.${key}`);
    if (problem !== null) return problem;
  }
  return null;
}

/** Every export of a cases module that looks like a table: [{ name, table }]. */
export function tablesOf(mod) {
  return Object.entries(mod)
    .filter(([, value]) => isRecord(value) && 'reducer' in value && 'cases' in value)
    .map(([name, table]) => ({ name, table }));
}

/** The rules a rules-bound reducer takes first (table.rules names an export of the cases or reducer file). */
function rulesOf(table, mod, casesMod) {
  if (!('rules' in table)) return { bound: false };
  if (typeof table.rules !== 'string') return { bound: true, missing: true };
  const value = casesMod?.[table.rules] ?? mod[table.rules];
  return value === undefined ? { bound: true, missing: true } : { bound: true, value };
}

function tableProblems(table, mod, casesMod) {
  const problems = [];
  if (typeof table.reducer !== 'string' || typeof mod[table.reducer] !== 'function') problems.push(`reducer "${table.reducer}" is not an export of the reducer file`);
  if (rulesOf(table, mod, casesMod).missing) problems.push(`rules "${String(table.rules)}" is not an export of the cases or reducer file (a rules-bound reducer runs as reducer(rules, state, action))`);
  if (!('initial' in table)) problems.push('no initial state');
  if (!Array.isArray(table.cases) || table.cases.length === 0) return [...problems, 'no cases'];
  table.cases.forEach((item, index) => {
    const label = `case ${index + 1}${typeof item?.rule === 'string' ? ` (${item.rule})` : ''}`;
    if (!isRecord(item)) return problems.push(`${label} is not an object`);
    if (typeof item.rule !== 'string' || !KEBAB.test(item.rule)) problems.push(`${label}: rule must be a kebab-case name`);
    if (!isRecord(item.action) || typeof item.action.type !== 'string') problems.push(`${label}: action must be an object with a type`);
    if ((item.same === true) === ('expect' in item)) problems.push(`${label}: needs exactly one of expect or same: true`);
    return undefined;
  });
  if (!table.cases.some((item) => item?.same === true)) problems.push('no case pins a change that changes nothing (same: true)');
  return problems;
}

function attempt(reducer, state, action) {
  const before = deepFreeze(structuredClone(state));
  try {
    return { before, after: reducer(before, deepFreeze(structuredClone(action))) };
  } catch (error) {
    return { before, error };
  }
}

/** Runs every case of one table; returns how many rule checks ran. */
export function runCaseTable({ report, rel, casesRel, source, mod, casesMod, name, table }) {
  const invalid = tableProblems(table, mod, casesMod);
  if (invalid.length > 0) {
    for (const message of invalid) report.problem({ file: casesRel, line: 1, rule: 'reducer-cases-invalid', message: `${name}: ${message}`, fix: 'Follow ReducerCases (src/stores/reducer-cases.ts): { reducer: "<export name>", rules?: "<export name>", initial, cases: [{ rule, state?, action, expect | same: true }] }, with at least one same: true case.' });
    return 1;
  }
  const rules = rulesOf(table, mod, casesMod);
  const reducer = rules.bound ? (state, action) => mod[table.reducer](rules.value, state, action) : mod[table.reducer];
  const line = lineOfExport(source, table.reducer);
  const fail = (rule, item, message, fix) => report.problem({ file: rel, line, rule, message: `${table.reducer}: ${item.rule}: ${message}`, fix });
  let checked = 0;
  for (const item of table.cases) {
    checked += 1;
    const state = 'state' in item ? item.state : table.initial;
    const first = attempt(reducer, state, item.action);
    if (first.error !== undefined) {
      if (first.error instanceof TypeError && MUTATION.test(String(first.error.message))) fail('reducer-mutates', item, `changed its input (${reasonOf(first.error)})`, 'Return new objects ({ ...state, tasks: [...state.tasks, task] }); never assign into, push onto or delete from the state or the action.');
      else fail('reducer-case', item, `threw: ${reasonOf(first.error)}`, 'A reducer never throws for an action its type allows: return the same state for one that does not apply.');
      continue;
    }
    if (item.same === true) {
      if (first.after !== first.before) fail('reducer-no-op-new-object', item, 'returned a new object for a change that changes nothing', 'Return the SAME state object when nothing changes, so the store skips the write and the re-render.');
    } else {
      const problem = mismatchOf(first.after, item.expect);
      if (problem !== null) fail('reducer-case', item, problem, 'Make the reducer keep the rule this case pins (or, when the rule changed on purpose, change the case and its test together).');
    }
    const second = attempt(reducer, state, item.action);
    if (second.error === undefined && !isDeepStrictEqual(structuredClone(first.after), structuredClone(second.after))) {
      fail('reducer-nondeterministic', item, 'gave a different result for the same state and action', 'No module-level counters, caches, clock or randomness in a reducer: everything it needs arrives in the state or the action.');
    }
  }
  return checked;
}
