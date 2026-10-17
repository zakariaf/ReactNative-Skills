#!/usr/bin/env node
// selftest.mjs: proves every checker of this skill passes its good fixture and catches each planted
// bug. emu-setup assembles the shipped templates over tests/bases/app (so the templates are the good
// case) with decoys under .agents/skills/, skills/ and a vendored SKILL.md folder that must stay
// silent. apk and apk-production check a decoded APK folder (text manifest, generated Hermes bundle
// and ELF libraries); apk-zip checks real APK files with a binary manifest, written at test time by
// lib/apk-fixture.mjs; emu-screenshot cases generate their PNGs.
//   node scripts/selftest.mjs [--case <glob>]... [--materialize <dir>]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelftest } from './check-lib.mjs';
import { buildApk, elfStub, hermesBundle } from './lib/apk-fixture.mjs';

const BASES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'bases');
const SENTINEL_BUNDLE = 'var TEST_BUILD_SENTINEL="TASKS_TEST_BUILD_ONLY";var tasks=[];';
const STORE_BUNDLE = 'var tasks=[];';
const LIBS = ['lib/arm64-v8a/libhermes.so', 'lib/arm64-v8a/libreactnative.so'];

function put(dir, rel, data) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), data);
}

/** The binary half of a decoded APK folder: the Hermes bundle and 16 KB aligned ELF libraries. */
function binaries(bundleText) {
  return (dir) => {
    put(dir, 'assets/index.android.bundle', hermesBundle(bundleText));
    for (const lib of LIBS) put(dir, lib, elfStub({ align: 16384 }));
  };
}

/** Real APK files from the preview folder: good, unsigned, misaligned, debuggable, truncated. */
function apkFiles(dir) {
  const decoded = join(dir, 'decoded');
  put(decoded, 'AndroidManifest.xml', readFileSync(join(BASES, 'apk-decoded', 'AndroidManifest.xml')));
  put(decoded, 'assets/app.config', readFileSync(join(BASES, 'apk-decoded', 'assets', 'app.config')));
  binaries(SENTINEL_BUNDLE)(decoded);
  buildApk(decoded, join(dir, 'app-preview.apk'));
  buildApk(decoded, join(dir, 'app-unsigned.apk'), { signed: false });
  buildApk(decoded, join(dir, 'app-misaligned.apk'), { soZipAlign: 0 });
  buildApk(decoded, join(dir, 'app-debuggable.apk'), {
    mutateManifest: (tree) => ({ ...tree, children: tree.children.map((child) => (child.name === 'application' ? { ...child, attrs: { ...child.attrs, debuggable: true } } : child)) }),
  });
  writeFileSync(join(dir, 'app-truncated.apk'), readFileSync(join(dir, 'app-preview.apk')).subarray(0, 120));
  rmSync(decoded, { recursive: true });
}

const APK = 'artifacts/apk';

await runSelftest(import.meta.url, [
  { script: 'check-emu-setup.mjs', fixtures: '../tests/fixtures/emu-setup', args: (dir) => [dir] },
  {
    script: 'check-apk.mjs',
    fixtures: '../tests/fixtures/apk',
    args: (dir) => [dir, '--apk', APK, '--variant', 'preview'],
    base: ['@tests/bases/apk-repo', { from: '@tests/bases/apk-decoded', to: APK }, { build: binaries(SENTINEL_BUNDLE), to: APK }],
  },
  {
    script: 'check-apk.mjs',
    fixtures: '../tests/fixtures/apk-production',
    args: (dir) => [dir, '--apk', APK, '--variant', 'production'],
    base: ['@tests/bases/apk-repo', { from: '@tests/bases/apk-decoded', to: APK }, { from: '@tests/bases/apk-production', to: APK }, { build: binaries(STORE_BUNDLE), to: APK }],
  },
  {
    script: 'check-apk.mjs',
    fixtures: '../tests/fixtures/apk-zip',
    args: (dir) => [dir, '--apk', 'artifacts/app-preview.apk', '--variant', 'preview'],
    base: ['@tests/bases/apk-repo', { build: apkFiles, to: 'artifacts' }],
  },
  { script: 'check-emu-screenshot.mjs', fixtures: '../tests/fixtures/emu-screenshot', args: (dir) => ['--root', dir, join(dir, 'reports', 'android-emu')] },
]);
