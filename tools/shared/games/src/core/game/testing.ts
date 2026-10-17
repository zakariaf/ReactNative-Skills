// src/core/game/testing.ts
import type { BotPolicy } from '@/core/game/testing/play-bot';

/** States for screenshots, a debug menu and E2E setup: one per outcome the game can show. */
export type ExampleStateId = 'start' | 'middle' | 'win' | 'lose';

export type TestingSpec<TState, TMove> = {
  /** A reasonable player for balance runs and hints; randomPolicy() is the baseline. */
  readonly bot: BotPolicy<TState, TMove>;
  readonly examples: Readonly<Record<ExampleStateId, () => TState>>;
};
