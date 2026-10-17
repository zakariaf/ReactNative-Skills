// src/games/lights-out/rules/lights-out-types.ts
// Self-test stand-in: the games skills write the real file; check-game-scaffold only needs it to exist and load.
export type LightsOutState = { readonly lit: readonly number[]; readonly movesLeft: number };
export type LightsOutMove = { readonly kind: 'toggle'; readonly cell: number };
export type LightsOutEvent = { readonly kind: 'cell-toggled'; readonly cell: number };
