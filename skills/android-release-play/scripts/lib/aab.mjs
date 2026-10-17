// aab.mjs: reads an Android App Bundle with node: built-ins only (a helper, not an entry point).
// An AAB is a ZIP file. The base module's manifest is base/manifest/AndroidManifest.xml in aapt2's
// protobuf format (Resources.proto XmlNode), the JS bundle base/assets/index.android.bundle, the app
// config expo-constants embeds base/assets/app.config, native libraries base/lib/<abi>/*.so, the
// bundletool settings BundleConfig.pb, and the upload signature META-INF/*.RSA|EC|DSA (a JAR
// signature: a PKCS#7 SignedData block that holds the signer's X.509 certificate).
// Verified on 2026-10-14: manifests compiled by aapt2 36.0.0 (link --proto-format), libraries linked
// by NDK r28 clang, signatures written by the JDK 17 jarsigner; BundleConfig field numbers from
// bundletool's config.proto (Optimizations = 2, UncompressNativeLibraries = 2, alignment = 2).
//
//   readZip(path)                  { names, has(name), read(name) -> Buffer|null } (stored and deflated)
//   parseProtoXml(buffer)          { name, attributes, children } (attribute names without namespace)
//   findElements(node, name)       every element called name at or below node
//   metaDataOf(manifest)           [{ name, value }] of <application>'s <meta-data>
//   manifestModel(manifest)        { package, versionCode, versionName, minSdk, targetSdk, permissions,
//                                    debuggable, usesCleartextTraffic, metaData }
//   elfLoadAlignments(buffer)      the p_align of every PT_LOAD segment of a 64- or 32-bit ELF, or null
//   nativeLibAlignment(buffer)     BundleConfig.pb: { uncompressed: boolean, alignment: '4K'|'16K'|'64K'|'unspecified' }
//   signerOf(zip)                  { isSigned, certificates: [{ der, sha256, subject }] }
//   AabError                       a file that is not a ZIP or an entry this reader cannot decode
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export class AabError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The entries of a ZIP file, read on demand. */
export function readZip(path) {
  const buffer = readFileSync(path);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 0xffff - 22); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new AabError('not a ZIP file (no end-of-central-directory record)');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) throw new AabError(`broken ZIP central directory at entry ${index}`);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.set(name, { method: buffer.readUInt16LE(offset + 10), size: buffer.readUInt32LE(offset + 20), local: buffer.readUInt32LE(offset + 42) });
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  const read = (name) => {
    const entry = entries.get(name);
    if (entry === undefined) return null;
    if (buffer.readUInt32LE(entry.local) !== LOCAL) throw new AabError(`broken ZIP local header for ${name}`);
    const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28);
    const data = buffer.subarray(start, start + entry.size);
    if (entry.method === 0) return Buffer.from(data);
    if (entry.method === 8) return inflateRawSync(data);
    throw new AabError(`${name} uses ZIP method ${entry.method}; only stored (0) and deflate (8) are read`);
  };
  return { names: [...entries.keys()], has: (name) => entries.has(name), read };
}

/** Protobuf wire fields of one message: [{ no, value (varint, BigInt) } | { no, bytes }]. */
export function protoFields(buffer) {
  const out = [];
  let i = 0;
  const varint = () => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= buffer.length) throw new AabError('truncated protobuf varint');
      const byte = buffer[i];
      i += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
  };
  while (i < buffer.length) {
    const key = Number(varint());
    const no = key >> 3;
    const wire = key & 7;
    if (wire === 0) out.push({ no, value: varint() });
    else if (wire === 2) {
      const length = Number(varint());
      if (i + length > buffer.length) throw new AabError('truncated protobuf field');
      out.push({ no, bytes: buffer.subarray(i, i + length) });
      i += length;
    } else if (wire === 5) i += 4;
    else if (wire === 1) i += 8;
    else throw new AabError(`unsupported protobuf wire type ${wire}`);
  }
  return out;
}

/** An attribute's value: its string, else its compiled primitive (boolean or integer). */
function attributeValue(attribute) {
  const text = attribute.find((field) => field.no === 3)?.bytes?.toString('utf8') ?? '';
  if (text !== '') return text;
  const item = attribute.find((field) => field.no === 6);
  const primitive = item ? protoFields(item.bytes).find((field) => field.no === 7) : undefined;
  const value = primitive ? protoFields(primitive.bytes)[0] : undefined;
  if (value === undefined) return '';
  if (value.no === 8) return String(value.value === 1n);
  return value.value === undefined ? '' : String(BigInt.asIntN(32, value.value));
}

/**
 * aapt2's XmlNode (element = 1) to { name, attributes, children }. XmlElement: name = 3,
 * attribute = 4, child = 5; XmlAttribute: name = 2, value = 3, compiled_item = 6 (Item: prim = 7).
 */
export function parseProtoXml(buffer) {
  const element = protoFields(buffer).find((field) => field.no === 1);
  if (element === undefined) return null;
  const node = { name: '', attributes: {}, children: [] };
  for (const field of protoFields(element.bytes)) {
    if (field.no === 3) node.name = field.bytes.toString('utf8');
    else if (field.no === 4) {
      const attribute = protoFields(field.bytes);
      const name = attribute.find((part) => part.no === 2)?.bytes?.toString('utf8');
      if (name) node.attributes[name] = attributeValue(attribute);
    } else if (field.no === 5) {
      const child = parseProtoXml(field.bytes);
      if (child !== null) node.children.push(child);
    }
  }
  return node;
}

export function findElements(node, name) {
  const found = node.name === name ? [node] : [];
  for (const child of node.children) found.push(...findElements(child, name));
  return found;
}

export function metaDataOf(manifest) {
  const application = findElements(manifest, 'application')[0];
  return (application?.children ?? []).filter((child) => child.name === 'meta-data').map((child) => ({ name: child.attributes.name ?? '', value: child.attributes.value ?? null }));
}

/** The facts the gate reads from the base manifest. */
export function manifestModel(manifest) {
  const root = findElements(manifest, 'manifest')[0]?.attributes ?? {};
  const sdk = findElements(manifest, 'uses-sdk')[0]?.attributes ?? {};
  const application = findElements(manifest, 'application')[0]?.attributes ?? {};
  const permissions = [...findElements(manifest, 'uses-permission'), ...findElements(manifest, 'uses-permission-sdk-23')].map((element) => element.attributes.name).filter(Boolean);
  return {
    package: root.package ?? null,
    versionCode: root.versionCode ?? null,
    versionName: root.versionName ?? null,
    minSdk: sdk.minSdkVersion === undefined ? null : Number(sdk.minSdkVersion),
    targetSdk: sdk.targetSdkVersion === undefined ? null : Number(sdk.targetSdkVersion),
    permissions: [...new Set(permissions)],
    debuggable: application.debuggable === 'true',
    usesCleartextTraffic: application.usesCleartextTraffic === 'true',
    metaData: metaDataOf(manifest),
  };
}

const PT_LOAD = 1;

/** The p_align of every PT_LOAD program header, or null when the buffer is not an ELF file. */
export function elfLoadAlignments(buffer) {
  if (buffer.length < 52 || buffer.readUInt32BE(0) !== 0x7f454c46) return null;
  const is64 = buffer[4] === 2;
  const little = buffer[5] === 1;
  const u16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const u32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  const u64 = (at) => Number(little ? buffer.readBigUInt64LE(at) : buffer.readBigUInt64BE(at));
  const phoff = is64 ? u64(0x20) : u32(0x1c);
  const phentsize = u16(is64 ? 0x36 : 0x2a);
  const phnum = u16(is64 ? 0x38 : 0x2c);
  const alignments = [];
  for (let index = 0; index < phnum; index += 1) {
    const at = phoff + index * phentsize;
    if (at + phentsize > buffer.length) return null;
    if (u32(at) !== PT_LOAD) continue;
    alignments.push(is64 ? u64(at + 0x30) : u32(at + 0x1c));
  }
  return alignments;
}

const ALIGNMENTS = ['unspecified', '4K', '16K', '64K'];

/** BundleConfig.pb: whether bundletool stores native libraries uncompressed, and their page alignment. */
export function nativeLibAlignment(buffer) {
  const optimizations = protoFields(buffer).find((field) => field.no === 2 && field.bytes);
  const uncompress = optimizations ? protoFields(optimizations.bytes).find((field) => field.no === 2 && field.bytes) : undefined;
  if (uncompress === undefined) return { uncompressed: false, alignment: 'unspecified' };
  const fields = protoFields(uncompress.bytes);
  const enabled = fields.find((field) => field.no === 1)?.value === 1n;
  const alignment = Number(fields.find((field) => field.no === 2)?.value ?? 0n);
  return { uncompressed: enabled, alignment: ALIGNMENTS[alignment] ?? `unknown (${alignment})` };
}

/** One DER element at offset: { tag, start (content), end }. */
function derAt(buffer, offset) {
  const tag = buffer[offset];
  let length = buffer[offset + 1];
  let start = offset + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    if (bytes === 0 || bytes > 4) throw new AabError('unsupported DER length');
    length = 0;
    for (let index = 0; index < bytes; index += 1) length = length * 256 + buffer[start + index];
    start += bytes;
  }
  if (start + length > buffer.length) throw new AabError('truncated DER element');
  return { tag, offset, start, end: start + length };
}

function derChildren(buffer, element) {
  const children = [];
  for (let at = element.start; at < element.end; ) {
    const child = derAt(buffer, at);
    children.push(child);
    at = child.end;
  }
  return children;
}

/**
 * The X.509 certificates of a PKCS#7 SignedData block (ContentInfo -> [0] SignedData ->
 * [0] IMPLICIT certificates), each as DER bytes.
 */
export function pkcs7Certificates(block) {
  const contentInfo = derAt(block, 0);
  const explicit = derChildren(block, contentInfo).find((child) => child.tag === 0xa0);
  if (explicit === undefined) throw new AabError('the signature block holds no SignedData');
  const signedData = derChildren(block, explicit)[0];
  const certificates = derChildren(block, signedData).find((child) => child.tag === 0xa0);
  if (certificates === undefined) return [];
  return derChildren(block, certificates).filter((child) => child.tag === 0x30).map((child) => block.subarray(child.offset, child.end));
}

/** "AB:CD:..." (upper case, colon-separated): the form keytool, Play Console and EAS print. */
export function fingerprintOf(der) {
  return createHash('sha256').update(der).digest('hex').toUpperCase().match(/../g).join(':');
}

/** Who signed the bundle: the certificates of every META-INF signature block. */
export function signerOf(zip) {
  const blocks = zip.names.filter((name) => /^META-INF\/[^/]+\.(RSA|EC|DSA)$/i.test(name));
  const certificates = [];
  for (const name of blocks) {
    for (const der of pkcs7Certificates(zip.read(name))) {
      let subject = '';
      try {
        subject = new X509Certificate(der).subject;
      } catch {
        subject = '(unreadable certificate)';
      }
      certificates.push({ der, sha256: fingerprintOf(der), subject });
    }
  }
  return { isSigned: blocks.length > 0, certificates };
}

/** True when a certificate subject is the Android debug keystore's (CN=Android Debug). */
export function isDebugSubject(subject) {
  return /(^|\n|,\s*)CN=Android Debug(\n|,|$)/.test(subject);
}
