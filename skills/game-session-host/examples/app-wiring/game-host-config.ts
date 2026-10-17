// src/config/game-host-config.ts
// What the app decides per game, beside the game's own rules. game-session-host's checker loads
// this file and each game module and fails an option the rules cannot honour (a rescue the rules
// do not have, free hints for a game without hints). Plain data and type imports only.
import type { GameHostOptions } from '@/services/game-host/game-host';

export const GAME_HOST_CONFIG = {
  'lights-out': {
    // The rules have continueRun 'once'; the app may still switch the rescue off (false).
    isContinueAllowed: true,
    // game-rules-engine's Lights Out has hints { kind: 'none' }, so no free hints. A game whose rules
    // offer a solver hint sets its daily allowance here (2: two free, then the monetization layer).
    freeHintsPerDay: 0,
  },
} as const satisfies Readonly<Record<string, GameHostOptions>>;
