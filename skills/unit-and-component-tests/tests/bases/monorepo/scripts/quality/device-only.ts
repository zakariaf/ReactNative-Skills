// scripts/quality/device-only.ts (multi-package: SOURCES lists each workspace's src/)
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MARKER = /^\/\/\s*device-only:(?<reason>.*)$/mu;
const REASON = /\bcovered by\s+\S.{8,}/iu;
const SOURCES = ['apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx', 'packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'];
const TEST_FILE = /\.(?:test|golden\.test|sim\.test)\.tsx?$/u;

export function hasDeviceOnlyMarker(source: string): boolean {
  const head = source.split('\n').slice(0, 6).join('\n');
  const reason = MARKER.exec(head)?.groups?.['reason'];
  return reason !== undefined && REASON.test(reason);
}

export function deviceOnlyFiles(rootDir: string): readonly string[] {
  return SOURCES.flatMap((pattern) => globSync(pattern, { cwd: rootDir }))
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => !TEST_FILE.test(file) && !file.endsWith('.d.ts'))
    .filter((file) => hasDeviceOnlyMarker(readFileSync(path.join(rootDir, file), 'utf8')))
    .sort();
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export function deviceOnlyCoveragePatterns(rootDir: string): readonly string[] {
  return deviceOnlyFiles(rootDir).map((file) => `<rootDir>/${escapeRegExp(file)}$`);
}
