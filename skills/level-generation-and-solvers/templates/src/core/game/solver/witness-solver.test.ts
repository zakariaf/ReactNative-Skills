// src/core/game/solver/witness-solver.test.ts
import fc from 'fast-check';

import { randomPolicy } from '@/core/game/testing/play-bot';
import { nextInt } from '@/core/rng/sfc32';

import { verifyLine } from './verify-line';
import { createWitnessSolver } from './witness-solver';

import type { BotPolicy } from '@/core/game/testing/play-bot';
import type { RngState } from '@/core/rng/sfc32';

/** Toy dice race: step 1 or 2, plus a drawn bonus 0..1 far from the goal; 10 wins, past it loses. */
type Race = { readonly at: number; readonly score: number; readonly rng: RngState };
const GOAL = 10;
const RULES = {
  listMoves: (state: Race): readonly number[] => (state.at < GOAL ? [1, 2] : []),
  applyMove: (state: Race, step: number) => {
    const bonus = nextInt(state.rng, 2);
    const stepped = state.at + step;
    const at = stepped <= GOAL - 2 ? stepped + bonus.value : stepped;
    return { state: { at, score: state.score + at, rng: bonus.state }, events: [] };
  },
  outcome: (state: Race) => {
    if (state.at === GOAL) return { kind: 'won', score: state.score } as const;
    return state.at > GOAL
      ? ({ kind: 'lost', reasonKey: 'race.lose.overshot' } as const)
      : ({ kind: 'playing' } as const);
  },
};
const start = (seed: number): Race => ({ at: 0, score: 0, rng: [seed >>> 0, 1, 2, 3] });

/** Never overshoots: the small step when the goal is close. */
const careful: BotPolicy<Race, number> = (state, moves, rng) => ({
  move: state.at >= GOAL - 3 ? 1 : (moves.at(-1) ?? 1),
  rng,
});
/** Always the big step: overshoots on most seeds. */
const reckless: BotPolicy<Race, number> = (_state, moves, rng) => ({
  move: moves.at(-1) ?? 2,
  rng,
});

const witness = (policy: BotPolicy<Race, number>) =>
  createWitnessSolver({ rules: RULES, policy, botSeed: 0x5bd1e995 });

describe('createWitnessSolver', () => {
  it('returns the winning line, its length as par and the state it ends in', () => {
    const result = witness(careful).solve(start(7), 1_000);
    if (result.kind !== 'solved') throw new Error(`expected solved, got ${result.kind}`);
    expect(result.par).toBe(result.line.length);
    expect(result.final.at).toBe(GOAL);
    expect(verifyLine(RULES, start(7), result.line)).toStrictEqual({
      kind: 'wins',
      moves: result.par,
    });
  });

  it('reports a lost witness as budget-exceeded, never unsolvable', () => {
    const lost = { ...start(1), at: GOAL + 1 };
    expect(witness(careful).solve(lost, 1_000)).toStrictEqual({ kind: 'budget-exceeded' });
  });

  it('stops once the policy has been shown more moves than maxNodes', () => {
    expect(witness(careful).solve(start(7), 3)).toStrictEqual({ kind: 'budget-exceeded' });
  });

  it('solves a start that is already won with par 0', () => {
    const won = { ...start(1), at: GOAL };
    expect(witness(careful).solve(won, 10)).toStrictEqual({
      kind: 'solved',
      par: 0,
      line: [],
      final: won,
    });
  });

  it('gives the same answer for the same start (fixed bot seed), and every win replays', () => {
    fc.assert(
      fc.property(fc.nat(), fc.boolean(), (seed, isReckless) => {
        const solver = witness(isReckless ? reckless : randomPolicy());
        const result = solver.solve(start(seed), 1_000);
        expect(solver.solve(start(seed), 1_000)).toStrictEqual(result);
        const line = result.kind === 'solved' ? result.line : null;
        const replay = line === null ? 'no win' : verifyLine(RULES, start(seed), line).kind;
        expect(replay).toBe(line === null ? 'no win' : 'wins');
      }),
      { seed: 11, numRuns: 100 },
    );
  });
});
