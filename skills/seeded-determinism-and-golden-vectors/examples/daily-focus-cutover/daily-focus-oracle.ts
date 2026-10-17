// scripts/oracles/daily-focus-oracle.ts (example: the template oracle after the version 2 cutover)
// The independent oracle for the daily-focus generator. It is written from the written spec (FNV-1a,
// the murmur3 finaliser, PractRand sfc32, the documented draw order, canonical JSON) in BigInt
// arithmetic and imports nothing: it shares no code with src/, so a bug in the generator or in a
// core module cannot hide in the expected values. It computes what each vector row must hold.

const U32 = 0xffff_ffffn;
const TWO_32 = 0x1_0000_0000n;
const GAMMA = 0x9e37_79b9n;
const FNV_BASIS = 0x811c_9dc5n;
const FNV_PRIME = 0x0100_0193n;
const WARM_UP = 12;

/** The salt and catalogs, copied from the spec, not imported from the generator. */
const SALT = 0x2f6b_4c1dn;
const itemIds = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `item-${String(index + 1).padStart(2, '0')}`);
/** Per version: the catalog and the number of picks (version 2 added four ids and one pick). */
const VERSIONS: Readonly<
  Record<number, { readonly catalog: readonly string[]; readonly picks: number }>
> = {
  1: { catalog: itemIds(12), picks: 3 },
  2: { catalog: itemIds(16), picks: 4 },
};

type Words = readonly [bigint, bigint, bigint, bigint];

/** A row of the vectors file; fingerprint and summary are absent until the oracle fills them. */
export type VectorRow = {
  readonly key: string;
  readonly version: number;
  readonly fingerprint?: string;
  readonly summary?: string;
  readonly note: string;
};

/** What the oracle says a row must hold. */
export type OracleRow = { readonly fingerprint: string; readonly summary: string };

const u32 = (value: bigint): bigint => value & U32;

/** FNV-1a 32 over UTF-16 code units, from any offset basis. */
export function fnv1a32(text: string, basis: bigint = FNV_BASIS): bigint {
  let hash = basis;
  for (let index = 0; index < text.length; index += 1) {
    hash = u32((hash ^ BigInt(text.charCodeAt(index))) * FNV_PRIME);
  }
  return hash;
}

function fmix32(value: bigint): bigint {
  let z = u32(value);
  z = u32((z ^ (z >> 16n)) * 0x85eb_ca6bn);
  z = u32((z ^ (z >> 13n)) * 0xc2b2_ae35n);
  return z ^ (z >> 16n);
}

function step(words: Words): readonly [bigint, Words] {
  const [a, b, c, d] = words;
  const output = u32(a + b + d);
  const rotated = u32(c << 21n) | (c >> 11n);
  return [output, [b ^ (b >> 9n), u32(c + (c << 3n)), u32(rotated + output), u32(d + 1n)]];
}

/** The warmed-up sfc32 state for a seed (the seed read as a signed 32-bit integer). */
export function seedWords(seed: bigint): Words {
  const signed = BigInt.asIntN(32, seed);
  let words: Words = [
    fmix32(signed + GAMMA),
    fmix32(signed + 2n * GAMMA),
    fmix32(signed + 3n * GAMMA),
    fmix32(signed + 4n * GAMMA),
  ];
  for (let index = 0; index < WARM_UP; index += 1) words = step(words)[1];
  return words;
}

/** The first `count` raw sfc32 outputs from a state. */
export function rawDraws(words: Words, count: number): readonly bigint[] {
  const out: bigint[] = [];
  let current = words;
  for (let index = 0; index < count; index += 1) {
    const [value, next] = step(current);
    out.push(value);
    current = next;
  }
  return out;
}

function below(words: Words, bound: number): readonly [number, Words] {
  const n = BigInt(bound);
  const limit = TWO_32 - (TWO_32 % n);
  let [value, next] = step(words);
  while (value >= limit) [value, next] = step(next);
  return [Number(value % n), next];
}

function sample(items: readonly string[], count: number, words: Words): readonly string[] {
  const out = [...items];
  let current = words;
  for (let index = 0; index < count; index += 1) {
    const [offset, next] = below(current, out.length - index);
    const pick = out[index + offset] ?? '';
    out[index + offset] = out[index] ?? '';
    out[index] = pick;
    current = next;
  }
  return out.slice(0, count);
}

/** The vector row of a version for a civil-date key. */
export function oracleRow(key: string, version: number): OracleRow {
  const spec = VERSIONS[version];
  if (spec === undefined) throw new RangeError(`the oracle knows no version ${String(version)}`);
  const picked = sample(spec.catalog, spec.picks, seedWords(fnv1a32(key, FNV_BASIS ^ SALT)));
  // Canonical JSON written by hand: keys in code-unit order (itemIds < key < version).
  const json = `{"itemIds":[${picked.map((id) => JSON.stringify(id)).join(',')}],"key":${JSON.stringify(key)},"version":${String(version)}}`;
  return { fingerprint: fnv1a32(json).toString(16).padStart(8, '0'), summary: picked.join(' ') };
}

/**
 * Fills each row's missing fingerprint and summary. A filled row that disagrees with the oracle is
 * reported and kept as it is: a shipped output never changes (add a version instead).
 */
export function fillVectorRows(
  rows: readonly VectorRow[],
  compute: (key: string, version: number) => OracleRow,
): { readonly rows: readonly VectorRow[]; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const filled = rows.map((row) => {
    const expected = compute(row.key, row.version);
    const isFilled = row.fingerprint !== undefined || row.summary !== undefined;
    if (
      isFilled &&
      (row.fingerprint !== expected.fingerprint || row.summary !== expected.summary)
    ) {
      problems.push(`${row.key} v${String(row.version)}: the oracle gives ${expected.fingerprint}`);
      return row;
    }
    return { key: row.key, version: row.version, ...expected, note: row.note };
  });
  return { rows: filled, problems };
}
