// src/core/game/testing/json-shape.ts
// Game states and moves are saved as JSON and compared as JSON, so anything JSON drops or changes
// is a bug the contract test names by path.

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function scalarProblem(value: unknown, path: string): string | null {
  if (value === undefined) return `${path} is undefined (JSON drops it)`;
  if (typeof value === 'number' && !Number.isFinite(value)) return `${path} is ${String(value)}`;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return `${path} is a ${typeof value}`;
  }
  return null;
}

/**
 * Lists every value in `value` that would not survive JSON.stringify/JSON.parse unchanged:
 * undefined, NaN, Infinity, functions, symbols, bigints, Map, Set, Date, class instances and
 * typed arrays. Game states and moves are saved as JSON, so this list must be empty.
 */
export function jsonShapeProblems(value: unknown, path = 'state'): readonly string[] {
  const scalar = scalarProblem(value, path);
  if (scalar !== null) return [scalar];
  if (typeof value !== 'object' || value === null) return [];
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.flatMap((item, index) => jsonShapeProblems(item, `${path}[${String(index)}]`));
  }
  if (!isPlainObject(value)) return [`${path} is a ${value.constructor.name}, not a plain object`];
  return Object.entries(value).flatMap(([key, item]) => jsonShapeProblems(item, `${path}.${key}`));
}

/** JSON text of a value, for structural comparison of states and moves. */
export function jsonOf(value: unknown): string {
  return JSON.stringify(value);
}
