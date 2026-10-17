// scripts/levels/run-level-plan.test.ts
import { findLevelPlan, levelsDir, packPath, planKitPath } from './run-level-plan.ts';

describe('packPath', () => {
  it('numbers the pack files from 1 inside the game levels folder', () => {
    expect(levelsDir('src/games', 'lights-out')).toBe('src/games/lights-out/levels');
    expect(packPath('src/games', 'lights-out', 0)).toBe('src/games/lights-out/levels/pack-1.json');
    expect(packPath('src/games', 'lights-out', 2)).toBe('src/games/lights-out/levels/pack-3.json');
  });
});

describe('planKitPath', () => {
  it('points at the level kit under the app sources', () => {
    expect(planKitPath('src')).toBe('src/core/game/level-kit/plan-level-table.ts');
    expect(planKitPath('app/src')).toBe('app/src/core/game/level-kit/plan-level-table.ts');
  });
});

describe('findLevelPlan', () => {
  const plan = {
    gameId: 'demo',
    solver: { solve: () => ({ kind: 'unsolvable' }) },
    rate: () => null,
  };

  it('finds the exported plan among the module exports', () => {
    expect(findLevelPlan({ LEVELS_PER_PACK: 30, DEMO_LEVEL_PLAN: plan })).toBe(plan);
  });

  it('returns null for a module without a plan', () => {
    expect(findLevelPlan({ difficultyFor: () => 0 })).toBeNull();
    expect(findLevelPlan(null)).toBeNull();
  });
});
