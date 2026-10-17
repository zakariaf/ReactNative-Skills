// src/core/game/level-kit/level-plan.ts
import type { LevelEntry, Solver, StarRule } from '@/core/game/levels';
import type { MessageId } from '@/core/game/messages';

/** A solved candidate level, as the plan's `rate` sees it. */
export type SolvedCandidate<TState, TMove> = {
  readonly level: number;
  readonly seed: number;
  readonly difficulty: number;
  readonly start: TState;
  /** The solver's line length: exact par for a search, the witness's length for a witness. */
  readonly par: number;
  /** The winning line the solver found (replayed by levelsContractProblems). */
  readonly line: readonly TMove[];
  /** The state the line ends in: a score-rated plan reads its score here, without a replay. */
  readonly final: TState;
};

/**
 * How a game's level table is generated (levels come from seed + difficulty, each one solver-checked,
 * par computed). The game writes one plan in src/games/<game-id>/levels/; scripts/levels/
 * generate-levels.ts runs it and writes the result as pack-<n>.json. Pure and deterministic, like the rules.
 */
export type LevelPlan<TState, TMove> = {
  readonly gameId: string;
  /** In order; pack n holds levels (n-1) * levelsPerPack + 1 ... n * levelsPerPack. */
  readonly packs: readonly { readonly id: string; readonly nameId: MessageId }[];
  readonly levelsPerPack: number;
  /** The difficulty curve (0..99; 100 is the endless run), non-decreasing with the level number. */
  readonly difficultyFor: (level: number) => number;
  /** The generator: GameEngine.create. */
  readonly create: (seed: number, difficulty: number) => TState;
  /** An exact search (par games) or createWitnessSolver (score games with random draws). */
  readonly solver: Solver<TState, TMove>;
  /** Solver node budget per candidate seed (a candidate over budget is skipped). */
  readonly maxNodes: number;
  /** Candidate seeds tried per level before the plan gives up on that level. */
  readonly maxTries: number;
  /** Quality gate and star rule: a StarRule for a good level, null to reject the candidate. */
  readonly rate: (candidate: SolvedCandidate<TState, TMove>) => StarRule | null;
};

/** One committed pack file (pack-<n>.json): the entries of that pack, in level order. */
export type PackTable = readonly LevelEntry[];
