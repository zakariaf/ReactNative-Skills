// src/games/lights-out/levels/lights-out-levels.ts
// Self-test stand-in: the games skills write the real file; check-game-scaffold only needs it to exist and load.
const packs = [1, 2, 3].map((pack) => ({ id: `pack-${pack}`, nameId: 'lights-out.name', firstLevel: (pack - 1) * 30 + 1, levelCount: 30, starsToUnlock: 0 }));

export const LIGHTS_OUT_LEVELS = {
  difficultyFor: (level: number) => Math.min(99, level),
  packs,
  table: [],
  solver: null,
  daily: { kind: 'daily', difficulty: 50, salt: 4660 },
  endless: { kind: 'none' },
};
