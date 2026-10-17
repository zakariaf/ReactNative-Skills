// src/core/game/level-kit/star-rating.ts
// The one star formula (level-generation-and-solvers owns it). Pure: the session host calls it once,
// when a won level is recorded (game-session-host syncs this file), and level tooling calls it too.
import type { StarRule } from '@/core/game/levels';

/** 0 for a loss; 1 to 3 for a win. Only wins are recorded as level results. */
export type StarCount = 0 | 1 | 2 | 3;

/** The facts of a finished level that stars are rated on. */
export type RatedRun = {
  readonly isWon: boolean;
  /** Moves the player made (undone moves not counted). */
  readonly moves: number;
  readonly score: number;
};

/** A win within par + 2 moves still earns 2 stars (one slack per app, never per level). */
export const PAR_SLACK_FOR_TWO_STARS = 2;

function parStars(par: number, moves: number): StarCount {
  if (moves <= par) return 3;
  return moves <= par + PAR_SLACK_FOR_TWO_STARS ? 2 : 1;
}

function scoreStars(thresholds: readonly [number, number, number], score: number): StarCount {
  if (score >= thresholds[2]) return 3;
  return score >= thresholds[1] ? 2 : 1;
}

/**
 * The one star formula. Puzzle levels: 3 at or under par, 2 up to par + 2, 1 for finishing.
 * Score levels: 3 / 2 at thresholds[2] / thresholds[1], 1 for finishing. thresholds[0] is the
 * lowest score a win can have (0 when the win is not score-based, for example a game won by
 * reaching a target whatever the score); the game's outcome decides the win, so starsFor never reads it.
 */
export function starsFor(rule: StarRule, run: RatedRun): StarCount {
  if (!run.isWon) return 0;
  return rule.kind === 'par'
    ? parStars(rule.par, run.moves)
    : scoreStars(rule.thresholds, run.score);
}

/** Score-rated levels have no par: the result shows the score and the level best instead. */
export function isScoreRule(rule: StarRule): rule is Extract<StarRule, { readonly kind: 'score' }> {
  return rule.kind === 'score';
}
