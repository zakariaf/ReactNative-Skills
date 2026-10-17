// apk-reader.mjs: reads a built APK with node: built-ins only (a helper, not an entry point). An APK
// is a ZIP file; its AndroidManifest.xml is Android binary XML (AXML), the merged manifest of the app
// and every library. The reader also accepts a folder: an unzipped APK (binary manifest) or a decoded
// one (text manifest, as apktool writes it), so a manifest can be inspected and fixtures stay text.
//
//   readApk(path)                 { kind: 'zip'|'dir', names, has(name), read(name) -> Buffer|null,
//                                   entry(name) -> { method, dataOffset } | null, signingBlock: true|false|null }
//   parseManifest(buffer)         element tree { name, attrs, children } from binary or text XML
//   manifestModel(tree)           { package, versionCode, versionName, minSdk, targetSdk, permissions,
//                                   declaredPermissions: [{ name, signature }], application,
//                                   metaData: [{ name, value }], schemes }
//   isSignatureLevel(level)       true for protectionLevel signature (or signatureOrSystem), as int flags or text
//   elfLoadAlignments(buffer)     the p_align of every PT_LOAD segment of an ELF shared library, or null
//   HERMES_MAGIC                  the first 8 bytes of Hermes bytecode (little-endian 0x1F1903C103BC1FC6)
//   ApkError                      a file that is not an APK, a ZIP or a manifest this reader understands
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
export class ApkError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const SIG_BLOCK_MAGIC = 'APK Sig Block 42';

/** Android framework attribute resource ids, for manifests whose string pool leaves names empty. */
const ATTR_IDS = new Map([
  [0x01010003, 'name'], [0x01010024, 'value'], [0x0101000f, 'debuggable'], [0x0101020c, 'minSdkVersion'],
  [0x01010270, 'targetSdkVersion'], [0x0101021b, 'versionCode'], [0x0101021c, 'versionName'],
  [0x010104ec, 'usesCleartextTraffic'], [0x01010280, 'allowBackup'], [0x01010027, 'scheme'],
  [0x01010001, 'label'], [0x01010002, 'icon'], [0x01010010, 'exported'], [0x01010009, 'protectionLevel'],
]);

// ---------------------------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------------------------

function findEocd(buffer) {
  const stop = Math.max(0, buffer.length - 22 - 0xffff);
  for (let at = buffer.length - 22; at >= stop; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD) return at;
  }
  throw new ApkError('not a ZIP file (no end-of-central-directory record)');
}

function readZipIndex(buffer) {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let at = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== CENTRAL) throw new ApkError(`broken central directory at byte ${at}`);
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    if (buffer.readUInt32LE(local) !== LOCAL) throw new ApkError(`broken local header of ${name}`);
    const dataOffset = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    entries.set(name, { method, compressed, dataOffset });
    at += 46 + nameLength + extra + comment;
  }
  const signingBlock = centralOffset >= 16 && buffer.toString('latin1', centralOffset - 16, centralOffset) === SIG_BLOCK_MAGIC;
  return { entries, signingBlock };
}

function zipApk(path) {
  const buffer = readFileSync(path);
  const { entries, signingBlock } = readZipIndex(buffer);
  const read = (name) => {
    const entry = entries.get(name);
    if (!entry) return null;
    const data = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressed);
    if (entry.method === 0) return Buffer.from(data);
    if (entry.method === 8) return inflateRawSync(data);
    throw new ApkError(`${name} uses ZIP method ${entry.method}, which an APK never uses`);
  };
  return { kind: 'zip', names: [...entries.keys()].sort(), has: (name) => entries.has(name), read, entry: (name) => entries.get(name) ?? null, signingBlock };
}

function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const rel = prefix === '' ? entry : `${prefix}/${entry}`;
    if (statSync(join(dir, entry)).isDirectory()) out.push(...listFiles(join(dir, entry), rel));
    else out.push(rel);
  }
  return out;
}

function dirApk(path) {
  const names = listFiles(path);
  const set = new Set(names);
  return { kind: 'dir', names, has: (name) => set.has(name), read: (name) => (set.has(name) ? readFileSync(join(path, name)) : null), entry: () => null, signingBlock: null };
}

/** An APK file or an unzipped / decoded APK folder. */
export function readApk(path) {
  if (!existsSync(path)) throw new ApkError(`${path} does not exist`);
  return statSync(path).isDirectory() ? dirApk(path) : zipApk(path);
}

// ---------------------------------------------------------------------------------------------
// Binary XML (AXML)
// ---------------------------------------------------------------------------------------------

function utf8Length(buffer, at) {
  const first = buffer[at];
  return first & 0x80 ? { length: ((first & 0x7f) << 8) | buffer[at + 1], size: 2 } : { length: first, size: 1 };
}

function readStringPool(buffer, start) {
  const headerSize = buffer.readUInt16LE(start + 2);
  const count = buffer.readUInt32LE(start + 8);
  const flags = buffer.readUInt32LE(start + 16);
  const stringsStart = buffer.readUInt32LE(start + 20);
  const utf8 = (flags & 0x100) !== 0;
  const strings = [];
  for (let index = 0; index < count; index += 1) {
    let at = start + stringsStart + buffer.readUInt32LE(start + headerSize + index * 4);
    if (utf8) {
      at += utf8Length(buffer, at).size; // the length in UTF-16 units
      const bytes = utf8Length(buffer, at);
      at += bytes.size;
      strings.push(buffer.toString('utf8', at, at + bytes.length));
    } else {
      let length = buffer.readUInt16LE(at);
      at += 2;
      if (length & 0x8000) {
        length = ((length & 0x7fff) << 16) | buffer.readUInt16LE(at);
        at += 2;
      }
      strings.push(buffer.toString('utf16le', at, at + length * 2));
    }
  }
  return strings;
}

function typedValue(buffer, at, strings) {
  const type = buffer[at + 3];
  const data = buffer.readUInt32LE(at + 4);
  if (type === 0x03) return strings[data] ?? '';
  if (type === 0x12) return data !== 0;
  if (type === 0x10) return data | 0;
  if (type === 0x11) return data;
  if (type === 0x01) return `@0x${data.toString(16).padStart(8, '0')}`;
  return `(type 0x${type.toString(16)}) 0x${data.toString(16)}`;
}

function readElement(buffer, start, context) {
  const name = context.strings[buffer.readUInt32LE(start + 20)] ?? '';
  const attributeStart = buffer.readUInt16LE(start + 24);
  const attributeSize = buffer.readUInt16LE(start + 26);
  const count = buffer.readUInt16LE(start + 28);
  const attrs = {};
  for (let index = 0; index < count; index += 1) {
    const at = start + 16 + attributeStart + index * attributeSize;
    const nameIndex = buffer.readUInt32LE(at + 4);
    const rawIndex = buffer.readInt32LE(at + 8);
    const attrName = context.strings[nameIndex] || ATTR_IDS.get(context.resourceIds[nameIndex]) || `attr${nameIndex}`;
    const value = rawIndex >= 0 && buffer[at + 15] === 0x03 ? context.strings[rawIndex] : typedValue(buffer, at + 12, context.strings);
    attrs[attrName] = value;
  }
  return { name, attrs, children: [] };
}

function parseBinaryXml(buffer) {
  if (buffer.length < 8 || buffer.readUInt16LE(0) !== 0x0003) throw new ApkError('AndroidManifest.xml is neither binary XML nor text XML');
  const context = { strings: [], resourceIds: [] };
  const root = { name: '#document', attrs: {}, children: [] };
  const stack = [root];
  let at = buffer.readUInt16LE(2);
  while (at + 8 <= buffer.length) {
    const type = buffer.readUInt16LE(at);
    const size = buffer.readUInt32LE(at + 4);
    if (size < 8) throw new ApkError(`broken binary XML chunk at byte ${at}`);
    if (type === 0x0001) context.strings = readStringPool(buffer, at);
    else if (type === 0x0180) context.resourceIds = Array.from({ length: (size - 8) / 4 }, (_, index) => buffer.readUInt32LE(at + 8 + index * 4));
    else if (type === 0x0102) {
      const element = readElement(buffer, at, context);
      stack.at(-1).children.push(element);
      stack.push(element);
    } else if (type === 0x0103 && stack.length > 1) stack.pop();
    at += size;
  }
  return root.children[0] ?? root;
}

// ---------------------------------------------------------------------------------------------
// Text XML (a decoded manifest, or the merged manifest Gradle writes)
// ---------------------------------------------------------------------------------------------

function unescapeXml(text) {
  return text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseTextXml(text) {
  const root = { name: '#document', attrs: {}, children: [] };
  const stack = [root];
  const body = text.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const match of body.matchAll(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
    const [, closing, tag, rawAttrs, selfClosing] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    for (const attr of rawAttrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const key = attr[1].startsWith('android:') ? attr[1].slice('android:'.length) : attr[1];
      attrs[key] = unescapeXml(attr[2] ?? attr[3] ?? '');
    }
    const element = { name: tag, attrs, children: [] };
    stack.at(-1).children.push(element);
    if (!selfClosing) stack.push(element);
  }
  const manifest = root.children.find((child) => child.name === 'manifest');
  if (!manifest) throw new ApkError('the text manifest has no <manifest> element');
  return manifest;
}

/** The element tree of AndroidManifest.xml, binary (from an APK) or text (decoded, merged). */
export function parseManifest(buffer) {
  const head = buffer.subarray(0, 64).toString('utf8').replace(/^﻿/, '').trimStart();
  return head.startsWith('<') ? parseTextXml(buffer.toString('utf8')) : parseBinaryXml(buffer);
}

const childrenNamed = (element, name) => element.children.filter((child) => child.name === name);

/** protectionLevel signature (2) or signatureOrSystem (3), written as int flags (aapt2) or text (apktool, merged manifest). */
export function isSignatureLevel(level) {
  if (typeof level === 'number') return [2, 3].includes(level & 0xf);
  const text = String(level ?? '').trim();
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(text)) return isSignatureLevel(Number(text));
  return text.split('|').some((part) => ['signature', 'signatureOrSystem'].includes(part.trim()));
}

/** The facts the checks read from a manifest tree. */
export function manifestModel(tree) {
  const sdk = childrenNamed(tree, 'uses-sdk')[0]?.attrs ?? {};
  const application = childrenNamed(tree, 'application')[0] ?? { attrs: {}, children: [] };
  const permissions = [...childrenNamed(tree, 'uses-permission'), ...childrenNamed(tree, 'uses-permission-sdk-23')].map((element) => String(element.attrs.name ?? ''));
  const declaredPermissions = childrenNamed(tree, 'permission').map((element) => ({ name: String(element.attrs.name ?? ''), signature: isSignatureLevel(element.attrs.protectionLevel) }));
  const metaData = childrenNamed(application, 'meta-data').map((element) => ({ name: String(element.attrs.name ?? ''), value: element.attrs.value }));
  const schemes = [];
  const visit = (element) => {
    if (element.name === 'data' && element.attrs.scheme !== undefined) schemes.push(String(element.attrs.scheme));
    element.children.forEach(visit);
  };
  visit(application);
  const toNumber = (value) => (value === undefined ? null : Number(value));
  return {
    package: tree.attrs.package === undefined ? null : String(tree.attrs.package),
    versionCode: toNumber(tree.attrs.versionCode),
    versionName: tree.attrs.versionName === undefined ? null : String(tree.attrs.versionName),
    minSdk: toNumber(sdk.minSdkVersion),
    targetSdk: toNumber(sdk.targetSdkVersion),
    permissions: [...new Set(permissions)].sort(),
    declaredPermissions,
    application: application.attrs,
    metaData,
    schemes,
  };
}

/** The p_align of every PT_LOAD segment of a 32- or 64-bit little-endian ELF file, or null. */
export function elfLoadAlignments(buffer) {
  if (buffer.length < 52 || buffer.readUInt32BE(0) !== 0x7f454c46 || buffer[5] !== 1) return null;
  const is64 = buffer[4] === 2;
  const phoff = is64 ? Number(buffer.readBigUInt64LE(32)) : buffer.readUInt32LE(28);
  const entrySize = buffer.readUInt16LE(is64 ? 54 : 42);
  const count = buffer.readUInt16LE(is64 ? 56 : 44);
  const alignments = [];
  for (let index = 0; index < count; index += 1) {
    const at = phoff + index * entrySize;
    if (at + entrySize > buffer.length) return null;
    if (buffer.readUInt32LE(at) !== 1) continue; // PT_LOAD
    alignments.push(is64 ? Number(buffer.readBigUInt64LE(at + 48)) : buffer.readUInt32LE(at + 28));
  }
  return alignments;
}

