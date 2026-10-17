// src/games/pig/testing/pig-bot.ts
// Pig's bot hooks. Pig draws during play (every roll advances state.rng), so a one-ply search sees
// the next roll before it decides: greedyPolicy would hold exactly before every bust. That is the
// upper bound of skill, not a person, so the reasonable player is a rule a person could follow
// (hold at 20, or as soon as the target is reached) and greedyPolicy is not used here at all.
import { applyMove } from '@/games/pig/rules/apply-move';
import { listMoves } from '@/games/pig/rules/list-moves';
import { outcome } from '@/games/pig/rules/outcome';
import { TUNING } from '@/games/pig/rules/pig-tuning';

import type { BotPolicy } from '@/core/game/testing/play-bot';
import type { EventTag } from '@/core/game-balance/trace-bot';
import type { PigEvent, PigMove, PigState } from '@/games/pig/rules/pig-types';

/** The classic solo threshold: below it the expected gain of a roll beats the risk of a bust. */
const HOLD_AT = 20;

/** The engine members the searching bots need. */
export const PIG_SEARCH = { listMoves, applyMove, outcome };

/**
 * How good a position looks to the searching bots (higher is better): banked points count fully,
 * points still at risk in the turn count half, and every turn left is worth a little.
 */
export function evaluatePig(state: PigState): number {
  const turnsLeft = Math.max(state.maxTurns - state.turn, 0);
  return state.banked * 2 + state.turnTotal + turnsLeft;
}

/** The report's "score": the banked points the top bar shows (the endless run's result too). */
export function scoreOfPig(state: PigState): number {
  return state.banked;
}

/**
 * Payoff: a roll that survives (push-your-luck's "yes"; banks are measured by the score). Twist: a
 * bust that throws away points the turn had already rolled.
 */
export function tagPigEvent(event: PigEvent): readonly EventTag[] {
  if (event.kind === 'die-rolled' && event.face !== TUNING.bustFace) return ['payoff'];
  return event.kind === 'turn-busted' && event.lostPoints > 0 ? ['twist'] : [];
}

/** The reasonable player and the testing spec's bot: hold at 20 or once the target is reached. */
export const pigBot: BotPolicy<PigState, PigMove> = (state, moves, rng) => {
  const canReachTarget = state.target > 0 && state.banked + state.turnTotal >= state.target;
  const wanted = state.turnTotal >= HOLD_AT || canReachTarget ? 'hold' : 'roll';
  const move = moves.find((candidate) => candidate.kind === wanted) ?? moves[0];
  if (move === undefined) throw new Error('pigBot called without legal moves');
  return { move, rng };
};
