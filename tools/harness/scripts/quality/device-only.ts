// scripts/quality/device-only.ts
// The coverage policy for files Jest cannot meaningfully run: native adapters, Skia and
// frame-callback modules, and composition files. Such a file starts with
//   // device-only: covered by <the e2e flow or simulator check that exercises it>
// in its first 6 lines. jest.config.js leaves exactly those files out of coverage (through
// deviceOnlyCoveragePatterns); the test checkers accept the same marker, and a coverage exclusion
// that is not backed by it fails the test-setup check. Fakes and pure helpers always get tests
// instead. A single app's code is src/; when multi-package (package.json "workspaces") it is also
// the src/ of every workspace the root package.json declares (apps/*, packages/*, functions, ...).
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEVICE_ONLY_HEAD_LINES = 6;

const MARKER = /^\/\/\s*device-only:(?<reason>.*)$/mu;
const REASON = /\bcovered by\s+\S.{8,}/iu;
const SOURCE_FILES = ['src/**/*.ts', 'src/**/*.tsx'];
const TEST_FILE = /\.(?:test|golden\.test|sim\.test)\.tsx?$/u;

/** True when the first 6 lines carry the marker and name the check that covers the file. */
export function hasDeviceOnlyMarker(source: string): boolean {
  const head = source.split('\n').slice(0, DEVICE_ONLY_HEAD_LINES).join('\n');
  const reason = MARKER.exec(head)?.groups?.['reason'];
  return reason !== undefined && REASON.test(reason);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The workspace globs of the root package.json (a list, or { "packages": [...] }), "!" ones included. */
function workspaceGlobs(rootDir: string): readonly string[] {
  const file = path.join(rootDir, 'package.json');
  if (!existsSync(file)) {
    return [];
  }
  const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const declared: unknown =
    typeof manifest === 'object' && manifest !== null && 'workspaces' in manifest
      ? manifest.workspaces
      : undefined;
  const list: unknown =
    typeof declared === 'object' && declared !== null && 'packages' in declared
      ? declared.packages
      : declared;
  return Array.isArray(list)
    ? list
        .filter((glob): glob is string => typeof glob === 'string')
        .map((glob) => glob.replace(/\/+$/u, ''))
    : [];
}

/** True when a repo path sits in a folder a "!" workspace glob takes out of the workspaces. */
function inNegatedWorkspace(file: string, negated: readonly string[]): boolean {
  return negated.some((glob) =>
    new RegExp(`^${glob.split('*').map(escapeRegExp).join('[^/]*')}/`, 'u').test(file),
  );
}

/** Repo-relative posix paths of every source file under a src/ folder that carries the marker. */
export function deviceOnlyFiles(rootDir: string): readonly string[] {
  const globs = workspaceGlobs(rootDir);
  const negated = globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
  const prefixes = ['', ...globs.filter((glob) => !glob.startsWith('!')).map((glob) => `${glob}/`)];
  const files = prefixes
    .flatMap((prefix) => SOURCE_FILES.map((pattern) => `${prefix}${pattern}`))
    .flatMap((pattern) => globSync(pattern, { cwd: rootDir }))
    .map((file) => file.split(path.sep).join('/'));
  return [...new Set(files)]
    .filter((file) => !TEST_FILE.test(file) && !file.endsWith('.d.ts'))
    .filter((file) => !inNegatedWorkspace(file, negated))
    .filter((file) => hasDeviceOnlyMarker(readFileSync(path.join(rootDir, file), 'utf8')))
    .sort();
}

/** Jest coveragePathIgnorePatterns entries, one exact path per marked file. */
export function deviceOnlyCoveragePatterns(rootDir: string): readonly string[] {
  return deviceOnlyFiles(rootDir).map((file) => `<rootDir>/${escapeRegExp(file)}$`);
}
