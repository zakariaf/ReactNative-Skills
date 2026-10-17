// aab-fixture.mjs: writes small Android App Bundles from a JSON spec for the self-test (a helper, not an
// entry point; never used on an app). Committing binary bundles would break the fixture rules, and a
// case that differs from good/ by one manifest attribute should say so in a one-line mutation.json.
// The manifest is encoded the way aapt2 writes it (Resources.proto XmlNode: the attribute's text plus
// a compiled primitive for integers and booleans); libraries and signature blocks are the real
// tool output kept in tests/real-tools.json.
//
//   writeAab(path, spec, real)   spec (aab.json):
//     manifest: { package, versionCode, versionName, minSdk, targetSdk, debuggable, usesCleartextTraffic,
//                 permissions: [name], metaData: { name: value } } | "aapt2" (the real compiled manifest)
//     libs: { "<zip path>.so": "elf16k" | "elf4k" }
//     assets: { "<zip path>": text | object (written as JSON) }
//     bundleConfig: { uncompressNativeLibraries: boolean, alignment: "4K"|"16K"|"64K"|"unspecified" } | null
//     signature: "upload" | "debug" | "unreadable" | null   (unreadable: a .RSA block that is no PKCS#7)
//   real: the parsed tests/real-tools.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { crc32 } from 'node:zlib';

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const ALIGNMENT = { unspecified: 0, '4K': 1, '16K': 2, '64K': 3 };

function varint(value) {
  const bytes = [];
  let rest = BigInt(value);
  do {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (rest !== 0n);
  return Buffer.from(bytes);
}

const field = (no, payload) => Buffer.concat([varint((no << 3) | 2), varint(payload.length), payload]);
const intField = (no, value) => Buffer.concat([varint(no << 3), varint(value)]);
const text = (no, value) => field(no, Buffer.from(String(value), 'utf8'));

/** XmlAttribute: namespace_uri = 1, name = 2, value = 3, compiled_item = 6 (Item.prim = 7). */
function attribute(name, value, isAndroid = true) {
  const parts = [...(isAndroid ? [text(1, ANDROID_NS)] : []), text(2, name), text(3, String(value))];
  if (typeof value === 'boolean') parts.push(field(6, field(7, intField(8, value ? 1 : 0))));
  else if (typeof value === 'number') parts.push(field(6, field(7, intField(6, value))));
  return field(4, Buffer.concat(parts));
}

/** XmlNode { element = 1: XmlElement { name = 3, attribute = 4, child = 5 } }. */
function element(name, attributes, children = []) {
  const parts = [text(3, name)];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    parts.push(attribute(key, value, !(name === 'manifest' && key === 'package')));
  }
  for (const child of children) parts.push(field(5, child));
  return field(1, Buffer.concat(parts));
}

export function encodeManifest(spec) {
  const metaData = Object.entries(spec.metaData ?? {}).map(([name, value]) => element('meta-data', { name, value }));
  const application = element('application', { debuggable: spec.debuggable, usesCleartextTraffic: spec.usesCleartextTraffic }, metaData);
  const permissions = (spec.permissions ?? []).map((name) => element('uses-permission', { name }));
  const sdk = element('uses-sdk', { minSdkVersion: spec.minSdk, targetSdkVersion: spec.targetSdk });
  return element('manifest', { package: spec.package, versionCode: spec.versionCode, versionName: spec.versionName }, [sdk, ...permissions, application]);
}

/** BundleConfig { optimizations = 2 { uncompress_native_libraries = 2 { enabled = 1, alignment = 2 } } }. */
export function encodeBundleConfig(spec) {
  const inner = Buffer.concat([intField(1, spec.uncompressNativeLibraries ? 1 : 0), intField(2, ALIGNMENT[spec.alignment] ?? 0)]);
  return field(2, field(2, inner));
}

/** A ZIP file of stored entries. */
export function zipStored(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function writeAab(path, spec, real) {
  const entries = [];
  const manifest = spec.manifest === 'aapt2' ? Buffer.from(real.aapt2Manifest, 'base64') : encodeManifest(spec.manifest);
  entries.push(['base/manifest/AndroidManifest.xml', manifest]);
  for (const [name, kind] of Object.entries(spec.libs ?? {})) entries.push([name, Buffer.from(real[kind], 'base64')]);
  for (const [name, value] of Object.entries(spec.assets ?? {})) entries.push([name, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')]);
  if (spec.bundleConfig) entries.push(['BundleConfig.pb', encodeBundleConfig(spec.bundleConfig)]);
  if (spec.signature === 'upload') entries.push(['META-INF/MANIFEST.MF', Buffer.from('Manifest-Version: 1.0\r\n\r\n')], ['META-INF/UPLOAD.RSA', Buffer.from(real.uploadBlock, 'base64')]);
  if (spec.signature === 'unreadable') entries.push(['META-INF/MANIFEST.MF', Buffer.from('Manifest-Version: 1.0\r\n\r\n')], ['META-INF/UPLOAD.RSA', Buffer.from('a truncated download, not a PKCS#7 block\n')]);
  if (spec.signature === 'debug') entries.push(['META-INF/MANIFEST.MF', Buffer.from('Manifest-Version: 1.0\r\n\r\n')], ['META-INF/ANDROIDD.RSA', Buffer.from(real.debugBlock, 'base64')]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, zipStored(entries));
}
