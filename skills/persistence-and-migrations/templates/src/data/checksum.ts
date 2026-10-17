// src/data/checksum.ts: FNV-1a 32 over UTF-16 code units, as 8 lowercase hex characters.

/**
 * Not security: it detects bit rot, a hand-edited file that is still valid JSON or SQL, and an
 * edited frozen fixture. The checker and inspect-database compute the same value in Node.
 */
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
