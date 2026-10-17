// src/games/lights-out/rules/outcome.ts
// Self-test stand-in: the games skills write the real file; check-game-scaffold only needs it to exist and load.
import type { LightsOutState } from '@/games/lights-out/rules/lights-out-types';

export function outcome(state: LightsOutState) {
  if (state.lit.length === 0) return { kind: 'won', score: state.movesLeft };
  return state.movesLeft > 0 ? { kind: 'playing' } : { kind: 'lost', reasonKey: 'lights-out.lose.out-of-moves' };
}
