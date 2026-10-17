// src/core/game-balance/bot-policies.ts
import { nextInt } from '@/core/rng/sfc32';

import type { GameEngine } from '@/core/game/game-engine';
import type { BotPolicy } from '@/core/game/testing/play-bot';
import type { RngState } from '@/core/rng/sfc32';

/** How good a state looks to a bot: higher is better. Pure; reads only the state. */
export type Evaluate<TState> = (state: TState) => number;

/** The engine members a searching bot needs; any game's engine satisfies it. */
export type SearchRules<TState, TMove, TEvent> = Pick<
  GameEngine<TState, TMove, TEvent>,
  'listMoves' | 'applyMove' | 'outcome'
>;

/** Search depth and width of the lookahead bot. */
export type LookaheadOptions = {
  /** Plies searched: 2 = my move plus my best follow-up. */
  readonly depth: number;
  /** Moves kept per ply after a one-ply ranking (keeps a decision under a few thousand applyMoves). */
  readonly beam: number;
};

const WIN_BONUS = 1_000_000;
const LOSS_PENALTY = -1_000_000;

/** Evaluation that also knows the outcome: a win beats any position, a loss is worse than any. */
function judge<TState, TMove, TEvent>(
  rules: SearchRules<TState, TMove, TEvent>,
  evaluate: Evaluate<TState>,
  state: TState,
): number {
  const outcome = rules.outcome(state);
  if (outcome.kind === 'won') return WIN_BONUS + evaluate(state);
  if (outcome.kind === 'lost') return LOSS_PENALTY + evaluate(state);
  return evaluate(state);
}

/** Uniform choice among the best-scoring moves: the seeded RNG breaks ties, so no first-move bias. */
function pickBest<TMove>(
  moves: readonly TMove[],
  scores: readonly number[],
  rng: RngState,
): { readonly move: TMove; readonly rng: RngState } {
  const best = Math.max(...scores);
  const tied = moves.filter((_, index) => scores[index] === best);
  const draw = nextInt(rng, tied.length);
  const move = tied[draw.value];
  if (move === undefined) throw new Error('bot called without legal moves');
  return { move, rng: draw.state };
}

/** A candidate of a search: the state a move leads to and how it looks one ply deep. */
type Scored<TState> = { readonly child: TState; readonly score: number; readonly index: number };

/** The `beam` best-scoring candidates, best first (ties keep move order). */
function topCandidates<TState>(scored: readonly Scored<TState>[], beam: number): Scored<TState>[] {
  return [...scored]
    .sort((a, b) => (a.score === b.score ? a.index - b.index : b.score - a.score))
    .slice(0, beam);
}

/** Greedy: the move whose next state evaluates best (one ply). The usual "reasonable player". */
export function greedyPolicy<TState, TMove, TEvent>(
  rules: SearchRules<TState, TMove, TEvent>,
  evaluate: Evaluate<TState>,
): BotPolicy<TState, TMove> {
  return (state, moves, rng) => {
    const scores = moves.map((move) => judge(rules, evaluate, rules.applyMove(state, move).state));
    return pickBest(moves, scores, rng);
  };
}

/**
 * Lookahead: best value over `depth` plies of its own moves, searching only the `beam` best moves
 * per ply. It sees the seeded future (next draws), so it is an upper bound of skill, not a human.
 */
export function lookaheadPolicy<TState, TMove, TEvent>(
  rules: SearchRules<TState, TMove, TEvent>,
  evaluate: Evaluate<TState>,
  options: LookaheadOptions,
): BotPolicy<TState, TMove> {
  /** Every move's child state with its one-ply score, in move order. */
  const scoreChildren = (state: TState, moves: readonly TMove[]): Scored<TState>[] =>
    moves.map((move, index) => {
      const child = rules.applyMove(state, move).state;
      return { child, score: judge(rules, evaluate, child), index };
    });
  /** Value of a state with `plies` of its own moves still to search (0 = just evaluate it). */
  const valueOf = (state: TState, plies: number): number => {
    const here = judge(rules, evaluate, state);
    if (plies <= 0 || rules.outcome(state).kind !== 'playing') return here;
    const kept = topCandidates(scoreChildren(state, rules.listMoves(state)), options.beam);
    // A playing state without moves breaks the engine contract; it is valued as it stands.
    if (kept.length === 0) return here;
    return Math.max(...kept.map((candidate) => valueOf(candidate.child, plies - 1)));
  };
  return (state, moves, rng) => {
    const scored = scoreChildren(state, moves);
    const kept = new Set(topCandidates(scored, options.beam).map((candidate) => candidate.index));
    const scores = scored.map((candidate) =>
      kept.has(candidate.index) ? valueOf(candidate.child, options.depth - 1) : LOSS_PENALTY * 2,
    );
    return pickBest(moves, scores, rng);
  };
}
