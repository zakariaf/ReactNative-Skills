// scripts/release/artifact-facts.ts
// Reads the facts the store-artifact gate judges from an unpacked .app (Payload/<App>.app): the
// Info.plist and EXConstants app.config as JSON, string counts in main.jsbundle (Hermes bytecode
// keeps string literals as bytes), test artefacts, the privacy manifest, the signature's
// entitlements, and the usage strings of every language. Proven by the release itself and by the
// skill's check-store-artifact.mjs; the decisions live in the tested store-gate.ts.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ArtifactFacts } from './store-gate.ts';

type Leaf = { readonly where: string; readonly value: string };

/** A plist (XML, binary or old-style .strings) as JSON, through plutil. */
function readPlistJson(path: string): Record<string, unknown> {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' });
  return JSON.parse(json) as Record<string, unknown>;
}

function leaves(value: unknown, where: string): Leaf[] {
  if (typeof value === 'string') return [{ where, value }];
  if (Array.isArray(value))
    return value.flatMap((item, index) => leaves(item, `${where}.${String(index)}`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, `${where}.${key}`));
  }
  return [];
}

function readAppConfig(appDir: string): Record<string, unknown> | null {
  const path = join(appDir, 'EXConstants.bundle', 'app.config');
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : null;
}

/** null: unsigned (codesign -d fails); else whether the entitlements grant get-task-allow. */
function readGetTaskAllow(appDir: string): boolean | null {
  const result = spawnSync('codesign', ['-d', '--entitlements', '-', '--xml', appDir], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return /<key>get-task-allow<\/key>\s*<true\s*\/>/.test(result.stdout);
}

/** The app's languages (CFBundleLocalizations, else its .lproj folders), minus Base and the development region. */
function languagesOf(appDir: string, info: Record<string, unknown>): string[] {
  const declared = info['CFBundleLocalizations'];
  const found = Array.isArray(declared)
    ? declared.filter((lang): lang is string => typeof lang === 'string')
    : readdirSync(appDir)
        .filter((name) => name.endsWith('.lproj'))
        .map((name) => name.slice(0, -'.lproj'.length));
  // A key missing in the development region's strings falls back to Info.plist, written in that language.
  return found.filter((lang) => lang !== 'Base' && lang !== info['CFBundleDevelopmentRegion']);
}

function hasText(record: Record<string, unknown> | null, key: string): boolean {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() !== '';
}

function missingUsageStrings(
  appDir: string,
  info: Record<string, unknown>,
  required: readonly string[],
): string[] {
  const carried = Object.keys(info).filter((key) => /^NS[A-Za-z]+UsageDescription$/.test(key));
  const keys = [...new Set([...required, ...carried])].sort();
  const missing = keys.filter((key) => !hasText(info, key)).map((key) => `Info.plist lacks ${key}`);
  for (const lang of languagesOf(appDir, info)) {
    const file = join(`${lang}.lproj`, 'InfoPlist.strings');
    const strings = existsSync(join(appDir, file)) ? readPlistJson(join(appDir, file)) : null;
    missing.push(
      ...keys.filter((key) => !hasText(strings, key)).map((key) => `${file} lacks ${key}`),
    );
  }
  return missing;
}

export type FactsRequest = {
  /** Strings to count in main.jsbundle: the test-only sentinels and the forbidden strings. */
  readonly bundleStrings: readonly string[];
  /** Usage-description keys every build carries (contract usageStrings). */
  readonly usageStrings: readonly string[];
};

export function readArtifactFacts(appDir: string, request: FactsRequest): ArtifactFacts {
  const info = readPlistJson(join(appDir, 'Info.plist'));
  const appConfig = readAppConfig(appDir);
  const bundlePath = join(appDir, 'main.jsbundle');
  const bundle = existsSync(bundlePath) ? readFileSync(bundlePath).toString('latin1') : null;
  return {
    info,
    appConfig,
    strings: [...leaves(info, 'Info.plist'), ...leaves(appConfig, 'app.config')],
    bundleCounts:
      bundle === null
        ? null
        : Object.fromEntries(
            request.bundleStrings.map((name) => [name, bundle.split(name).length - 1]),
          ),
    testArtefacts: globSync('**/*.{storekit,xctest}', { cwd: appDir }),
    hasPrivacyManifest: existsSync(join(appDir, 'PrivacyInfo.xcprivacy')),
    getTaskAllow: readGetTaskAllow(appDir),
    missingUsageStrings: missingUsageStrings(appDir, info, request.usageStrings),
  };
}
