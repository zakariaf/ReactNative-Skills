// src/games/pig/rules/continue-run.test.ts
import { continueRun } from './continue-run';
import { create } from './create';
import { outcome } from './outcome';
import { TUNING, knobsFor } from './pig-tuning';

const MAX_TURNS = knobsFor(0).maxTurns;

describe('continueRun', () => {
  it('adds turns after running out of them', () => {
    const lost = { ...create(1, 0), turn: MAX_TURNS, busts: 0 };
    const { state, events } = continueRun(lost);
    expect(outcome(state)).toStrictEqual({ kind: 'playing' });
    expect(state.maxTurns).toBe(MAX_TURNS + TUNING.continueTurns);
    expect(events).toStrictEqual([{ kind: 'turns-added', count: TUNING.continueTurns }]);
  });

  it('clears a bust streak and keeps the stream (no re-roll)', () => {
    const lost = { ...create(1, 0), turn: 3, busts: TUNING.maxBusts };
    const { state, events } = continueRun(lost);
    expect(outcome(state)).toStrictEqual({ kind: 'playing' });
    expect(state.rng).toStrictEqual(lost.rng);
    expect(events).toStrictEqual([{ kind: 'busts-cleared', count: TUNING.maxBusts }]);
  });

  it('refuses a run that is not lost', () => {
    expect(() => continueRun(create(1, 0))).toThrow(RangeError);
  });
});
