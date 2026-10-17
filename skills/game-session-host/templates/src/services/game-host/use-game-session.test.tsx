// src/services/game-host/use-game-session.test.tsx
// no-providers: the hook reads only GameHostsProvider, which the test mounts around it.
import { act, renderHook } from '@testing-library/react-native';
import { StrictMode } from 'react';

import { createGameHostTestDeps } from '@test/games/game-host-test-deps';
import { TALLY_HOSTED } from '@test/games/tally-hosted';

import { createGameHost } from './game-host';
import { GameHostsProvider } from './game-host-context';
import { useGameSession } from './use-game-session';

import type { GameHost } from './game-host';
import type { ReactNode } from 'react';

function hostsWrapper(hosts: readonly GameHost[]) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <StrictMode>
        <GameHostsProvider hosts={hosts}>{children}</GameHostsProvider>
      </StrictMode>
    );
  };
}

describe('useGameSession', () => {
  it('opens the run once and follows its view', async () => {
    const host = createGameHost(TALLY_HOSTED, createGameHostTestDeps());
    const { result } = await renderHook(
      () => useGameSession('tally', { start: 'new', ref: { kind: 'level', level: 1 } }),
      {
        wrapper: hostsWrapper([host]),
      },
    );

    expect(result.current.view?.status).toBe('playing');
    expect(result.current.BoardHost).not.toBeNull();

    await act(() => {
      result.current.send({ type: 'pause' });
    });

    expect(result.current.view?.status).toBe('paused');
  });

  it('writes only the run on screen once under StrictMode, and makes it the active run', async () => {
    const deps = createGameHostTestDeps();
    const host = createGameHost(TALLY_HOSTED, deps);
    const { result } = await renderHook(
      () => useGameSession('tally', { start: 'new', ref: { kind: 'endless' } }),
      { wrapper: hostsWrapper([host]) },
    );

    expect(deps.runs.writes()).toStrictEqual(['write-run']);

    await act(() => {
      host.debugControls().endActiveRun('win');
    });

    expect(result.current.view?.status).toBe('won');
  });

  it('has no view when there is no run to open', async () => {
    const host = createGameHost(TALLY_HOSTED, createGameHostTestDeps());
    const { result } = await renderHook(() => useGameSession('tally', { start: 'resume' }), {
      wrapper: hostsWrapper([host]),
    });

    expect(result.current.view).toBeNull();
    expect(result.current.BoardHost).toBeNull();
  });

  it('starts the next run in the same screen', async () => {
    const host = createGameHost(TALLY_HOSTED, createGameHostTestDeps());
    const { result } = await renderHook(
      () => useGameSession('tally', { start: 'new', ref: { kind: 'level', level: 1 } }),
      {
        wrapper: hostsWrapper([host]),
      },
    );
    await act(() => {
      result.current.startRun({ kind: 'level', level: 2 });
    });

    expect(result.current.view?.ref).toStrictEqual({ kind: 'level', level: 2 });
  });
});
