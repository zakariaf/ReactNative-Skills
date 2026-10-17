// src/core/game/level-kit/plan-level-table.ts
import { hashSeed } from '@/core/rng/sfc32';

import { defaultStarsToUnlock } from './pack-progress';

import type { LevelPlan, PackTable } from './level-plan';
import type { LevelEntry, LevelPack } from '@/core/game/levels';

/** Where a plan could not produce a level: no candidate passed the solver and `rate`. */
export type PlanFailure = { readonly level: number; readonly tries: number };

export type PlannedTable = {
  readonly packs: readonly PackTable[];
  readonly failures: readonly PlanFailure[];
};

/**
 * The seed tried for `level` at attempt `attempt`: a hash of the game id, so two games never
 * share boards and a regenerated table is identical on every machine.
 */
export function candidateSeed(gameId: string, level: number, attempt: number): number {
  return hashSeed(`${gameId}:level:${String(level)}:${String(attempt)}`);
}

type Seen = Set<string>;

function planLevel<TState, TMove>(
  plan: LevelPlan<TState, TMove>,
  level: number,
  seen: Seen,
): LevelEntry | null {
  const difficulty = plan.difficultyFor(level);
  for (let attempt = 0; attempt < plan.maxTries; attempt += 1) {
    const seed = candidateSeed(plan.gameId, level, attempt);
    const start = plan.create(seed, difficulty);
    const key = JSON.stringify(start);
    if (seen.has(key)) continue;
    const result = plan.solver.solve(start, plan.maxNodes);
    // A witness that lost or ran out of budget is only a retry with the next candidate seed.
    if (result.kind !== 'solved') continue;
    const { par, line, final } = result;
    const stars = plan.rate({ level, seed, difficulty, start, par, line, final });
    if (stars === null) continue;
    seen.add(key);
    return { level, seed, difficulty, stars };
  }
  return null;
}

/**
 * Generates every pack of a plan: for each level, the first candidate seed whose board is new,
 * solvable within the node budget and accepted by `rate`. Deterministic: the same plan always
 * gives the same tables, so tooling can regenerate and diff them.
 */
export function planLevelTable<TState, TMove>(plan: LevelPlan<TState, TMove>): PlannedTable {
  const seen: Seen = new Set();
  const failures: PlanFailure[] = [];
  const packs = plan.packs.map((_pack, index) => {
    const entries: LevelEntry[] = [];
    for (let offset = 1; offset <= plan.levelsPerPack; offset += 1) {
      const level = index * plan.levelsPerPack + offset;
      const entry = planLevel(plan, level, seen);
      if (entry === null) failures.push({ level, tries: plan.maxTries });
      else entries.push(entry);
    }
    return entries;
  });
  return { packs, failures };
}

/** The LevelsSpec packs of a plan: consecutive level ranges, unlocked by the default star rule. */
export function packsOf<TState, TMove>(
  plan: Pick<LevelPlan<TState, TMove>, 'packs' | 'levelsPerPack'>,
): LevelPack[] {
  return plan.packs.map((pack, index) => ({
    id: pack.id,
    nameId: pack.nameId,
    firstLevel: index * plan.levelsPerPack + 1,
    levelCount: plan.levelsPerPack,
    starsToUnlock: defaultStarsToUnlock(index, plan.levelsPerPack),
  }));
}
