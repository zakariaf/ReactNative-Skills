// src/core/game/level-kit/pack-progress.test.ts
import {
  defaultStarsToUnlock,
  isLevelUnlocked,
  isPackUnlocked,
  nextLevel,
  packOf,
  starsMissing,
  totalStars,
} from './pack-progress';

import type { LevelEntry, LevelPack } from '@/core/game/levels';

const PACKS: readonly LevelPack[] = [
  { id: 'first', nameId: 'demo.pack.first', firstLevel: 1, levelCount: 30, starsToUnlock: 0 },
  { id: 'second', nameId: 'demo.pack.second', firstLevel: 31, levelCount: 30, starsToUnlock: 45 },
];
const TABLE: readonly LevelEntry[] = [1, 2, 3].map((level) => ({
  level,
  seed: level,
  difficulty: level,
  stars: { kind: 'par', par: 3 },
}));

describe('defaultStarsToUnlock', () => {
  it('asks half of the earlier stars: 0, 45 and 90 for packs of 30', () => {
    expect([0, 1, 2].map((index) => defaultStarsToUnlock(index, 30))).toStrictEqual([0, 45, 90]);
  });
});

describe('isLevelUnlocked', () => {
  it('opens level 1 on a fresh save and nothing after it', () => {
    expect(isLevelUnlocked(PACKS, {}, 1)).toBe(true);
    expect(isLevelUnlocked(PACKS, {}, 2)).toBe(false);
  });

  it('opens the next level once the previous one is won', () => {
    expect(isLevelUnlocked(PACKS, { 1: 1 }, 2)).toBe(true);
  });

  it('opens the first level of a pack by stars alone', () => {
    const stars = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, 3]));
    expect(totalStars(stars)).toBe(45);
    expect(isLevelUnlocked(PACKS, stars, 31)).toBe(true);
    expect(isLevelUnlocked(PACKS, stars, 32)).toBe(false);
  });

  it('keeps a locked pack shut and says how many stars are missing', () => {
    const second = packOf(PACKS, 31);
    if (second === undefined) throw new Error('pack missing');
    expect(isPackUnlocked(second, { 1: 3 })).toBe(false);
    expect(starsMissing(second, { 1: 3 })).toBe(42);
    expect(isLevelUnlocked(PACKS, { 1: 3 }, 31)).toBe(false);
  });

  it('rejects a level outside every pack', () => {
    expect(isLevelUnlocked(PACKS, {}, 99)).toBe(false);
  });
});

describe('nextLevel', () => {
  it('returns the following level, or null after the last', () => {
    expect(nextLevel(TABLE, 2)).toBe(3);
    expect(nextLevel(TABLE, 3)).toBeNull();
  });
});
