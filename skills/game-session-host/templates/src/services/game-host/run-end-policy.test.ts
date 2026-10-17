// src/services/game-host/run-end-policy.test.ts
import { backCommandOf, isLossStranded } from './run-end-policy';

import type { SessionView } from './session-view';

const LOST: SessionView = {
  status: 'lost',
  ref: { kind: 'endless' },
  hud: { score: 12, goal: { id: 'tally.goal', values: {} } },
  moveCount: 9,
  isUndoSupported: true,
  canUndo: false,
  isHintSupported: true,
  isHintAvailable: false,
  isHintShown: false,
  continueState: 'offered',
  continueDescriptionId: 'tally.continue.step-back',
  loseReasonKey: 'tally.lose.overshot',
  summary: null,
  saveFailure: null,
  eventSeq: 9,
  tutorialStep: null,
};

describe('isLossStranded', () => {
  it('is true only for a pending loss whose rescue nobody can give', () => {
    expect(isLossStranded(LOST, 'hidden')).toBe(true);
  });

  it('keeps the loss pending while the rescue can still come (free, ready or loading)', () => {
    expect(isLossStranded(LOST, 'free')).toBe(false);
    expect(isLossStranded(LOST, 'ready')).toBe(false);
    expect(isLossStranded(LOST, 'loading')).toBe(false);
  });

  it('is false for a run that is playing, recorded, or has no rescue on offer', () => {
    expect(isLossStranded({ ...LOST, status: 'playing' }, 'hidden')).toBe(false);
    expect(isLossStranded({ ...LOST, continueState: 'used' }, 'hidden')).toBe(false);
    expect(isLossStranded({ ...LOST, continueState: 'none' }, 'hidden')).toBe(false);
  });
});

describe('backCommandOf', () => {
  it('pauses in play, resumes in Pause and finishes a pending loss instead of leaving', () => {
    expect(backCommandOf({ ...LOST, status: 'playing' })).toStrictEqual({ type: 'pause' });
    expect(backCommandOf({ ...LOST, status: 'paused' })).toStrictEqual({ type: 'resume' });
    expect(backCommandOf(LOST)).toStrictEqual({ type: 'finish' });
  });

  it('lets Back go once nothing live is left behind', () => {
    const summary = {
      ref: LOST.ref,
      isWon: false,
      loseReasonKey: null,
      score: 12,
      moves: 9,
      playMs: 0,
      stars: 0,
      par: null,
      isNewBest: false,
      isPractice: false,
      bestScore: 12,
      nextLevel: null,
    } as const;

    expect(backCommandOf(null)).toBeNull();
    expect(backCommandOf({ ...LOST, summary })).toBeNull();
    expect(backCommandOf({ ...LOST, continueState: 'none' })).toBeNull();
    expect(backCommandOf({ ...LOST, status: 'won' })).toBeNull();
  });
});
