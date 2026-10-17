// src/services/connectivity/fake-connectivity.test.ts
import { createFakeConnectivity } from './fake-connectivity';

describe('createFakeConnectivity', () => {
  it('starts in the state the test chose', () => {
    const online = createFakeConnectivity(true);
    const offline = createFakeConnectivity(false);

    expect([
      [online.isOnline(), online.reachability()],
      [offline.isOnline(), offline.reachability()],
    ]).toStrictEqual([
      [true, 'reachable'],
      [false, 'none'],
    ]);
  });

  it('notifies listeners of changes only', () => {
    const connectivity = createFakeConnectivity(true);
    const seen: boolean[] = [];
    connectivity.subscribe((isOnline) => seen.push(isOnline));
    connectivity.setOnline(true);
    connectivity.setOnline(false);
    connectivity.setOnline(true);

    expect(seen).toStrictEqual([false, true]);
  });

  it('counts an unvalidated network as online and reports the reachability change alone', () => {
    const connectivity = createFakeConnectivity(true);
    const online: boolean[] = [];
    const reachability: string[] = [];
    connectivity.subscribe((isOnline) => online.push(isOnline));
    connectivity.subscribeReachability((next) => reachability.push(next));
    connectivity.setReachability('unvalidated');
    connectivity.setReachability('none');

    expect([connectivity.isOnline(), online, reachability]).toStrictEqual([
      false,
      [false],
      ['unvalidated', 'none'],
    ]);
  });

  it('counts listeners until they unsubscribe', () => {
    const connectivity = createFakeConnectivity(false);
    const unsubscribe = connectivity.subscribe(() => undefined);
    const unsubscribeReachability = connectivity.subscribeReachability(() => undefined);
    const countWhileSubscribed = connectivity.listenerCount();
    unsubscribe();
    unsubscribeReachability();

    expect([countWhileSubscribed, connectivity.listenerCount()]).toStrictEqual([2, 0]);
  });
});
