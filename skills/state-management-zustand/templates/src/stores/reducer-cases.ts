// src/stores/reducer-cases.ts: a reducer's rules as plain data, run by its test and by check-reducers.
// Pure TypeScript (no React, no Zustand): a cases file imports only types from here and its reducer.

/** What a case expects: objects match key by key (keys left out are free), arrays item by item. */
export type Expectation<TValue> = TValue extends readonly (infer TItem)[]
  ? readonly Expectation<TItem>[]
  : TValue extends object
    ? { readonly [TKey in keyof TValue]?: Expectation<TValue[TKey]> }
    : TValue;

type CaseBase<TState, TAction> = {
  /** The app's kebab-case name for the rule this case pins; a failure names it. */
  readonly rule: string;
  /** The state before the action; the table's `initial` when left out. */
  readonly state?: TState;
  readonly action: TAction;
};

/** One action and what it must do: change the state as `expect` says, or return the same object. */
export type ReducerCase<TState, TAction> = CaseBase<TState, TAction> &
  ({ readonly same: true } | { readonly expect: Expectation<TState> });

/** Every case of one reducer. States and actions are plain data (JSON values only). */
export type ReducerCases<TState, TAction> = {
  /** The export of the sibling `<name>-reducer.ts` these cases run, for example 'tasksReducer'. */
  readonly reducer: string;
  /**
   * For a rules-bound reducer (`reducer(rules, state, action)`, such as a game session reducer bound to
   * its game's rules): the export of this cases file (or of the reducer file) holding the rules.
   * check-reducers passes it first; the reducer's test binds it the same way before calling caseProblem.
   */
  readonly rules?: string;
  readonly initial: TState;
  readonly cases: readonly ReducerCase<TState, TAction>[];
};

/** A pure `(state, action) => state` function. */
export type Reducer<TState, TAction> = (state: TState, action: TAction) => TState;

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function listMismatch(actual: unknown, expected: readonly unknown[], path: string): string | null {
  if (!isList(actual) || actual.length !== expected.length) {
    return `${path}: expected ${String(expected.length)} items, got ${JSON.stringify(actual)}`;
  }
  for (const [index, item] of expected.entries()) {
    const problem = mismatchOf(actual[index], item, `${path}[${String(index)}]`);
    if (problem !== null) return problem;
  }
  return null;
}

/** Where `actual` differs from `expected` (the path and both values), or null when it matches. */
export function mismatchOf(actual: unknown, expected: unknown, path = '$'): string | null {
  if (isList(expected)) return listMismatch(actual, expected, path);
  if (!isRecord(expected)) {
    return Object.is(actual, expected)
      ? null
      : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  }
  if (!isRecord(actual)) return `${path}: expected an object, got ${JSON.stringify(actual)}`;
  for (const [key, value] of Object.entries(expected)) {
    const problem = mismatchOf(actual[key], value, `${path}.${key}`);
    if (problem !== null) return problem;
  }
  return null;
}

/** Runs one case: null when the reducer keeps the rule, else what went wrong. */
export function caseProblem<TState, TAction>(
  reducer: Reducer<TState, TAction>,
  table: ReducerCases<TState, TAction>,
  item: ReducerCase<TState, TAction>,
): string | null {
  const before = item.state ?? table.initial;
  const after = reducer(before, item.action);
  if ('same' in item) {
    return after === before ? null : 'a change that changes nothing returned a new object';
  }
  return mismatchOf(after, item.expect);
}
