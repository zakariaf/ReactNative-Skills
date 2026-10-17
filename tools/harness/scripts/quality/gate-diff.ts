// scripts/quality/gate-diff.ts
// The pure comparison behind the guardrail (check-quality-gates.ts): what a tool resolves against
// what quality-gates.json expects.

/** A JSON value as quality-gates.json holds it. */
export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diffArray(expected: readonly Json[], actual: unknown, where: string): readonly string[] {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    return [`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  }
  return expected.flatMap((item, index) =>
    diffSubset(item, actual[index], `${where}[${String(index)}]`),
  );
}

/**
 * Lists every place where `actual` differs from `expected`. Objects are compared key by key
 * (keys only in `actual`, such as defaults a tool fills in, are allowed); arrays must have the
 * same length and matching items; primitives must be equal.
 */
export function diffSubset(expected: Json, actual: unknown, where: string): readonly string[] {
  if (Array.isArray(expected)) {
    return diffArray(expected, actual, where);
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) {
      return [`${where}: expected an object, got ${JSON.stringify(actual)}`];
    }
    return Object.entries(expected).flatMap(([key, value]) =>
      diffSubset(value, actual[key], `${where}.${key}`),
    );
  }
  return expected === actual
    ? []
    : [`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

/**
 * Lists every expected value that `actual` lost. Unlike diffSubset, a list passes when each expected
 * item has a matching item anywhere in the actual list, so an app may keep entries of its own (a deny
 * rule, another hook) next to the gate's. Objects and primitives compare as in diffSubset.
 */
export function diffContains(expected: Json, actual: unknown, where: string): readonly string[] {
  if (Array.isArray(expected)) {
    return containsEvery(expected, actual, where);
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) {
      return [`${where}: expected an object, got ${JSON.stringify(actual)}`];
    }
    return Object.entries(expected).flatMap(([key, value]) =>
      diffContains(value, actual[key], `${where}.${key}`),
    );
  }
  return diffSubset(expected, actual, where);
}

function containsEvery(
  expected: readonly Json[],
  actual: unknown,
  where: string,
): readonly string[] {
  if (!Array.isArray(actual)) {
    return [`${where}: expected a list, got ${JSON.stringify(actual)}`];
  }
  const items: readonly unknown[] = actual;
  return expected
    .filter((item) => !items.some((other) => diffContains(item, other, where).length === 0))
    .map((item) => `${where}: lost ${JSON.stringify(item)}`);
}

/**
 * Replaces the absolute folder Jest resolved `<rootDir>` to with the tag again, in every string of a
 * resolved config, so quality-gates.json holds paths that are the same on every machine.
 */
export function withRootDirTag(value: unknown, rootDir: string): unknown {
  if (typeof value === 'string') {
    return value.split(rootDir).join('<rootDir>');
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => withRootDirTag(item, rootDir));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withRootDirTag(item, rootDir)]),
    );
  }
  return value;
}

/** What addedKeys looks for, and the path label of the compared value. */
export type AddedKeysOptions = {
  readonly keys: readonly string[];
  readonly where: string;
};

/**
 * Lists every place where `actual` holds one of `keys` that `expected` does not have at the same
 * path. diffSubset allows extra keys (tools add defaults), so a key that switches a gate off, such
 * as `skip: true` in a local lefthook-local.yml, needs this second look.
 */
export function addedKeys(
  expected: Json,
  actual: unknown,
  { keys, where }: AddedKeysOptions,
): readonly string[] {
  if (Array.isArray(actual)) {
    const items: readonly Json[] = Array.isArray(expected) ? expected : [];
    return actual.flatMap((item: unknown, index) =>
      addedKeys(items[index] ?? null, item, {
        keys,
        where: `${where}[${String(index)}]`,
      }),
    );
  }
  if (!isRecord(actual)) {
    return [];
  }
  const known: Readonly<Record<string, Json>> = isRecord(expected) ? expected : {};
  const added = keys
    .filter((key) => key in actual && !(key in known))
    .map((key) => `${where}.${key}: ${JSON.stringify(actual[key])} switches a gate off`);
  return [
    ...added,
    ...Object.entries(actual).flatMap(([key, value]) =>
      addedKeys(known[key] ?? null, value, { keys, where: `${where}.${key}` }),
    ),
  ];
}
