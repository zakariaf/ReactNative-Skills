// test/sims/write-sim-report.ts
// Node side of the bot simulations: the fingerprint that ties a report to the code it measured,
// and the report file itself (reports/sim/<game-id>.json, git-ignored, identical bytes on a rerun).
// check-balance.mjs (game-balance-and-bots) recomputes the same fingerprint in plain JavaScript, so
// keep SIM_LAYOUT equal to the app's rn-skills.config.json keys (gamesDir, coreDir, simsDir).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

import type { SimReport } from '@/core/game-balance/balance-bands';

/** Where the games, the pure core, the sims and the reports live (repo-relative, posix). */
export const SIM_LAYOUT = {
  gamesDir: 'src/games',
  coreDir: 'src/core',
  simsDir: 'test/sims',
  reportsDir: 'reports/sim',
  /** The tsconfig path alias of src/ ("@/*": ["./src/*"]). */
  alias: { prefix: '@/', target: 'src/' },
} as const;

/** A game's folders whose every source can change a bot result. */
export const GAME_LOGIC_FOLDERS = ['rules', 'levels', 'sim', 'geom', 'testing'] as const;

/** Every quoted specifier after `from` or `import` (static, side-effect and dynamic imports). */
const SPECIFIER = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
/** The level tables a generator writes from the rules after the sims: outputs, not inputs. */
const GENERATED_PACK = /\/levels\/pack-[^/]*\.json$/;
/** How an extensionless import resolves, in the order TypeScript and Metro probe. */
const PROBES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'] as const;

/** The game's logic folders and its sim folder; src/core counts only as far as they import it. */
export function fingerprintFolders(gameId: string): readonly string[] {
  return [
    ...GAME_LOGIC_FOLDERS.map((folder) => `${SIM_LAYOUT.gamesDir}/${gameId}/${folder}`),
    `${SIM_LAYOUT.simsDir}/${gameId}`,
  ];
}

/**
 * Sources count; unit tests and snapshots do not (sim tests do: they choose seeds and players), and
 * neither do the bands or the generated packs, so approving bands or writing packs keeps it fresh.
 */
function isFingerprinted(path: string): boolean {
  if (path.endsWith('.sim.test.ts')) return true;
  if (/\.test\.tsx?$/.test(path) || path.includes('.snap')) return false;
  if (path.endsWith('balance-bands.json') || GENERATED_PACK.test(path)) return false;
  return /\.(ts|tsx|json)$/.test(path);
}

function isFile(root: string, path: string): boolean {
  return existsSync(join(root, path)) && statSync(join(root, path)).isFile();
}

function filesUnder(root: string, folder: string): string[] {
  const base = join(root, folder);
  if (!existsSync(base)) return [];
  return readdirSync(base, { recursive: true, encoding: 'utf8' })
    .map((path) => `${folder}/${path.split(sep).join('/')}`)
    .filter((path) => isFingerprinted(path) && isFile(root, path));
}

/** The repo path a local specifier in `from` names before probing, or '' for a package. */
function localBase(from: string, specifier: string): string {
  const { alias } = SIM_LAYOUT;
  if (specifier.startsWith(alias.prefix))
    return alias.target + specifier.slice(alias.prefix.length);
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(from), specifier));
  return '';
}

/** The src/core file a specifier in `from` names, or null (a package, a game folder, a test helper). */
function coreTarget(root: string, from: string, specifier: string): string | null {
  const base = localBase(from, specifier);
  if (!base.startsWith(`${SIM_LAYOUT.coreDir}/`)) return null;
  const found = PROBES.map((probe) => base + probe).find((path) => isFile(root, path));
  return found !== undefined && isFingerprinted(found) ? found : null;
}

/** The src/core files `starts` import, followed through src/core's own imports (a source scan). */
function coreClosure(root: string, starts: readonly string[]): string[] {
  const seen = new Set<string>();
  const queue = [...starts];
  // for...of also visits the files pushed while it runs: a breadth-first walk of the imports.
  for (const from of queue) {
    for (const match of readFileSync(join(root, from), 'utf8').matchAll(SPECIFIER)) {
      const target = coreTarget(root, from, match[1] ?? '');
      if (target === null || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return [...seen];
}

/** Every file the fingerprint hashes, sorted by repo-relative path. */
export function fingerprintFiles(gameId: string, root: string = process.cwd()): readonly string[] {
  const own = fingerprintFolders(gameId).flatMap((folder) => filesUnder(root, folder));
  return [...new Set([...own, ...coreClosure(root, own)])].sort();
}

/** sha256 over "<repo-relative path>\n<bytes>\n" of every fingerprinted file, sorted by path. */
export function rulesFingerprint(gameId: string, root: string = process.cwd()): string {
  const hash = createHash('sha256');
  for (const path of fingerprintFiles(gameId, root)) {
    hash.update(`${path}\n`);
    hash.update(readFileSync(join(root, path)));
    hash.update('\n');
  }
  return hash.digest('hex');
}

/** Writes reports/sim/<gameId>.json (two-space JSON, trailing newline) and returns its path. */
export function writeSimReport(report: SimReport, root: string = process.cwd()): string {
  const dir = join(root, ...SIM_LAYOUT.reportsDir.split('/'));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${report.gameId}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}
