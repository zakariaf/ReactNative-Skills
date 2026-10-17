// apk-fixture.mjs: writes small, real APK-shaped files for the self-test (a helper, not an entry point,
// and never used on an app). Binary files are generated at test time instead of being committed.
//
//   hermesBundle(text)                        Hermes bytecode magic + padding + text (sentinels stay findable)
//   elfStub({ align, is64 = true })           an ELF shared library header with two PT_LOAD segments
//   encodeAxml(tree)                          Android binary XML for a manifest tree ({ name, attrs, children })
//   writeZip(path, entries, { signed })       a ZIP: entries [{ name, data, store, align }]; signed adds an
//                                             APK Signing Block before the central directory
//   buildApk(decodedDir, out, options)        an APK from a decoded folder (text manifest): the manifest
//                                             encoded as AXML, .so files stored and 16 KB aligned, the rest
//                                             deflated. options: { signed = true, soZipAlign = 16384,
//                                             mutateManifest(tree), extra: { '<name>': Buffer } }
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

import { readApk, parseManifest } from './apk-reader.mjs';

export function hermesBundle(text) {
  return Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.from('\x60\x00\x00\x00\x00\x00\x00\x00', 'latin1'), Buffer.from(text, 'utf8')]);
}

export function elfStub({ align, is64 = true }) {
  const phCount = 2;
  const header = Buffer.alloc(64 + phCount * 56);
  header.writeUInt32BE(0x7f454c46, 0);
  header[4] = is64 ? 2 : 1;
  header[5] = 1;
  header[6] = 1;
  header.writeUInt16LE(3, 16); // ET_DYN
  header.writeUInt16LE(183, 18); // EM_AARCH64
  header.writeBigUInt64LE(64n, 32);
  header.writeUInt16LE(64, 52);
  header.writeUInt16LE(56, 54);
  header.writeUInt16LE(phCount, 56);
  for (let index = 0; index < phCount; index += 1) {
    const at = 64 + index * 56;
    header.writeUInt32LE(1, at); // PT_LOAD
    header.writeBigUInt64LE(BigInt(align), at + 48);
  }
  return header;
}

const ANDROID_URI = 'http://schemas.android.com/apk/res/android';
const NO_INDEX = 0xffffffff;
const ATTR_IDS = { name: 0x01010003, value: 0x01010024, debuggable: 0x0101000f, minSdkVersion: 0x0101020c, targetSdkVersion: 0x01010270, versionCode: 0x0101021b, versionName: 0x0101021c, usesCleartextTraffic: 0x010104ec, allowBackup: 0x01010280, scheme: 0x01010027, protectionLevel: 0x01010009 };
const PLAIN_ATTRS = new Set(['package', 'platformBuildVersionCode', 'platformBuildVersionName', 'split']);

function chunk(type, headerSize, body) {
  const head = Buffer.alloc(8);
  head.writeUInt16LE(type, 0);
  head.writeUInt16LE(headerSize, 2);
  head.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

function stringPool(strings) {
  const encoded = strings.map((text) => {
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > 127 || text.length > 127) throw new Error(`fixture string too long: ${text}`);
    return Buffer.concat([Buffer.from([text.length, bytes.length]), bytes, Buffer.from([0])]);
  });
  const offsets = Buffer.alloc(strings.length * 4);
  let offset = 0;
  encoded.forEach((item, index) => {
    offsets.writeUInt32LE(offset, index * 4);
    offset += item.length;
  });
  let data = Buffer.concat(encoded);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(strings.length, 0);
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(0x100, 8); // UTF-8
  header.writeUInt32LE(28 + offsets.length, 12);
  header.writeUInt32LE(0, 16);
  return chunk(0x0001, 28, Buffer.concat([header, offsets, data]));
}

function collect(tree, attrNames, others) {
  others.add(tree.name);
  for (const [key, value] of Object.entries(tree.attrs)) {
    attrNames.add(key);
    if (typeof value === 'string') others.add(value);
  }
  tree.children.forEach((child) => collect(child, attrNames, others));
}

function attribute(key, value, index) {
  const out = Buffer.alloc(20);
  out.writeUInt32LE(PLAIN_ATTRS.has(key) ? NO_INDEX : index(ANDROID_URI), 0);
  out.writeUInt32LE(index(key), 4);
  out.writeUInt32LE(typeof value === 'string' ? index(value) : NO_INDEX, 8);
  out.writeUInt16LE(8, 12);
  if (typeof value === 'boolean') {
    out[15] = 0x12;
    out.writeUInt32LE(value ? NO_INDEX : 0, 16);
  } else if (typeof value === 'number') {
    out[15] = 0x10;
    out.writeInt32LE(value, 16);
  } else {
    out[15] = 0x03;
    out.writeUInt32LE(index(value), 16);
  }
  return out;
}

function elementChunks(tree, index) {
  const keys = Object.keys(tree.attrs);
  const start = Buffer.alloc(28);
  start.writeUInt32LE(1, 0);
  start.writeUInt32LE(NO_INDEX, 4);
  start.writeUInt32LE(NO_INDEX, 8);
  start.writeUInt32LE(index(tree.name), 12);
  start.writeUInt16LE(20, 16);
  start.writeUInt16LE(20, 18);
  start.writeUInt16LE(keys.length, 20);
  const attrs = keys.map((key) => attribute(key, tree.attrs[key], index));
  const end = Buffer.alloc(16);
  end.writeUInt32LE(1, 0);
  end.writeUInt32LE(NO_INDEX, 4);
  end.writeUInt32LE(NO_INDEX, 8);
  end.writeUInt32LE(index(tree.name), 12);
  return [chunk(0x0102, 16, Buffer.concat([start, ...attrs])), ...tree.children.flatMap((child) => elementChunks(child, index)), chunk(0x0103, 16, end)];
}

/** Android binary XML for a manifest tree (attributes other than package are in the android namespace). */
export function encodeAxml(tree) {
  const attrNames = new Set();
  const others = new Set();
  collect(tree, attrNames, others);
  const strings = [...attrNames, ...[...others, 'android', ANDROID_URI].filter((text) => !attrNames.has(text))];
  const index = (text) => strings.indexOf(text);
  const ids = Buffer.alloc(attrNames.size * 4);
  [...attrNames].forEach((name, at) => ids.writeUInt32LE(ATTR_IDS[name] ?? 0, at * 4));
  const ns = Buffer.alloc(16);
  ns.writeUInt32LE(1, 0);
  ns.writeUInt32LE(NO_INDEX, 4);
  ns.writeUInt32LE(index('android'), 8);
  ns.writeUInt32LE(index(ANDROID_URI), 12);
  const body = Buffer.concat([stringPool(strings), chunk(0x0180, 8, ids), chunk(0x0100, 16, ns), ...elementChunks(tree, index), chunk(0x0101, 16, ns)]);
  return chunk(0x0003, 8, body);
}

function signingBlock() {
  const value = Buffer.from('fixture-signature');
  const pair = Buffer.alloc(12);
  pair.writeBigUInt64LE(BigInt(4 + value.length), 0);
  pair.writeUInt32LE(0x7109871a, 8);
  const size = BigInt(pair.length + value.length + 8 + 16);
  const head = Buffer.alloc(8);
  head.writeBigUInt64LE(size, 0);
  const tail = Buffer.alloc(8);
  tail.writeBigUInt64LE(size, 0);
  return Buffer.concat([head, pair, value, tail, Buffer.from('APK Sig Block 42', 'latin1')]);
}

/** A ZIP file; a stored entry with `align` gets padding in its local extra field. */
export function writeZip(path, entries, { signed = true } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.store ? entry.data : deflateRawSync(entry.data);
    let pad = 0;
    if (entry.store && entry.align) pad = (entry.align - ((offset + 30 + name.length) % entry.align)) % entry.align;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.store ? 0 : 8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(pad, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    local.copy(head, 8, 6, 30);
    head.writeUInt16LE(0, 30); // no extra field in the central directory
    head.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([head, name]));
    parts.push(local, name, Buffer.alloc(pad), data);
    offset += 30 + name.length + pad + data.length;
  }
  if (signed) parts.push(signingBlock());
  const centralOffset = parts.reduce((sum, part) => sum + part.length, 0);
  const centralData = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([...parts, centralData, eocd]));
}

const INT_ATTRS = new Set(['versionCode', 'minSdkVersion', 'targetSdkVersion', 'maxSdkVersion']);
/** protectionLevel flags as aapt2 encodes them (normal 0, dangerous 1, signature 2). */
const PROTECTION_LEVELS = { normal: 0, dangerous: 1, signature: 2 };

/** Typed values as aapt2 writes them: booleans, the integer attributes and protectionLevel flags, the rest strings. */
function typed(tree) {
  const attrs = Object.fromEntries(Object.entries(tree.attrs).map(([key, value]) => {
    if (value === 'true' || value === 'false') return [key, value === 'true'];
    if (INT_ATTRS.has(key) && /^\d+$/.test(String(value))) return [key, Number(value)];
    if (key === 'protectionLevel' && PROTECTION_LEVELS[value] !== undefined) return [key, PROTECTION_LEVELS[value]];
    return [key, value];
  }));
  return { name: tree.name, attrs, children: tree.children.map(typed) };
}

/** An APK from a decoded folder; see the header for the options. */
export function buildApk(decodedDir, out, { signed = true, soZipAlign = 16384, mutateManifest = (tree) => tree, extra = {} } = {}) {
  const source = readApk(decodedDir);
  const tree = mutateManifest(typed(parseManifest(readFileSync(join(decodedDir, 'AndroidManifest.xml')))));
  const files = { ...Object.fromEntries(source.names.filter((name) => name !== 'AndroidManifest.xml').map((name) => [name, source.read(name)])), ...extra };
  const entries = [{ name: 'AndroidManifest.xml', data: encodeAxml(tree) }];
  for (const [name, data] of Object.entries(files)) entries.push(name.endsWith('.so') ? { name, data, store: true, align: soZipAlign } : { name, data });
  writeZip(out, entries, { signed });
}
