// scripts/release/test-only-sentinels.ts
// The test-only sentinels of the app: every exported *SENTINEL* string constant in its source
// (debug-menu-and-test-hooks' test-only entry exports one, for example TASKS_TEST_BUILD_ONLY), plus
// rn-skills.config.json testOnlySentinels. The gate requires them in preview builds and refuses them
// in production builds; a test-only gate without any sentinel stops the release before the bump.
// The source folders are rn-skills.config.json srcDir (when set) and <appDir>/src, the same folders
// check-store-artifact reads.
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SENTINEL_CONST =
  /\bexport\s+const\s+[A-Z0-9_]*SENTINEL[A-Z0-9_]*\s*(?::\s*[\w.<>|[\] ]+)?=\s*(['"])([^'"\n]{6,})\1/g;
const NOT_APP_CODE = /\.(?:test|spec)\.[jt]sx?$|\.d\.ts$|(?:^|\/)__tests__\//;

export function sentinelsIn(source: string): string[] {
  return [...source.matchAll(SENTINEL_CONST)]
    .map((match) => match[2] ?? '')
    .filter((name) => name !== '');
}

/** Every sentinel under `srcDir`, tests and type declarations left out. */
export function findSentinels(srcDir: string): string[] {
  const files = globSync('**/*.{ts,tsx,js,jsx}', { cwd: srcDir }).filter(
    (file) => !NOT_APP_CODE.test(file),
  );
  return [
    ...new Set(files.flatMap((file) => sentinelsIn(readFileSync(join(srcDir, file), 'utf8')))),
  ].sort();
}

/** The testOnlySentinels strings of a parsed rn-skills.config.json (anything else is ignored). */
export function configuredSentinels(config: unknown): string[] {
  const list: unknown =
    typeof config === 'object' && config !== null
      ? Reflect.get(config, 'testOnlySentinels')
      : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter((value): value is string => typeof value === 'string' && value.trim() !== '');
}

/** The app's source folders that exist: rn-skills.config.json srcDir (when set), then <appDir>/src. */
export function appSourceDirs(appDir: string, projectConfig: unknown): string[] {
  const configured: unknown =
    typeof projectConfig === 'object' && projectConfig !== null
      ? Reflect.get(projectConfig, 'srcDir')
      : undefined;
  const dirs = [typeof configured === 'string' ? configured : null, join(appDir, 'src')];
  return [...new Set(dirs.filter((dir): dir is string => dir !== null && existsSync(dir)))];
}

/** The parsed rn-skills.config.json at `file`, or null when there is none. */
export function readProjectConfig(file: string): unknown {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : null;
}

/** The first test-only gate file under `srcDirs` (debug-menu-and-test-hooks), or null. */
export function findTestOnlyGate(srcDirs: readonly string[]): string | null {
  for (const srcDir of srcDirs) {
    const gate = globSync('**/test-only.{ts,tsx,js,jsx}', { cwd: srcDir })[0];
    if (gate !== undefined) return join(srcDir, gate);
  }
  return null;
}

/**
 * Why the gate cannot judge test-only code, or null: a test-only gate exists but no sentinel is
 * known, so a production build could carry the debug menu and nothing would notice.
 */
export function sentinelGapProblem(
  gate: string | null,
  sentinels: readonly string[],
): string | null {
  if (gate === null || sentinels.length > 0) return null;
  return `${gate} gates test-only code, but no test-only sentinel is known: the gate cannot prove whether that code shipped. Export one from the test-only entry (export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY') or list it in rn-skills.config.json testOnlySentinels, then rerun (no build number was used yet)`;
}

/** The sentinels the release checks, from `srcDirs` and the parsed rn-skills.config.json. */
export function releaseSentinels(srcDirs: readonly string[], projectConfig: unknown): string[] {
  const found = srcDirs.flatMap((dir) => findSentinels(dir));
  return [...new Set([...found, ...configuredSentinels(projectConfig)])].sort();
}
