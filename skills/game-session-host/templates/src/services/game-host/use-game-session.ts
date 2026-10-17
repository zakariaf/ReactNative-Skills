// src/services/game-host/use-game-session.ts
// What the Game screen's model hook uses: opens the run once per screen and follows its view.
// Opening is pure (a useState initializer React may repeat in StrictMode); the run is written when
// its handle begins, in an effect, so only the run on screen ever reaches storage.
import { useEffect, useState, useSyncExternalStore } from 'react';

import { useGameHost } from '@/services/game-host/game-host-context';

import type { RunRef } from '@/core/game-results/run-ref';
import type { BoardHostProps, OpenedSession } from '@/services/game-host/game-host';
import type { SessionOpen } from '@/services/game-host/open-session';
import type { SessionCommand, SessionView } from '@/services/game-host/session-view';
import type { ComponentType } from 'react';

/** No game type appears here: the screen gets plain data, commands and the bound board. */
export type GameSessionControls = {
  /** null: there was no run to open (no saved run, an unknown level); leave to Home. */
  readonly view: SessionView | null;
  readonly BoardHost: ComponentType<BoardHostProps> | null;
  readonly send: (command: SessionCommand) => void;
  /** Next level, Replay, Try again: a new run in the same screen; a pending loss is recorded first. */
  readonly startRun: (ref: RunRef) => void;
};

const noSubscription = (): (() => void) => () => undefined;
const noView = (): null => null;

export function useGameSession(gameId: string, open: SessionOpen): GameSessionControls {
  const host = useGameHost(gameId);
  const [opened, setOpened] = useState<OpenedSession | null>(() => host.openSession(open));
  useEffect(() => {
    opened?.handle.begin();
  }, [opened]);
  const view = useSyncExternalStore(
    opened?.handle.subscribe ?? noSubscription,
    opened?.handle.getView ?? noView,
  );
  const send = (command: SessionCommand): void => {
    opened?.handle.send(command);
  };
  return {
    view,
    BoardHost: opened?.BoardHost ?? null,
    send,
    startRun: (ref) => {
      send({ type: 'finish' });
      setOpened(host.openSession({ start: 'new', ref }));
    },
  };
}
