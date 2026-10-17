// font-tables.mjs: reads the few TrueType/OpenType tables the design-system checks need, with no
// package: the PostScript name (name table, nameID 6), units per em (head) and the vertical metrics
// iOS and Android lay a line out with (hhea ascender, descender, line gap).
//
//   const font = readFontTables(buffer);   // { postScriptName, unitsPerEm, ascender, descender, lineGap }
//   const em = contentBoxEm(font);          // (ascender + |descender|) / unitsPerEm
//
// Throws FontTableError with a one-line reason for a file that is not a font or lacks a table.

import { readFileSync } from 'node:fs';

export class FontTableError extends Error {}

const SFNT_VERSIONS = new Set([0x00010000, 0x4f54544f, 0x74727565]); // TrueType, 'OTTO', 'true'

/** { tag: { offset, length } } of an sfnt font (a .ttf or .otf file). */
export function tableDirectory(buffer) {
  if (buffer.length < 12) throw new FontTableError('too short to be a font (no sfnt header)');
  const version = buffer.readUInt32BE(0);
  if (!SFNT_VERSIONS.has(version)) throw new FontTableError(`not a TrueType/OpenType font (sfnt version 0x${version.toString(16)})`);
  const count = buffer.readUInt16BE(4);
  if (buffer.length < 12 + count * 16) throw new FontTableError('the table directory is cut short');
  const tables = {};
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    const tag = buffer.toString('latin1', at, at + 4);
    const offset = buffer.readUInt32BE(at + 8);
    const length = buffer.readUInt32BE(at + 12);
    if (offset + length > buffer.length) throw new FontTableError(`table ${tag} runs past the end of the file`);
    tables[tag] = { offset, length };
  }
  return tables;
}

function requireTable(tables, tag, minLength) {
  const table = tables[tag];
  if (!table) throw new FontTableError(`no ${tag} table`);
  if (table.length < minLength) throw new FontTableError(`the ${tag} table is too short`);
  return table;
}

/** The PostScript name (nameID 6): Windows Unicode first, then Mac Roman. Null when absent. */
export function postScriptNameOf(buffer, tables) {
  const name = tables.name;
  if (!name || name.length < 6) return null;
  const count = buffer.readUInt16BE(name.offset + 2);
  const strings = name.offset + buffer.readUInt16BE(name.offset + 4);
  let fallback = null;
  for (let i = 0; i < count; i += 1) {
    const at = name.offset + 6 + i * 12;
    if (at + 12 > name.offset + name.length) break;
    const platform = buffer.readUInt16BE(at);
    const nameId = buffer.readUInt16BE(at + 6);
    const length = buffer.readUInt16BE(at + 8);
    const start = strings + buffer.readUInt16BE(at + 10);
    if (nameId !== 6 || start + length > buffer.length) continue;
    if (platform === 3 || platform === 0) {
      const bytes = Buffer.from(buffer.subarray(start, start + length));
      return bytes.swap16().toString('utf16le');
    }
    if (platform === 1 && fallback === null) fallback = buffer.toString('latin1', start, start + length);
  }
  return fallback;
}

/** The metrics of one font file's buffer. */
export function readFontTables(buffer) {
  const tables = tableDirectory(buffer);
  const head = requireTable(tables, 'head', 54);
  const hhea = requireTable(tables, 'hhea', 36);
  return {
    postScriptName: postScriptNameOf(buffer, tables),
    unitsPerEm: buffer.readUInt16BE(head.offset + 18),
    ascender: buffer.readInt16BE(hhea.offset + 4),
    descender: buffer.readInt16BE(hhea.offset + 6),
    lineGap: buffer.readInt16BE(hhea.offset + 8),
  };
}

export function readFontFile(path) {
  return readFontTables(readFileSync(path));
}

/** The line's content box in em: what a line of this font needs before it overflows its box. */
export function contentBoxEm(font) {
  return (font.ascender + Math.abs(font.descender)) / font.unitsPerEm;
}

/**
 * A minimal valid font with head, hhea and name tables (no glyphs): what the self-test fixtures and
 * a dry run need to prove the metric and name rules without shipping a real font.
 */
export function buildStubFont({ postScriptName, unitsPerEm = 1000, ascender = 800, descender = -200, lineGap = 0 }) {
  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(unitsPerEm, 18);
  const hhea = Buffer.alloc(36);
  hhea.writeUInt32BE(0x00010000, 0);
  hhea.writeInt16BE(ascender, 4);
  hhea.writeInt16BE(descender, 6);
  hhea.writeInt16BE(lineGap, 8);
  const text = Buffer.from(postScriptName, 'utf16le').swap16();
  const name = Buffer.alloc(6 + 12 + text.length);
  name.writeUInt16BE(0, 0);
  name.writeUInt16BE(1, 2);
  name.writeUInt16BE(18, 4);
  name.writeUInt16BE(3, 6);
  name.writeUInt16BE(1, 8);
  name.writeUInt16BE(0x409, 10);
  name.writeUInt16BE(6, 12);
  name.writeUInt16BE(text.length, 14);
  name.writeUInt16BE(0, 16);
  text.copy(name, 18);
  const tables = [['head', head], ['hhea', hhea], ['name', name]];
  const header = Buffer.alloc(12 + tables.length * 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(tables.length, 4);
  let offset = header.length;
  const bodies = [];
  tables.forEach(([tag, body], i) => {
    const at = 12 + i * 16;
    header.write(tag, at, 'latin1');
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(body.length, at + 12);
    const padded = Buffer.alloc(Math.ceil(body.length / 4) * 4);
    body.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}
