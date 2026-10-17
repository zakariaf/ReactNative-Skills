// src/core/game-results/run-ref.ts
// Which run a session is, as plain data shared by the session store, the run storage and the
// screens (route params carry the same kinds). Pure.
import type { DateKey } from '@/core/dates/date-key';

/**
 * A numbered level, the daily level of one date, an endless run, or the game's tutorial (which
 * plays in memory beside the saved run and is never stored or recorded).
 */
export type RunRef =
  | { readonly kind: 'level'; readonly level: number }
  | { readonly kind: 'daily'; readonly date: DateKey }
  | { readonly kind: 'endless' }
  | { readonly kind: 'tutorial' };

/** A stable key for a run's best score and result rows: 'level:12', 'daily:2026-10-14', 'endless'. */
export function runKeyOf(ref: RunRef): string {
  switch (ref.kind) {
    case 'level':
      return `level:${String(ref.level)}`;
    case 'daily':
      return `daily:${ref.date}`;
    case 'endless':
    case 'tutorial':
      return ref.kind;
  }
}
