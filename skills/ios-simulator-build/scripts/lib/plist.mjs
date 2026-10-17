// plist.mjs: reads Apple property lists (Info.plist, PrivacyInfo.xcprivacy, entitlements,
// ExportOptions, InfoPlist.strings in plist form) into plain JS values, and writes the XML form
// (a helper, not an entry point; zero dependencies, no plutil needed, so it runs on Linux CI too).
//
//   readPlist(path)            XML or binary (bplist00) file -> value; a malformed file stops with exit 2
//   parsePlistXml(xml)         XML text -> value; malformed input stops with exit 2 (UsageError)
//   parseXmlPlist(xml)         the same parser, throwing a plain Error instead (for callers that catch)
//   parseBinaryPlist(buffer)   bplist00 bytes -> value (throws a plain Error when malformed)
//   plistGet(value, 'A.B.C')   a dotted key path, or undefined
//   toPlistXml(value)          a value -> XML plist text (for fixtures and generators)
// Supported types: dict, array, string, integer, real, true, false, date (an ISO string such as
// "2026-10-03T12:00:00Z") and data (a base64 string); a binary UID becomes { UID: <number> }.

import { readFileSync } from 'node:fs';

import { fail } from '../check-lib.mjs';

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

class PlistError extends Error {}

function decode(text) {
  return text.replace(/&(lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (match, named, dec, hex) => {
    if (named) return ENTITIES[match.toLowerCase()] ?? match;
    return String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16));
  });
}

/** Tokenise the XML body into tags and text, dropping comments, the prolog and the doctype. */
function tokens(xml) {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/i, '');
  const out = [];
  const re = /<(\/?)([A-Za-z]+)(?:\s+[^>]*?)?\s*(\/?)>|([^<]+)/g;
  for (const match of body.matchAll(re)) {
    if (match[2]) out.push({ close: match[1] === '/', name: match[2], empty: match[3] === '/' });
    else if (match[4].trim() !== '') out.push({ text: match[4] });
  }
  return out;
}

function parseValue(list, state) {
  const token = list[state.i];
  if (!token || token.text !== undefined || token.close) throw new PlistError(`malformed plist near token ${state.i}`);
  state.i += 1;
  const { name, empty } = token;
  if (name === 'true' || name === 'false') {
    if (!empty) state.i += 1;
    return name === 'true';
  }
  if (name === 'dict') return empty ? {} : parseDict(list, state);
  if (name === 'array') return empty ? [] : parseArray(list, state);
  if (empty) {
    if (['string', 'data', 'date'].includes(name)) return '';
    throw new PlistError(`unexpected <${name}/> in plist`);
  }
  if (!['string', 'integer', 'real', 'date', 'data', 'key'].includes(name)) throw new PlistError(`unsupported <${name}> in plist`);
  const text = list[state.i]?.text !== undefined ? list[state.i++].text : '';
  if (!(list[state.i]?.close && list[state.i].name === name)) throw new PlistError(`<${name}> is not closed near token ${state.i}`);
  state.i += 1;
  if (name === 'integer') return Number.parseInt(text.trim(), 10);
  if (name === 'real') return Number.parseFloat(text.trim());
  if (name === 'data') return text.replace(/\s+/g, '');
  return decode(text);
}

function parseDict(list, state) {
  const dict = {};
  while (list[state.i] && !(list[state.i].close && list[state.i].name === 'dict')) {
    const keyTag = list[state.i];
    if (keyTag.name !== 'key') throw new PlistError(`plist dict entry without <key> near token ${state.i}`);
    state.i += 1;
    const key = list[state.i]?.text !== undefined ? decode(list[state.i++].text) : '';
    state.i += 1; // </key>
    dict[key] = parseValue(list, state);
  }
  if (!list[state.i]) throw new PlistError('unterminated <dict>');
  state.i += 1;
  return dict;
}

function parseArray(list, state) {
  const array = [];
  while (list[state.i] && !(list[state.i].close && list[state.i].name === 'array')) array.push(parseValue(list, state));
  if (!list[state.i]) throw new PlistError('unterminated <array>');
  state.i += 1;
  return array;
}

function parseXml(xml) {
  const list = tokens(xml);
  const start = list.findIndex((token) => token.name === 'plist' && !token.close);
  if (start === -1) throw new PlistError('not an XML property list (no <plist> element)');
  return parseValue(list, { i: start + 1 });
}

/** Parse XML plist text; malformed input stops the checker with exit 2. */
export function parsePlistXml(xml) {
  try {
    return parseXml(xml);
  } catch (error) {
    if (error instanceof PlistError) fail(error.message, 'Check the file with plutil -lint (or pass an Info.plist, entitlements or ExportOptions file).');
    throw error;
  }
}

/** Parse XML plist text; malformed input throws a plain Error. */
export function parseXmlPlist(xml) {
  try {
    return parseXml(xml);
  } catch (error) {
    if (error instanceof PlistError) throw new Error(error.message);
    throw error;
  }
}

/** Parse a binary property list (bplist00). Throws a plain Error when it is malformed. */
export function parseBinaryPlist(buffer) {
  if (buffer.length < 40 || buffer.toString('latin1', 0, 6) !== 'bplist') throw new Error('not a binary plist');
  const trailer = buffer.subarray(buffer.length - 32);
  const offsetSize = trailer[6];
  const refSize = trailer[7];
  const count = Number(trailer.readBigUInt64BE(8));
  const top = Number(trailer.readBigUInt64BE(16));
  const tableAt = Number(trailer.readBigUInt64BE(24));
  if (offsetSize < 1 || offsetSize > 8 || refSize < 1 || refSize > 8 || tableAt + count * offsetSize > buffer.length - 32 || top >= count) throw new Error('malformed binary plist trailer');
  const uint = (at, size) => {
    let value = 0;
    for (let k = 0; k < size; k += 1) value = value * 256 + buffer[at + k];
    return value;
  };
  const offsets = Array.from({ length: count }, (_, index) => uint(tableAt + index * offsetSize, offsetSize));
  const depth = new Set();
  const read = (ref) => {
    if (ref >= count) throw new Error(`binary plist object ${ref} is out of range`);
    if (depth.has(ref)) throw new Error('binary plist refers to itself');
    depth.add(ref);
    try {
      return readObject(offsets[ref]);
    } finally {
      depth.delete(ref);
    }
  };
  const lengthAt = (at, nibble) => {
    if (nibble !== 0x0f) return { length: nibble, start: at + 1 };
    const marker = buffer[at + 1];
    if (marker >> 4 !== 0x1) throw new Error('malformed binary plist length');
    const size = 1 << (marker & 0x0f);
    return { length: uint(at + 2, size), start: at + 2 + size };
  };
  const readObject = (at) => {
    const marker = buffer[at];
    const type = marker >> 4;
    const nibble = marker & 0x0f;
    if (type === 0x0) {
      if (nibble === 0x8) return false;
      if (nibble === 0x9) return true;
      return null;
    }
    if (type === 0x1) {
      const size = 1 << nibble;
      if (size === 8) return Number(buffer.readBigInt64BE(at + 1));
      if (size > 8) return Number(buffer.readBigInt64BE(at + 1 + size - 8));
      return uint(at + 1, size);
    }
    if (type === 0x2) return nibble === 2 ? buffer.readFloatBE(at + 1) : buffer.readDoubleBE(at + 1);
    if (type === 0x3) return new Date((buffer.readDoubleBE(at + 1) + 978307200) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (type === 0x8) return { UID: uint(at + 1, nibble + 1) };
    const { length, start } = lengthAt(at, nibble);
    if (type === 0x4) return buffer.subarray(start, start + length).toString('base64');
    if (type === 0x5) return buffer.toString('latin1', start, start + length);
    if (type === 0x6) {
      const bytes = Buffer.from(buffer.subarray(start, start + length * 2));
      return bytes.swap16().toString('utf16le');
    }
    if (type === 0x7) return buffer.toString('utf8', start, start + length);
    if (type === 0xa || type === 0xc) return Array.from({ length }, (_, index) => read(uint(start + index * refSize, refSize)));
    if (type === 0xd) {
      const dict = {};
      for (let index = 0; index < length; index += 1) {
        const key = read(uint(start + index * refSize, refSize));
        dict[String(key)] = read(uint(start + (length + index) * refSize, refSize));
      }
      return dict;
    }
    throw new Error(`unsupported binary plist object type 0x${marker.toString(16)}`);
  };
  return read(top);
}

/** Read a plist file of either form; a malformed file stops the checker with exit 2. */
export function readPlist(path) {
  const buffer = readFileSync(path);
  if (buffer.subarray(0, 6).toString('latin1') === 'bplist') {
    try {
      return parseBinaryPlist(buffer);
    } catch (error) {
      fail(`cannot read the binary plist ${path} (${error.message})`, 'Check the file with plutil -lint, or convert it first: plutil -convert xml1 <file>.');
    }
  }
  return parsePlistXml(buffer.toString('utf8'));
}

/** Read a dotted key path such as "NSAppTransportSecurity.NSAllowsArbitraryLoads". */
export function plistGet(object, keyPath) {
  return keyPath.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);
}

const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A value as XML plist text (strings, numbers, booleans, arrays, plain objects). */
export function toPlistXml(value) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">', '<plist version="1.0">'];
  const emit = (item, indent) => {
    const pad = '\t'.repeat(indent);
    if (typeof item === 'boolean') lines.push(`${pad}<${item}/>`);
    else if (typeof item === 'number') lines.push(Number.isInteger(item) ? `${pad}<integer>${item}</integer>` : `${pad}<real>${item}</real>`);
    else if (typeof item === 'string') lines.push(`${pad}<string>${escapeXml(item)}</string>`);
    else if (Array.isArray(item)) {
      if (item.length === 0) lines.push(`${pad}<array/>`);
      else {
        lines.push(`${pad}<array>`);
        for (const entry of item) emit(entry, indent + 1);
        lines.push(`${pad}</array>`);
      }
    } else if (item !== null && typeof item === 'object') {
      const keys = Object.keys(item);
      if (keys.length === 0) lines.push(`${pad}<dict/>`);
      else {
        lines.push(`${pad}<dict>`);
        for (const key of keys) {
          lines.push(`${pad}\t<key>${escapeXml(key)}</key>`);
          emit(item[key], indent + 1);
        }
        lines.push(`${pad}</dict>`);
      }
    } else throw new Error(`toPlistXml cannot write ${item === null ? 'null' : typeof item}`);
  };
  emit(value, 0);
  lines.push('</plist>', '');
  return lines.join('\n');
}
