// src/games/lights-out/rules/apply-move.ts
// Self-test stand-in: the games skills write the real file; check-game-scaffold only needs it to exist and load.
import type { LightsOutMove, LightsOutState } from '@/games/lights-out/rules/lights-out-types';

export function applyMove(state: LightsOutState, move: LightsOutMove) {
  const lit = state.lit.filter((cell) => cell !== move.cell);
  return { state: { lit, movesLeft: state.movesLeft - 1 }, events: [{ kind: 'cell-toggled', cell: move.cell }] };
}
