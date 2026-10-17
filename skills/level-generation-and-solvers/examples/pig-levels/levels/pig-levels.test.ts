// src/games/pig/levels/pig-levels.test.ts
import { levelsContractProblems } from '@/core/game/level-kit/levels-contract';
import { PIG_ENGINE } from '@/games/pig/rules/pig-engine';

import { MIN_WITNESS_MOVES } from './pig-level-plan';
import { PIG_LEVELS } from './pig-levels';
import { WITNESS_MAX_MOVES } from './pig-solver';

describe('PIG_LEVELS', () => {
  it('proves every shipped level by a replayed witness win, with packs matching the config', () => {
    const problems = levelsContractProblems({
      levels: PIG_LEVELS,
      engine: PIG_ENGINE,
      config: { packCount: 2, levelsPerPack: 20 },
      maxNodes: WITNESS_MAX_MOVES,
    });
    expect(problems).toStrictEqual([]);
  });

  it('rates every level by score, the win threshold at the level target', () => {
    for (const entry of PIG_LEVELS.table) {
      const start = PIG_ENGINE.create(entry.seed, entry.difficulty);
      expect(entry.stars).toStrictEqual({
        kind: 'score',
        thresholds: [start.target, expect.any(Number), expect.any(Number)],
      });
    }
  });

  it('keeps every witness at least MIN_WITNESS_MOVES long', () => {
    for (const entry of PIG_LEVELS.table) {
      const result = PIG_LEVELS.solver?.solve(
        PIG_ENGINE.create(entry.seed, entry.difficulty),
        WITNESS_MAX_MOVES,
      );
      expect(result?.kind === 'solved' ? result.par : 0).toBeGreaterThanOrEqual(MIN_WITNESS_MOVES);
    }
  });
});
