// src/services/game-host/tutorial-script.test.ts
import { isSameMove, isTutorialMoveAccepted, tutorialCoachOf } from './tutorial-script';

import type { TutorialStep } from './hosted-game';

type Move = { readonly kind: 'add'; readonly amount: 1 | 2 };

const ONE: Move = { kind: 'add', amount: 1 };
const TWO: Move = { kind: 'add', amount: 2 };
const STEPS: readonly TutorialStep<Move>[] = [
  { messageId: 'tally.tutorial.add-two', expect: { kind: 'move', move: TWO } },
  { messageId: 'tally.tutorial.any', expect: { kind: 'any-move' } },
];

describe('isSameMove', () => {
  it('compares plain-data moves by value', () => {
    expect(isSameMove({ kind: 'add', amount: 2 }, TWO)).toBe(true);
    expect(isSameMove(ONE, TWO)).toBe(false);
    expect(isSameMove([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
    expect(isSameMove([1], [1, 2])).toBe(false);
    expect(isSameMove({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('isTutorialMoveAccepted', () => {
  it('accepts only the step move, any move on an any-move step, and anything after the script', () => {
    expect(isTutorialMoveAccepted(STEPS, TWO, 0)).toBe(true);
    expect(isTutorialMoveAccepted(STEPS, ONE, 0)).toBe(false);
    expect(isTutorialMoveAccepted(STEPS, ONE, 1)).toBe(true);
    expect(isTutorialMoveAccepted(STEPS, ONE, 2)).toBe(true);
  });
});

describe('tutorialCoachOf', () => {
  it('names the step the run waits for, and nothing after the script or without one', () => {
    expect(tutorialCoachOf(STEPS, 1)).toStrictEqual({
      messageId: 'tally.tutorial.any',
      index: 1,
      count: 2,
    });
    expect(tutorialCoachOf(STEPS, 2)).toBeNull();
    expect(tutorialCoachOf(null, 0)).toBeNull();
  });
});
