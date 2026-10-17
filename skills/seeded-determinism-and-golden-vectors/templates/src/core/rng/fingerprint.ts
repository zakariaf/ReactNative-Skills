// src/core/rng/fingerprint.ts
// The canonical serialization and fingerprint every golden-vector row uses ("fnv1a32/canonical-json-v1").
// Spec: null, booleans, safe integers and strings as JSON.stringify writes them; arrays in order;
// plain objects with keys sorted by UTF-16 code units; no whitespace. Floats, -0, NaN, undefined and
// every other type throw: freeze a float to an integer before it reaches a fingerprint.
import { hashSeed } from './sfc32';

/** The algorithm name stored in every vectors file; a new spec is a new name, never an edit. */
export const FINGERPRINT_ALGORITHM = 'fnv1a32/canonical-json-v1';

function compareCodeUnits(first: string, second: string): number {
  if (first < second) return -1;
  return first > second ? 1 : 0;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalNumber(value: number): string {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
    throw new TypeError(`canonicalJson: ${String(value)} is not a safe integer`);
  }
  return String(value);
}

function canonicalObject(value: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(value).sort(compareCodeUnits);
  const entries = keys.map((key) => {
    if (value[key] === undefined) throw new TypeError(`canonicalJson: "${key}" is undefined`);
    return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
  });
  return `{${entries.join(',')}}`;
}

/** The one serialization a fingerprint is taken of (see the spec above). */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return canonicalNumber(value);
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  }
  if (isPlainObject(value)) return canonicalObject(value);
  throw new TypeError(`canonicalJson: unsupported ${typeof value} value`);
}

/** FNV-1a 32 over the canonical JSON's UTF-16 code units, as 8 lowercase hex digits. */
export function fingerprint(value: unknown): string {
  return hashSeed(canonicalJson(value)).toString(16).padStart(8, '0');
}
