// src/core/portable/utf8.ts: UTF-8 bytes and byte length of a string, the same in Hermes, Jest and Node.

const REPLACEMENT = 0xfffd;

/** The code point of a character; a lone surrogate becomes U+FFFD, as TextEncoder and Node's 'utf8' do. */
function scalarOf(char: string): number {
  const point = char.codePointAt(0) ?? REPLACEMENT;
  return point >= 0xd800 && point <= 0xdfff ? REPLACEMENT : point;
}

/** UTF-8 bytes of `text` (sized once, filled in place: this runs over whole backups). */
export function utf8Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(utf8ByteLength(text));
  let at = 0;
  for (const char of text) {
    const point = scalarOf(char);
    if (point < 0x80) {
      bytes[at++] = point;
    } else if (point < 0x800) {
      bytes[at++] = 0xc0 | (point >> 6);
      bytes[at++] = 0x80 | (point & 0x3f);
    } else if (point < 0x10000) {
      bytes[at++] = 0xe0 | (point >> 12);
      bytes[at++] = 0x80 | ((point >> 6) & 0x3f);
      bytes[at++] = 0x80 | (point & 0x3f);
    } else {
      bytes[at++] = 0xf0 | (point >> 18);
      bytes[at++] = 0x80 | ((point >> 12) & 0x3f);
      bytes[at++] = 0x80 | ((point >> 6) & 0x3f);
      bytes[at++] = 0x80 | (point & 0x3f);
    }
  }
  return bytes;
}

function utf8BytesOf(point: number): number {
  if (point < 0x80) return 1;
  if (point < 0x800) return 2;
  return point < 0x10000 ? 3 : 4;
}

/** The UTF-8 length of `text` without allocating the bytes (a file's size, a disk-space check). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) bytes += utf8BytesOf(char.codePointAt(0) ?? REPLACEMENT);
  return bytes;
}
