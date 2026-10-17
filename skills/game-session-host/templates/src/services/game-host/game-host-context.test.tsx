// src/services/game-host/game-host-context.test.tsx
// no-providers: the hooks under test read only GameHostsProvider, which each test mounts itself.
import { renderHook } from '@testing-library/react-native';

import { createGameHostTestDeps } from '@test/games/game-host-test-deps';
import { TALLY_HOSTED } from '@test/games/tally-hosted';

import { createGameHost } from './game-host';
import { GameHostsProvider, useGameHost, useGameHosts } from './game-host-context';

import type { GameHost } from './game-host';
import type { ReactNode } from 'react';

function hostsWrapper(hosts: readonly GameHost[]) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <GameHostsProvider hosts={hosts}>{children}</GameHostsProvider>;
  };
}

describe('GameHostsProvider', () => {
  const host = createGameHost(TALLY_HOSTED, createGameHostTestDeps());

  it('hands every host down and finds one by id', async () => {
    const { result } = await renderHook(
      () => ({ all: useGameHosts(), one: useGameHost('tally') }),
      {
        wrapper: hostsWrapper([host]),
      },
    );

    expect(result.current.all).toStrictEqual([host]);
    expect(result.current.one).toBe(host);
  });

  it('throws without a provider, and for a game that is not hosted', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(renderHook(() => useGameHosts())).rejects.toThrow('GameHostsProvider');
    await expect(
      renderHook(() => useGameHost('chess'), { wrapper: hostsWrapper([host]) }),
    ).rejects.toThrow('chess');
    spy.mockRestore();
  });
});
