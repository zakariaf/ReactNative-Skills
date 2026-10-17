// src/features/game/game-screen.tsx
// The Game screen: a pure view of the model. The board is the host's BoardHost (the game's own
// Surface behind the seam); the top bar, Pause and the result are this app's components
// (ui-component-library), fed with plain data. A game's texts are runtime message ids (MessageId);
// gameText formats one with the app's t() (i18n-strings-and-catalogs' guard for runtime keys).

import { GameResult } from '@/features/game/components/game-result';
import { GameTopBar } from '@/features/game/components/game-top-bar';
import { PauseSheet } from '@/features/game/components/pause-sheet';
import { TutorialCoachBar } from '@/features/game/components/tutorial-coach-bar';
import { useGameModel } from '@/features/game/use-game-model';
import { gameText } from '@/i18n/game-text';
import { useT } from '@/i18n/t-context';
import { ALL_EDGES, ScreenFrame } from '@/ui/screen-frame';

import type { SessionOpen } from '@/services/game-host/open-session';
import type { JSX } from 'react';

export type GameScreenProps = { readonly gameId: string; readonly open: SessionOpen };

export function GameScreen({ gameId, open }: GameScreenProps): JSX.Element {
  const t = useT();
  const model = useGameModel(gameId, open);
  const { view, BoardHost } = model;
  if (view === null || BoardHost === null) {
    // Nothing to open (no saved run, an unknown level): ui-states-and-feedback's empty state.
    return <ScreenFrame testID="game.missing" edges={ALL_EDGES} />;
  }
  return (
    <ScreenFrame testID="game.screen" edges={ALL_EDGES}>
      <GameTopBar
        goal={gameText(t, view.hud.goal)}
        score={view.hud.score}
        canUndo={view.canUndo}
        isUndoShown={view.isUndoSupported}
        isHintShown={model.isHintOffered}
        onUndo={model.onUndo}
        onHint={model.onHint}
        onPause={model.onPause}
      />
      {view.tutorialStep === null ? null : (
        <TutorialCoachBar
          step={view.tutorialStep}
          text={gameText(t, { id: view.tutorialStep.messageId, values: {} })}
        />
      )}
      <BoardHost testID="game.board" />
      {view.status === 'paused' ? (
        <PauseSheet onResume={model.onResume} onHome={model.onHome} />
      ) : null}
      {/* A decided run's result shows once its end is on disk (summary set); a loss still waiting
          for its rescue shows the offer (summary null, continueState 'offered'). */}
      {view.summary !== null || view.status === 'lost' ? (
        <GameResult
          view={view}
          onContinue={model.onContinue}
          onPlayAgain={model.onPlayAgain}
          onHome={model.onHome}
        />
      ) : null}
    </ScreenFrame>
  );
}
