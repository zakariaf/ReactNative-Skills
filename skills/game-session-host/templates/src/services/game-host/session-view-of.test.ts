// src/services/game-host/session-view-of.test.ts
import { TALLY_GAME } from '@test/games/tally-game';
import { TALLY_RULES as RULES, playTally, startTally as started } from '@test/games/tally-runs';

import { sessionRulesFor } from './open-session';
import { continueStateOf, sessionViewOf } from './session-view-of';

import type { SessionExtras } from './session-view-of';
import type { TallyMove } from '@test/games/tally-game';

const DEPS = { rules: RULES, gameRules: TALLY_GAME.rules, tutorial: null };
const NO_EXTRAS: SessionExtras<TallyMove> = { summary: null, hint: null, saveFailure: null };

describe('sessionViewOf', () => {
  it('shows plain data only: hud, undo, hints and the rescue state', () => {
    const view = sessionViewOf(DEPS, started(), NO_EXTRAS);

    expect(view).toMatchObject({
      status: 'playing',
      hud: { score: 0, goal: { id: 'tally.goal', values: { target: 4 } } },
      isUndoSupported: true,
      canUndo: false,
      isHintSupported: true,
      isHintAvailable: true,
      isHintShown: false,
      continueState: 'none',
      continueDescriptionId: 'tally.continue.step-back',
      summary: null,
    });
  });

  it('shows a hint only for the position it was given at', () => {
    const hint = { move: { kind: 'add', amount: 2 } as const, atSeq: 0 };

    expect(sessionViewOf(DEPS, started(), { ...NO_EXTRAS, hint }).isHintShown).toBe(true);
    expect(
      sessionViewOf(DEPS, started(), { ...NO_EXTRAS, hint: { ...hint, atSeq: 3 } }).isHintShown,
    ).toBe(false);
  });

  it('offers a hint only while the run is live and the solver has one', () => {
    const noHint = {
      ...DEPS,
      gameRules: { ...TALLY_GAME.rules, hints: { kind: 'solver', suggest: () => null } } as const,
    };

    expect(sessionViewOf(DEPS, playTally(started(), [2, 2]), NO_EXTRAS).isHintAvailable).toBe(
      false,
    );
    expect(sessionViewOf(noHint, started(), NO_EXTRAS).isHintAvailable).toBe(false);
  });

  it('names the coached step of a tutorial run', () => {
    const tutorial = [
      { messageId: 'tally.tutorial.add-two', expect: { kind: 'any-move' } },
    ] as const;

    expect(sessionViewOf({ ...DEPS, tutorial }, started(), NO_EXTRAS).tutorialStep).toStrictEqual({
      messageId: 'tally.tutorial.add-two',
      index: 0,
      count: 1,
    });
    expect(sessionViewOf(DEPS, started(), NO_EXTRAS).tutorialStep).toBeNull();
  });
});

describe('continueStateOf', () => {
  it('offers the rescue on a loss, marks it used, and offers none when the rules have none', () => {
    const lost = playTally(started(), [2, 1, 2]);

    expect(continueStateOf(RULES, lost)).toBe('offered');
    expect(continueStateOf(RULES, { ...lost, continuesUsed: 1 })).toBe('used');
    expect(continueStateOf(sessionRulesFor(TALLY_GAME, false), lost)).toBe('none');
  });
});
