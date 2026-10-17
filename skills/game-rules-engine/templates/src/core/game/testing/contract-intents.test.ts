// src/core/game/testing/contract-intents.test.ts
import { contractIntentProblems, inputMemberProblems } from './contract-intents';

import type { GameInput } from '@/core/game/game-input';

/** Toy: pick a slot of the tray (a select region), then tap a board cell to put its number there. */
type Target = { readonly regionId: string; readonly col: number; readonly row: number };
type Intent =
  | { readonly kind: 'tap'; readonly target: Target; readonly selected: Target | null }
  | { readonly kind: 'swipe'; readonly direction: 'left' | 'right' };
type Move = { readonly kind: 'put'; readonly slot: number; readonly col: number };

const slot = (col: number): Target => ({ regionId: 'tray', col, row: 0 });
const cell = (col: number): Target => ({ regionId: 'board', col, row: 0 });
const tap = (target: Target): Intent => ({ kind: 'tap', target, selected: null });
const MOVES: readonly Move[] = [0, 1].flatMap((from) =>
  [0, 1, 2].map((col): Move => ({ kind: 'put', slot: from, col })),
);
const INPUT: GameInput<null, Move, Intent> = {
  panMode: 'none',
  selectRegions: ['tray'],
  intentToMove: (_state, intent) =>
    intent.kind === 'tap' && intent.selected !== null && intent.target.regionId === 'board'
      ? { kind: 'put', slot: intent.selected.col, col: intent.target.col }
      : null,
};
const INTENTS = [slot(0), slot(1), cell(0), cell(1), cell(2)].map(tap);

describe('contractIntentProblems', () => {
  it('tries every board tap with every tapped tray slot as the selection', () => {
    let calls = 0;
    const counting: GameInput<null, Move, Intent> = {
      ...INPUT,
      intentToMove: (state, intent) => {
        calls += 1;
        return INPUT.intentToMove(state, intent);
      },
    };
    expect(contractIntentProblems(counting, { state: null, moves: MOVES }, INTENTS)).toStrictEqual(
      [],
    );
    expect(calls).toBe(5 + 3 * 2);
  });

  it('reports a selected move that listMoves does not list', () => {
    const problems = contractIntentProblems(INPUT, { state: null, moves: MOVES.slice(1) }, INTENTS);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"selected":{"regionId":"tray","col":0,"row":0}');
  });

  it('reports a swipe accepted while the pan mode never sends one', () => {
    const swiping: GameInput<null, Move, Intent> = {
      ...INPUT,
      intentToMove: (_state, intent) => (intent.kind === 'swipe' ? (MOVES[0] ?? null) : null),
    };
    const swipe: Intent = { kind: 'swipe', direction: 'left' };
    expect(contractIntentProblems(swiping, { state: null, moves: MOVES }, [swipe])).toStrictEqual([
      "intentToMove accepts a swipe intent, but with panMode 'none' the surface never sends one (panMode 'swipe')",
    ]);
  });
});

describe('inputMemberProblems', () => {
  it('accepts a known pan mode with a list of select regions', () => {
    expect(inputMemberProblems(INPUT)).toStrictEqual([]);
  });

  it('reports an unknown pan mode and select regions that are not region ids', () => {
    const broken = { ...INPUT, panMode: 'tilt', selectRegions: [7] } as unknown as typeof INPUT;
    expect(inputMemberProblems(broken)).toStrictEqual([
      "panMode 'tilt' is not 'none', 'swipe', 'drag' or 'aim'",
      'selectRegions 7 is not a list of region ids ([] when every tap acts)',
    ]);
  });
});
