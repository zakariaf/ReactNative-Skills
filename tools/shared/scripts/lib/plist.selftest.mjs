#!/usr/bin/env node
// plist.selftest.mjs: the self-test of lib/plist.mjs and lib/usage-strings.mjs. Binary plists are
// built by a tiny encoder in this file, so the test needs no plutil (it also cross-checks with plutil
// when the machine has it). Prints ok / FAIL lines and the RESULT line.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { UsageError, createReporter, makeTempDir, parseArgs, removeTempDir, run } from '../check-lib.mjs';
import { parseBinaryPlist, parsePlistXml, parseXmlPlist, plistGet, readPlist, toPlistXml } from './plist.mjs';
import { ATT_KEY, appLanguages, localeFiles, stringsValue, trackingTextProblems, usageStringProblems } from './usage-strings.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

/** A minimal bplist00 encoder (dict, array, ascii/utf-16 strings, ints, reals, booleans) for tests. */
function bplist(value) {
  const objects = [];
  const encode = (item) => {
    const index = objects.length;
    objects.push(null);
    const head = (type, length) => (length < 15 ? Buffer.from([(type << 4) | length]) : Buffer.from([(type << 4) | 0x0f, 0x10, length]));
    let bytes;
    if (item === true || item === false) bytes = Buffer.from([item ? 0x09 : 0x08]);
    else if (Number.isInteger(item)) {
      const buf = Buffer.alloc(9);
      buf[0] = 0x13;
      buf.writeBigInt64BE(BigInt(item), 1);
      bytes = buf;
    } else if (typeof item === 'number') {
      const buf = Buffer.alloc(9);
      buf[0] = 0x23;
      buf.writeDoubleBE(item, 1);
      bytes = buf;
    } else if (typeof item === 'string') {
      const ascii = /^[\x00-\x7f]*$/.test(item);
      if (ascii) bytes = Buffer.concat([head(0x5, item.length), Buffer.from(item, 'latin1')]);
      else bytes = Buffer.concat([head(0x6, item.length), Buffer.from(item, 'utf16le').swap16()]);
    } else if (Array.isArray(item)) {
      const refs = item.map(encode);
      bytes = Buffer.concat([head(0xa, refs.length), Buffer.from(refs)]);
    } else {
      const keys = Object.keys(item);
      const keyRefs = keys.map(encode);
      const valueRefs = keys.map((key) => encode(item[key]));
      bytes = Buffer.concat([head(0xd, keys.length), Buffer.from(keyRefs), Buffer.from(valueRefs)]);
    }
    objects[index] = bytes;
    return index;
  };
  encode(value);
  const header = Buffer.from('bplist00', 'latin1');
  const offsets = [];
  let at = header.length;
  for (const bytes of objects) {
    offsets.push(at);
    at += bytes.length;
  }
  const table = Buffer.alloc(objects.length * 2);
  offsets.forEach((offset, index) => table.writeUInt16BE(offset, index * 2));
  const trailer = Buffer.alloc(32);
  trailer[6] = 2;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([header, ...objects, table, trailer]);
}

const VALUE = { CFBundleIdentifier: 'com.acme.tasks', CFBundleLocalizations: ['en', 'ar'], Count: 3, Negative: -5, Ratio: 0.5, Enabled: true, Off: false, Title: 'مهام', Nested: { 'A&B': '<x>' }, Empty: [] };

test('XML: toPlistXml and parsePlistXml / parseXmlPlist round trip; errors', () => {
  const xml = toPlistXml(VALUE);
  assert.deepEqual(parsePlistXml(xml), VALUE);
  assert.deepEqual(parseXmlPlist(xml), VALUE);
  assert.equal(plistGet(parsePlistXml(xml), 'Nested.A&B'), '<x>');
  assert.equal(plistGet(VALUE, 'Nested.missing.deep'), undefined);
  assert.deepEqual(parsePlistXml('<plist><dict><key>D</key><date>2026-10-03T12:00:00Z</date><key>B</key><data>\n aGVs\n bG8=\n</data><key>E</key><string/></dict></plist>'), { D: '2026-10-03T12:00:00Z', B: 'aGVsbG8=', E: '' });
  assert.throws(() => parsePlistXml('<dict></dict>'), (error) => error instanceof UsageError && /no <plist> element/.test(error.message));
  assert.throws(() => parseXmlPlist('<plist><dict><string>x</string></dict></plist>'), (error) => !(error instanceof UsageError) && /without <key>/.test(error.message));
  assert.throws(() => parseXmlPlist('<plist><dict><key>a</key><string>x</dict></plist>'), /not closed|unterminated|malformed/);
});

test('binary: parseBinaryPlist and readPlist read bplist00 without plutil', () => {
  assert.deepEqual(parseBinaryPlist(bplist(VALUE)), VALUE);
  const dir = makeTempDir('plist-');
  try {
    write(join(dir, 'Info.plist'), bplist(VALUE));
    assert.deepEqual(readPlist(join(dir, 'Info.plist')), VALUE);
    write(join(dir, 'broken.plist'), Buffer.concat([Buffer.from('bplist00'), Buffer.alloc(40, 0xff)]));
    assert.throws(() => readPlist(join(dir, 'broken.plist')), (error) => error instanceof UsageError && /cannot read the binary plist/.test(error.message));
    write(join(dir, 'xml.plist'), toPlistXml(VALUE));
    if (spawnSync('plutil', ['-help']).status !== null) {
      const converted = join(dir, 'converted.plist');
      const result = spawnSync('plutil', ['-convert', 'binary1', '-o', converted, join(dir, 'xml.plist')]);
      if (result.status === 0) assert.deepEqual(readPlist(converted), VALUE, 'plutil binary1 output reads the same');
    }
  } finally {
    removeTempDir(dir);
  }
});

test('usage strings: the app languages, every key in Info.plist and each InfoPlist.strings form', () => {
  const dir = makeTempDir('usage-');
  try {
    const app = join(dir, 'Tasks.app');
    write(join(app, 'en.lproj', 'InfoPlist.strings'), bplist({ [ATT_KEY]: 'We use this to show relevant ads.', NSCameraUsageDescription: 'Scan a task card.' }));
    write(join(app, 'ar.lproj', 'InfoPlist.strings'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`"${ATT_KEY}" = "نص";\n`, 'utf16le')]));
    write(join(app, 'fr.lproj', 'InfoPlist.strings'), toPlistXml({ NSCameraUsageDescription: 'Scanner.' }));
    mkdirSync(join(app, 'Base.lproj'), { recursive: true });
    assert.deepEqual(appLanguages(app), ['ar', 'en', 'fr']);
    assert.deepEqual(appLanguages(app, { CFBundleLocalizations: ['en', 'ar'] }), ['ar', 'en']);
    assert.equal(stringsValue(join(app, 'ar.lproj', 'InfoPlist.strings'), ATT_KEY, readPlist), 'نص');
    assert.equal(stringsValue(join(app, 'en.lproj', 'InfoPlist.strings'), ATT_KEY, readPlist), 'We use this to show relevant ads.');
    assert.equal(stringsValue(join(app, 'missing', 'InfoPlist.strings'), ATT_KEY, readPlist), null);
    const info = { [ATT_KEY]: 'Ads', NSCameraUsageDescription: '' };
    const problems = usageStringProblems(app, info, { keys: [ATT_KEY, 'NSCameraUsageDescription'], readPlist }).map((entry) => `${entry.file} ${entry.key}`);
    assert.deepEqual(problems, ['fr.lproj/InfoPlist.strings NSUserTrackingUsageDescription', 'Info.plist NSCameraUsageDescription', 'ar.lproj/InfoPlist.strings NSCameraUsageDescription']);
    assert.deepEqual(trackingTextProblems(app, {}, readPlist, { languages: ['en', 'de'] }), [
      { file: 'Info.plist', message: `${ATT_KEY} is missing or empty, so the tracking prompt would crash the app` },
      { file: 'de.lproj/InfoPlist.strings', message: `is missing, so there is no de tracking prompt text (${ATT_KEY})` },
    ]);
    assert.throws(() => usageStringProblems(app, info, {}), /needs readPlist/);
    write(join(dir, 'repo', 'locales', 'en.json'), '{}');
    write(join(dir, 'repo', 'locales', 'pt-BR.json'), '{}');
    write(join(dir, 'repo', 'locales', 'notes.md'), '');
    assert.deepEqual(localeFiles(join(dir, 'repo'), 'locales'), ['en', 'pt-BR']);
    assert.deepEqual(localeFiles(join(dir, 'repo'), 'missing'), []);
  } finally {
    removeTempDir(dir);
  }
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'plist.selftest', summary: 'Self-test of lib/plist.mjs and lib/usage-strings.mjs.', usage: '' });
  const report = createReporter({ name: 'plist.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'lib/plist.mjs', rule: 'lib-selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix lib/plist.mjs / lib/usage-strings.mjs (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
