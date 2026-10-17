// src/core/portable/canonical-json.ts: one byte-exact JSON text per value (sorted keys, no spaces), for checksums and round-trip tests.
import { attempt } from '@/core/result';

/** What a machine-readable export may hold: no undefined, no Date, no class instances, no NaN. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type JsonObject = Readonly<Record<string, JsonValue>>;

/** true for a plain JSON object (not null, not an array). */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** true for a JSON array (Array.isArray does not narrow a readonly array type). */
export function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/**
 * The canonical text: object keys sorted by UTF-16 code units (Array.prototype.sort), arrays in
 * their order, strings and numbers exactly as JSON.stringify writes them, no whitespace. The same
 * value always gives the same bytes, on every device and in Node, so a checksum over it and a test
 * that compares two exports byte for byte both work. A non-finite number throws a RangeError:
 * JSON.stringify would silently write null, a value the file never held.
 */
export function canonicalJson(value: JsonValue): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`not a JSON number: ${String(value)}`);
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (isJsonArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const members = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`);
  return `{${members.join(',')}}`;
}

/** JSON.parse that returns undefined instead of throwing on text that is not JSON (an expected answer). */
export function parseJson(text: string): JsonValue | undefined {
  const parsed = attempt(
    () => JSON.parse(text) as JsonValue,
    () => undefined,
  );
  return parsed.ok ? parsed.value : undefined;
}
