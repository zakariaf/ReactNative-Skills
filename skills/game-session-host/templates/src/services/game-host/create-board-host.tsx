// src/services/game-host/create-board-host.tsx
// The board host: one component per opened run, closing over the typed game and its controller
// (the seam), so the screen renders <BoardHost testID=... /> without knowing any game type. It feeds
// the game's Surface the saved state and the last events, keeps the tap-then-tap selection as UI
// state, and sends intents to the controller, where only the game's intentToMove makes moves (a
// real-time board sends its save points the same way).
import { useState, useSyncExternalStore } from 'react';

import { routeIntent, selectedAt } from '@/services/game-host/board-host-model';
import { useGameSessionStore } from '@/stores/game-session/game-session-store';

import type { GameIntent } from '@/core/game/game-input';
import type { BoardSelection } from '@/services/game-host/board-host-model';
import type { BoardHostInput, BoardHostProps } from '@/services/game-host/game-host';
import type { ComponentType, JSX } from 'react';

/** create-board-host's BoardHostFactory: GameHostDeps.createBoardHost in the composition root. */
export function createBoardHost<TState, TMove, TEvent, TIntent extends GameIntent>({
  game,
  controller,
}: BoardHostInput<TState, TMove, TEvent, TIntent>): ComponentType<BoardHostProps> {
  const { Surface } = game;
  function BoardHost({ testID }: BoardHostProps): JSX.Element {
    const session = useGameSessionStore(controller.store, (state) => state.session);
    const hintedMove = useSyncExternalStore(controller.handle.subscribe, controller.hintedMove);
    const [selection, setSelection] = useState<BoardSelection | null>(null);
    const selected = selectedAt(selection, session.eventSeq);
    const handleIntent = (intent: TIntent): void => {
      const route = routeIntent({
        intent,
        selected,
        seq: session.eventSeq,
        selectRegions: game.input.selectRegions,
      });
      setSelection(route.selection);
      if (route.intent !== null) controller.sendIntent(route.intent);
    };
    return (
      <Surface
        testID={testID}
        state={session.state}
        lastEvents={session.lastEvents}
        eventSeq={session.eventSeq}
        isInputEnabled={session.status === 'playing'}
        isEnded={session.status === 'won' || session.status === 'lost'}
        selected={selected}
        hintedMove={hintedMove}
        onIntent={handleIntent}
        onSavePoint={controller.savePoint}
      />
    );
  }
  return BoardHost;
}
