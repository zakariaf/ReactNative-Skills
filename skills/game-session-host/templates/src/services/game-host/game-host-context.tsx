// src/services/game-host/game-host-context.tsx
// The app's game hosts, created once in the composition root (after the data layer opened, before
// any screen reads a saved run) and handed down. Context carries the hosts, never run state.
import { createContext, use } from 'react';

import type { GameHost } from '@/services/game-host/game-host';
import type { JSX, ReactNode } from 'react';

const GameHostsContext = createContext<readonly GameHost[] | null>(null);

export type GameHostsProviderProps = {
  readonly hosts: readonly GameHost[];
  readonly children: ReactNode;
};

export function GameHostsProvider({ hosts, children }: GameHostsProviderProps): JSX.Element {
  return <GameHostsContext value={hosts}>{children}</GameHostsContext>;
}

/** Every hosted game, in registry order (a game list, Home's continue button). */
export function useGameHosts(): readonly GameHost[] {
  const hosts = use(GameHostsContext);
  if (hosts === null) throw new Error('useGameHosts() needs a <GameHostsProvider> above it');
  return hosts;
}

/** One game's host. An unknown id is a programmer error (route params are parsed first), so it throws. */
export function useGameHost(gameId: string): GameHost {
  const host = useGameHosts().find((candidate) => candidate.id === gameId);
  if (host === undefined)
    throw new Error(`no hosted game "${gameId}" (src/games/game-registry.ts)`);
  return host;
}
