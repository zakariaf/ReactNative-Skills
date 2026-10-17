// src/features/root-navigator/games-root.tsx
// device-only: covered by the root render test and the app launch (it only wires tested parts)
// Creates the game hosts once, after the data layer opened and the services exist, and hands them
// down. Mounted inside the navigation theme in root-stack.tsx (app-startup-and-bootstrap's provider
// order), so every route (Home's continue button, the game list, the Game screen) can read them.
import { useState } from 'react';

import { useAppData } from '@/data/app-data-context';
import { createGameHosts } from '@/games/game-registry';
import { playCue } from '@/services/feedback/play-cue';
import { createBoardHost } from '@/services/game-host/create-board-host';
import { GameHostsProvider } from '@/services/game-host/game-host-context';
import { useServices } from '@/services/services-context';

import { GAME_FEEDBACK } from './game-feedback';

import type { JSX, ReactNode } from 'react';

export function GamesRoot({ children }: { readonly children: ReactNode }): JSX.Element {
  const { clock, errorLog, audio, haptics } = useServices();
  const { gameRuns } = useAppData();
  // A useState initializer: once per React tree (never a plain call in the body: each render would
  // re-validate saved runs and replace the hosts). The hosts validate saved runs when created, so
  // they must exist before any screen asks for a saved run, and never at import time.
  const [hosts] = useState(() =>
    createGameHosts({
      runs: gameRuns,
      clock,
      errorLog,
      createBoardHost,
      feedback: (result) => {
        playCue({ audio, haptics }, GAME_FEEDBACK[result]);
      },
    }),
  );
  return <GameHostsProvider hosts={hosts}>{children}</GameHostsProvider>;
}
