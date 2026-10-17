// src/api/query-managers.test.ts
// TanStack's managers are module singletons: every test disconnects in afterEach, which also proves
// that the disconnect restores the defaults the next test starts from.
import { focusManager, onlineManager } from '@tanstack/react-query';

import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { flushMicrotasks } from '@test/flush-microtasks';

import { createQueryClient } from './create-query-client';
import { connectQueryManagers } from './query-managers';

import type { AppStateSource } from './query-managers';

type FakeAppState = AppStateSource & {
  readonly change: (state: string) => void;
  readonly listenerCount: () => number;
};

function createFakeAppState(initial: string): FakeAppState {
  let current = initial;
  const listeners = new Set<(state: string) => void>();
  return {
    get currentState() {
      return current;
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    change: (state) => {
      current = state;
      for (const listener of listeners) listener(state);
    },
    listenerCount: () => listeners.size,
  };
}

describe('connectQueryManagers', () => {
  let disconnect: () => void = () => undefined;

  afterEach(() => {
    disconnect();
    disconnect = () => undefined;
  });

  it('follows the ConnectivityPort, starting from its current state', () => {
    const connectivity = createFakeConnectivity(false);
    disconnect = connectQueryManagers({ appState: createFakeAppState('active'), connectivity });
    const seen = [onlineManager.isOnline()];
    connectivity.setOnline(true);
    seen.push(onlineManager.isOnline());

    expect(seen).toStrictEqual([false, true]);
  });

  it('stays online on a network Android has not validated: requests there may still succeed', () => {
    const connectivity = createFakeConnectivity(true);
    disconnect = connectQueryManagers({ appState: createFakeAppState('active'), connectivity });
    connectivity.setReachability('unvalidated');
    const isOnlineWhileUnvalidated = onlineManager.isOnline();
    connectivity.setReachability('none');

    expect([isOnlineWhileUnvalidated, onlineManager.isOnline()]).toStrictEqual([true, false]);
  });

  it('is unfocused while the app is inactive or in the background', () => {
    const appState = createFakeAppState('active');
    disconnect = connectQueryManagers({ appState, connectivity: createFakeConnectivity(true) });
    const seen = [focusManager.isFocused()];
    for (const state of ['inactive', 'active', 'background']) {
      appState.change(state);
      seen.push(focusManager.isFocused());
    }

    expect(seen).toStrictEqual([true, false, true, false]);
  });

  it('unsubscribes and restores the defaults on disconnect', () => {
    const appState = createFakeAppState('background');
    const connectivity = createFakeConnectivity(false);
    connectQueryManagers({ appState, connectivity })();

    expect([appState.listenerCount(), connectivity.listenerCount()]).toStrictEqual([0, 0]);
    expect([onlineManager.isOnline(), focusManager.isFocused()]).toStrictEqual([true, true]);
  });

  it('pauses a query while offline and runs it when the network returns', async () => {
    const connectivity = createFakeConnectivity(false);
    disconnect = connectQueryManagers({ appState: createFakeAppState('active'), connectivity });
    const queryClient = createQueryClient({ errorLog: createFakeErrorLog() });
    // QueryClientProvider mounts its client; only a mounted client hears the online manager.
    queryClient.mount();
    let runs = 0;
    const fetching = queryClient.query({
      queryKey: ['probe'],
      queryFn: () => {
        runs += 1;
        return Promise.resolve('fresh');
      },
    });
    await flushMicrotasks();
    const whileOffline = [runs, queryClient.getQueryState(['probe'])?.fetchStatus];
    connectivity.setOnline(true);

    await expect(fetching).resolves.toBe('fresh');
    expect(whileOffline).toStrictEqual([0, 'paused']);
    queryClient.unmount();
    queryClient.clear();
  });
});
