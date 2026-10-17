// src/services/game-host/create-board-host.test.tsx
// no-providers: the board host reads only its run's store and controller, which it closes over.
import { act, render, screen, userEvent } from '@testing-library/react-native';

import { createGameHostTestDeps } from '@test/games/game-host-test-deps';
import { TALLY_HOSTED } from '@test/games/tally-hosted';

import { createBoardHost } from './create-board-host';
import { createGameHost } from './game-host';

async function openBoard() {
  const deps = createGameHostTestDeps();
  const host = createGameHost(TALLY_HOSTED, { ...deps, createBoardHost });
  const opened = host.openSession({ start: 'new', ref: { kind: 'level', level: 1 } });
  if (opened === null) throw new Error('no run');
  const { BoardHost, handle } = opened;
  handle.begin();
  await render(<BoardHost testID="game.board" />);
  return { handle, user: userEvent.setup() };
}

describe('createBoardHost', () => {
  it('draws the saved state and sends taps through the game intentToMove', async () => {
    const { handle, user } = await openBoard();
    await user.press(screen.getByTestId('game.board.board.1'));

    expect(handle.getView().moveCount).toBe(1);
    expect(screen.getByTestId('game.board')).toHaveAccessibilityValue({ now: 2, max: 4 });
  });

  it('keeps a tap-then-tap selection as UI state and clears it when the move lands', async () => {
    const { handle, user } = await openBoard();
    await user.press(screen.getByTestId('game.board.tray.0'));

    expect(screen.getByTestId('game.board.tray.0')).toBeSelected();
    expect(handle.getView().moveCount).toBe(0);

    await user.press(screen.getByTestId('game.board.board.1'));

    expect(screen.getByTestId('game.board')).toHaveAccessibilityValue({ now: 1, max: 4 });
    expect(screen.getByTestId('game.board.tray.0')).not.toBeSelected();
  });

  it('outlines the hinted move and stops input while paused', async () => {
    const { handle } = await openBoard();
    await act(() => {
      handle.send({ type: 'hint' });
      handle.send({ type: 'pause' });
    });

    expect(screen.getByTestId('game.board.board.1')).toBeExpanded();
    expect(screen.getByTestId('game.board')).toBeDisabled();
  });
});
