// src/games/lights-out/rules/list-moves.ts
// Self-test stand-in: the games skills write the real file; check-game-scaffold only needs it to exist and load.
import type { LightsOutMove, LightsOutState } from '@/games/lights-out/rules/lights-out-types';

export function listMoves(state: LightsOutState): readonly LightsOutMove[] {
  return state.movesLeft > 0 ? state.lit.map((cell) => ({ kind: 'toggle', cell })) : [];
}
