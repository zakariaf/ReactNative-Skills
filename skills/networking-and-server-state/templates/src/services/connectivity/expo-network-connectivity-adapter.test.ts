// src/services/connectivity/expo-network-connectivity-adapter.test.ts
// Drives the adapter against Jest's automock of expo-network (read with a typed requireMock).
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { flushMicrotasks } from '@test/flush-microtasks';

import { createExpoNetworkConnectivityAdapter } from './expo-network-connectivity-adapter';

jest.mock('expo-network');

type NetworkState = { readonly isConnected?: boolean; readonly isInternetReachable?: boolean };
type MockedNetwork = {
  readonly getNetworkStateAsync: jest.Mock<Promise<NetworkState>>;
  readonly addNetworkStateListener: jest.Mock<
    { remove: () => void },
    [(state: NetworkState) => void]
  >;
};

const network = jest.requireMock<MockedNetwork>('expo-network');
const ONLINE: NetworkState = { isConnected: true, isInternetReachable: true };
const OFFLINE: NetworkState = { isConnected: false, isInternetReachable: false };
const UNVALIDATED: NetworkState = { isConnected: true, isInternetReachable: false };

function lastListener(): (state: NetworkState) => void {
  const listener = network.addNetworkStateListener.mock.calls.at(-1)?.[0];
  if (listener === undefined) throw new Error('the adapter did not subscribe to expo-network');
  return listener;
}

function createAdapter(): {
  readonly connectivity: ReturnType<typeof createExpoNetworkConnectivityAdapter>;
  readonly seen: boolean[];
  readonly errorLog: ReturnType<typeof createFakeErrorLog>;
} {
  const errorLog = createFakeErrorLog();
  const connectivity = createExpoNetworkConnectivityAdapter({ errorLog });
  const seen: boolean[] = [];
  connectivity.subscribe((isOnline) => seen.push(isOnline));
  return { connectivity, seen, errorLog };
}

describe('createExpoNetworkConnectivityAdapter', () => {
  it('is offline until the first report, then follows the network', async () => {
    network.getNetworkStateAsync.mockResolvedValueOnce(ONLINE);
    const { connectivity, seen } = createAdapter();

    expect(connectivity.isOnline()).toBe(false);
    await flushMicrotasks();
    expect(connectivity.isOnline()).toBe(true);

    lastListener()(OFFLINE);

    expect([connectivity.isOnline(), seen]).toStrictEqual([false, [true, false]]);
  });

  it('stays online on a network Android has not validated, and reports it as unvalidated', async () => {
    network.getNetworkStateAsync.mockResolvedValueOnce(ONLINE);
    const { connectivity, seen } = createAdapter();
    const reachability: string[] = [];
    connectivity.subscribeReachability((next) => reachability.push(next));
    await flushMicrotasks();
    lastListener()(UNVALIDATED);

    expect([
      connectivity.isOnline(),
      connectivity.reachability(),
      seen,
      reachability,
    ]).toStrictEqual([true, 'unvalidated', [true], ['reachable', 'unvalidated']]);
  });

  it('treats a missing isInternetReachable as reachable', async () => {
    network.getNetworkStateAsync.mockResolvedValueOnce({ isConnected: true });
    const { connectivity } = createAdapter();
    await flushMicrotasks();

    expect([connectivity.isOnline(), connectivity.reachability()]).toStrictEqual([
      true,
      'reachable',
    ]);
  });

  it('subscribes to the OS once, however many listeners join and leave', () => {
    network.getNetworkStateAsync.mockResolvedValueOnce(ONLINE);
    const connectivity = createExpoNetworkConnectivityAdapter({ errorLog: createFakeErrorLog() });
    const unsubscribe = connectivity.subscribe(() => undefined);
    unsubscribe();
    connectivity.subscribe(() => undefined);
    connectivity.subscribeReachability(() => undefined)();

    expect(network.addNetworkStateListener).toHaveBeenCalledTimes(1);
  });

  it('records a failed first read and stays offline', async () => {
    const failure = new Error('no network permission');
    network.getNetworkStateAsync.mockRejectedValueOnce(failure);
    const { connectivity, seen, errorLog } = createAdapter();
    await flushMicrotasks();

    expect([connectivity.isOnline(), connectivity.reachability(), seen]).toStrictEqual([
      false,
      'none',
      [],
    ]);
    expect(errorLog.recorded.map((entry) => [entry.source, entry.error])).toStrictEqual([
      ['network', failure],
    ]);
  });

  it('keeps a listener event that arrived before the first read answered', async () => {
    let answerFirstRead: (state: NetworkState) => void = () => undefined;
    network.getNetworkStateAsync.mockReturnValueOnce(
      new Promise<NetworkState>((resolve) => {
        answerFirstRead = resolve;
      }),
    );
    const { connectivity, seen } = createAdapter();
    lastListener()(ONLINE);
    answerFirstRead(OFFLINE);
    await flushMicrotasks();

    expect([connectivity.isOnline(), seen]).toStrictEqual([true, [true]]);
  });

  it('calls listeners only when the value changes', async () => {
    network.getNetworkStateAsync.mockResolvedValueOnce(ONLINE);
    const { seen } = createAdapter();
    await flushMicrotasks();
    lastListener()(ONLINE);
    lastListener()(OFFLINE);
    lastListener()(OFFLINE);

    expect(seen).toStrictEqual([true, false]);
  });

  it('stops calling a listener after it unsubscribes', () => {
    network.getNetworkStateAsync.mockResolvedValueOnce(OFFLINE);
    const connectivity = createExpoNetworkConnectivityAdapter({ errorLog: createFakeErrorLog() });
    const seen: unknown[] = [];
    const unsubscribe = connectivity.subscribe((isOnline) => seen.push(isOnline));
    const unsubscribeReachability = connectivity.subscribeReachability((next) => seen.push(next));
    unsubscribe();
    unsubscribeReachability();
    lastListener()(ONLINE);

    expect([connectivity.isOnline(), seen]).toStrictEqual([true, []]);
  });
});
