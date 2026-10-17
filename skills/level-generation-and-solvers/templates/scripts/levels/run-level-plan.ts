// scripts/levels/run-level-plan.ts
// The work behind generate-levels.ts: load a game's level plan, generate its table and write (or,
// with check, compare) one pack-<n>.json per pack, formatted by the repo's own Prettier (its
// config for that path, the json parser), so `prettier --check` and the generator agree on bytes.
// The plan and the kit import the app's @/ code, which Node resolves only through the hooks of
// registerAppImports(). So both load at run time from a URL built here, after the caller has
// registered the hooks; a static value import of src/ would load before them (and
// architecture-and-boundaries' node-import rule rejects it). Type-only imports cost nothing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LevelPlan, PackTable } from '../../src/core/game/level-kit/level-plan.ts';
import type * as PlanLevelTableModule from '../../src/core/game/level-kit/plan-level-table.ts';

/** Where one game's levels live and whether to write or only compare. */
export type LevelRun = {
  readonly rootDir: string;
  /** The app's sources, relative to rootDir (the folder the @/ alias points at). */
  readonly srcDir: string;
  readonly gamesDir: string;
  readonly gameId: string;
  readonly isCheck: boolean;
};

/** What a run did: levels generated, levels without an accepted candidate, packs written or differing. */
export type LevelRunSummary = {
  readonly levels: number;
  readonly failures: readonly string[];
  readonly differing: readonly string[];
};

/** The folder of one game's levels, relative to the repo root. */
export function levelsDir(gamesDir: string, gameId: string): string {
  return join(gamesDir, gameId, 'levels');
}

/** The pack file of the pack at `index` (0-based), relative to the repo root. */
export function packPath(gamesDir: string, gameId: string, index: number): string {
  return join(levelsDir(gamesDir, gameId), `pack-${String(index + 1)}.json`);
}

function isLevelPlan(value: unknown): value is LevelPlan<unknown, unknown> {
  return typeof value === 'object' && value !== null && 'solver' in value && 'rate' in value;
}

/** The one LevelPlan a plan module exports, or null. */
export function findLevelPlan(exported: unknown): LevelPlan<unknown, unknown> | null {
  const values = typeof exported === 'object' && exported !== null ? Object.values(exported) : [];
  return values.find(isLevelPlan) ?? null;
}

/** The kit file that plans a level table, relative to the repo root. */
export function planKitPath(srcDir: string): string {
  return join(srcDir, 'core/game/level-kit/plan-level-table.ts');
}

async function loadKit(run: LevelRun): Promise<typeof PlanLevelTableModule> {
  const url = pathToFileURL(join(run.rootDir, planKitPath(run.srcDir))).href;
  return (await import(url)) as typeof PlanLevelTableModule;
}

async function loadPlan(run: LevelRun): Promise<LevelPlan<unknown, unknown>> {
  const rel = join(levelsDir(run.gamesDir, run.gameId), `${run.gameId}-level-plan.ts`);
  const loaded: unknown = await import(pathToFileURL(join(run.rootDir, rel)).href);
  const plan = findLevelPlan(loaded);
  if (plan === null) throw new Error(`${rel} exports no LevelPlan`);
  return plan;
}

/** The pack as the repo's Prettier writes it (short arrays such as thresholds on one line). */
async function packText(pack: PackTable, path: string): Promise<string> {
  const prettier = await import('prettier');
  const config = (await prettier.resolveConfig(path)) ?? {};
  return prettier.format(JSON.stringify(pack, null, 2), { ...config, parser: 'json' });
}

async function syncPacks(run: LevelRun, packs: readonly PackTable[]): Promise<string[]> {
  const differing: string[] = [];
  for (const [index, pack] of packs.entries()) {
    const rel = packPath(run.gamesDir, run.gameId, index);
    const path = join(run.rootDir, rel);
    const text = await packText(pack, path);
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
    differing.push(rel);
    if (!run.isCheck) writeFileSync(path, text);
  }
  return differing;
}

/** Generates the game's table; writes nothing when a level has no accepted candidate. */
export async function runLevelPlan(run: LevelRun): Promise<LevelRunSummary> {
  const { planLevelTable } = await loadKit(run);
  const { packs, failures } = planLevelTable(await loadPlan(run));
  const failed = failures.map(
    (failure) => `level ${String(failure.level)}: no candidate in ${String(failure.tries)} tries`,
  );
  const differing = failed.length === 0 ? await syncPacks(run, packs) : [];
  return { levels: packs.flat().length, failures: failed, differing };
}
