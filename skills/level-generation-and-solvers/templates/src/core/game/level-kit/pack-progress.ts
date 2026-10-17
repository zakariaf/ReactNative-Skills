// src/core/game/level-kit/pack-progress.ts
import type { LevelEntry, LevelPack } from '@/core/game/levels';

/** Best stars per completed level number (1..3); a level that is absent was never won. */
export type StarsByLevel = Readonly<Partial<Record<number, number>>>;

/** Stars a pack needs, by default: half of all stars of the packs before it (0, 45, 90 for packs of 30). */
export function defaultStarsToUnlock(packIndex: number, levelsPerPack: number): number {
  return Math.floor((packIndex * levelsPerPack * 3) / 2);
}

/** Sum of best stars over every completed level. */
export function totalStars(stars: StarsByLevel): number {
  let total = 0;
  for (const value of Object.values(stars)) total += value ?? 0;
  return total;
}

/** The pack that holds `level`, or undefined for a level outside every pack. */
export function packOf(packs: readonly LevelPack[], level: number): LevelPack | undefined {
  return packs.find(
    (pack) => level >= pack.firstLevel && level < pack.firstLevel + pack.levelCount,
  );
}

/** Packs unlock by stars collected in total, so no player is stuck behind one hard level. */
export function isPackUnlocked(pack: LevelPack, stars: StarsByLevel): boolean {
  return totalStars(stars) >= pack.starsToUnlock;
}

/**
 * Levels unlock one after another inside an unlocked pack; the first level of a pack
 * opens with the pack itself, whatever happened to the last level of the pack before.
 */
export function isLevelUnlocked(
  packs: readonly LevelPack[],
  stars: StarsByLevel,
  level: number,
): boolean {
  const pack = packOf(packs, level);
  if (pack === undefined || !isPackUnlocked(pack, stars)) return false;
  return level === pack.firstLevel || (stars[level - 1] ?? 0) > 0;
}

/** Stars still missing before `pack` opens (0 when it is open): the "Collect n more stars" line of a locked pack. */
export function starsMissing(pack: LevelPack, stars: StarsByLevel): number {
  return Math.max(0, pack.starsToUnlock - totalStars(stars));
}

/** The level after `level` in the table, or null after the last one (the "Next level" button of the result screen). */
export function nextLevel(table: readonly LevelEntry[], level: number): number | null {
  return table.some((entry) => entry.level === level + 1) ? level + 1 : null;
}
