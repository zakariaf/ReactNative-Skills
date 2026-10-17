// src/core/dates/daily-seed.ts
import type { DateKey } from './date-key';

/**
 * Same civil date + same feature salt -> the same uint32 seed on every device. FNV-1a over the
 * key's UTF-16 code units with the salt XORed into the offset basis (Math.imul only). Not mixed:
 * when two days differ only in the last digit, their seeds differ by a small odd multiple of the
 * FNV prime mod 2^32 (exactly plus or minus the prime for 0/1, 2/3, 4/5, 6/7 and 8/9), so always
 * pass the result to seedRng (src/core/rng/sfc32.ts) before drawing, never use it as a value
 * (`seed % n`). The goldens in daily-seed.test.ts are a compatibility contract: changing this
 * function changes every day-keyed output on every installed copy.
 */
export function dailySeed(date: DateKey, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let index = 0; index < date.length; index += 1) {
    hash = Math.imul(hash ^ date.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}
