// src/core/game/level-kit/daily-start.ts
import { dailySeed } from '@/core/dates/daily-seed';

import type { DateKey } from '@/core/dates/date-key';
import type { LevelsSpec } from '@/core/game/levels';

/** Seed and difficulty of one daily challenge: the input of engine.create. */
export type DailyStart = { readonly seed: number; readonly difficulty: number };

/**
 * The daily level: today's local date key plus the game's salt, through the same generator as normal
 * levels, at the daily difficulty. null when the game has no daily mode.
 */
export function dailyStart<TState, TMove>(
  levels: Pick<LevelsSpec<TState, TMove>, 'daily'>,
  date: DateKey,
): DailyStart | null {
  if (levels.daily.kind === 'none') return null;
  return { seed: dailySeed(date, levels.daily.salt), difficulty: levels.daily.difficulty };
}
