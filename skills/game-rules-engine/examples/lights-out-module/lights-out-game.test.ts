// src/games/lights-out/lights-out-game.test.ts
import { engineContractProblems } from '@/core/game/testing/engine-contract';

import { BOARD_REGION } from './canvas/intent-to-move';
import { LIGHTS_OUT_GAME } from './lights-out-game';

import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';
import type { LightsOutState } from '@/games/lights-out/rules/lights-out-types';

/**
 * What the surface can send: a tap on every cell plus a row below the grid and another region,
 * and the pan intents its panMode never sends. Each move they yield must be one listMoves lists.
 */
function everyIntent(state: LightsOutState): CanvasIntent[] {
  const taps: CanvasIntent[] = [];
  for (let row = 0; row <= state.rows; row += 1) {
    for (let col = 0; col < state.cols; col += 1) {
      taps.push({ kind: 'tap', target: { regionId: BOARD_REGION, col, row }, selected: null });
    }
  }
  const elsewhere = { regionId: 'header', col: 0, row: 0 };
  return [
    ...taps,
    { kind: 'tap', target: elsewhere, selected: null },
    { kind: 'swipe', direction: 'left', from: null },
    { kind: 'aim', dx: 3, dy: -4 },
  ];
}

describe('LIGHTS_OUT_GAME', () => {
  it('keeps the game contract with the input the surface sends', () => {
    const problems = engineContractProblems({
      gameId: LIGHTS_OUT_GAME.identity.id,
      engine: LIGHTS_OUT_GAME.engine,
      persistence: LIGHTS_OUT_GAME.persistence,
      starts: [0, 50, 100].flatMap((difficulty) => [1, 2].map((seed) => ({ seed, difficulty }))),
      maxMoves: 40,
      input: LIGHTS_OUT_GAME.input,
      intents: everyIntent,
    });
    expect(problems).toStrictEqual([]);
  });
});
