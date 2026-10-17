// src/core/game/stats.ts
import type { MessageId } from '@/core/game/messages';

/**
 * A game-specific statistic (2 to 4 per game). When a run ends, the host replays its kept move
 * line, measures each move's events and folds the numbers in (undone moves never count).
 */
export type CounterSpec<TEvent> = {
  /** kebab-case and stable forever: it is a key in stored statistics. */
  readonly id: string;
  readonly labelId: MessageId;
  readonly aggregate: 'sum' | 'max';
  /** One move's events to a number; pure and cheap. */
  readonly measure: (events: readonly TEvent[]) => number;
};

export type StatsSpec<TEvent> = { readonly counters: readonly CounterSpec<TEvent>[] };
