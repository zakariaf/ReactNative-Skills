// scripts/quality/device-only.ts
// The coverage policy for files Jest cannot meaningfully run: native adapters, Skia and
// frame-callback modules, and composition files. Such a file starts with
//   // device-only: covered by <the e2e flow or simulator check that exercises it>
// in its first 6 lines. jest.config.js leaves exactly those files out of coverage (through
// deviceOnlyCoveragePatterns); the test checkers accept the same marker, and a coverage exclusion
// that is not backed by it fails the test-setup check. Fakes and pure helpers always get tests
// instead.
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEVICE_ONLY_HEAD_LINES = 6;

const MARKER = /^\/\/\s*device-only:(?<reason>.*)$/mu;
const REASON = /\bcovered by\s+\S.{8,}/iu;
const SOURCES = ['src/**/*.ts', 'src/**/*.tsx'];
const TEST_FILE = /\.(?:test|golden\.test|sim\.test)\.tsx?$/u;

/** True when the first 6 lines carry the marker and name the check that covers the file. */
export function hasDeviceOnlyMarker(source: string): boolean {
  const head = source.split('\n').slice(0, DEVICE_ONLY_HEAD_LINES).join('\n');
  const reason = MARKER.exec(head)?.groups?.['reason'];
  return reason !== undefined && REASON.test(reason);
}

/** Repo-relative posix paths of every source file under src/ that carries the marker. */
export function deviceOnlyFiles(rootDir: string): readonly string[] {
  return SOURCES.flatMap((pattern) => globSync(pattern, { cwd: rootDir }))
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => !TEST_FILE.test(file) && !file.endsWith('.d.ts'))
    .filter((file) => hasDeviceOnlyMarker(readFileSync(path.join(rootDir, file), 'utf8')))
    .sort();
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Jest coveragePathIgnorePatterns entries, one exact path per marked file. */
export function deviceOnlyCoveragePatterns(rootDir: string): readonly string[] {
  return deviceOnlyFiles(rootDir).map((file) => `<rootDir>/${escapeRegExp(file)}$`);
}
