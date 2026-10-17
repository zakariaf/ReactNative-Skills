// src/services/connectivity/reachability-hub.test.ts
import { createReachabilityHub } from './reachability-hub';

describe('createReachabilityHub', () => {
  it('derives online from reachability: only none is offline', () => {
    const hub = createReachabilityHub('none');
    const answers = [hub.port.isOnline()];
    hub.report('unvalidated');
    answers.push(hub.port.isOnline());
    hub.report('reachable');
    answers.push(hub.port.isOnline());

    expect(answers).toStrictEqual([false, true, true]);
  });

  it('tells each kind of listener only about changes of its own value', () => {
    const hub = createReachabilityHub('reachable');
    const online: boolean[] = [];
    const reachability: string[] = [];
    hub.port.subscribe((isOnline) => online.push(isOnline));
    hub.port.subscribeReachability((next) => reachability.push(next));
    hub.report('reachable');
    hub.report('unvalidated');
    hub.report('none');
    hub.report('reachable');

    expect([online, reachability]).toStrictEqual([
      [false, true],
      ['unvalidated', 'none', 'reachable'],
    ]);
  });

  it('counts listeners of both kinds until they unsubscribe', () => {
    const hub = createReachabilityHub('none');
    const unsubscribe = hub.port.subscribe(() => undefined);
    const unsubscribeReachability = hub.port.subscribeReachability(() => undefined);
    const countWhileSubscribed = hub.listenerCount();
    unsubscribe();
    unsubscribeReachability();
    hub.report('reachable');

    expect([countWhileSubscribed, hub.listenerCount()]).toStrictEqual([2, 0]);
  });
});
