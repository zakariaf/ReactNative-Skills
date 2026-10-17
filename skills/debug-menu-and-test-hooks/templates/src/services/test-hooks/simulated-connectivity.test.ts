// src/services/test-hooks/simulated-connectivity.test.ts
import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';

import { createSimulatedConnectivity } from './simulated-connectivity';

describe('createSimulatedConnectivity', () => {
  it('forwards the real reachability while not simulating', () => {
    const real = createFakeConnectivity(true);
    const { port } = createSimulatedConnectivity(real, false);
    const heard: boolean[] = [];
    port.subscribe((isOnline) => heard.push(isOnline));

    real.setReachability('unvalidated');
    real.setOnline(false);

    expect(port.reachability()).toBe('none');
    expect(heard).toStrictEqual([false]);
  });

  it('reports none to every reader while offline is simulated, then the real value again', () => {
    const real = createFakeConnectivity(true);
    const simulated = createSimulatedConnectivity(real, false);
    const online: boolean[] = [];
    const reach: string[] = [];
    simulated.port.subscribe((isOnline) => online.push(isOnline));
    simulated.port.subscribeReachability((next) => reach.push(next));

    simulated.setOffline(true);
    real.setReachability('unvalidated');
    simulated.setOffline(false);

    expect(simulated.port.isOnline()).toBe(true);
    expect(online).toStrictEqual([false, true]);
    expect(reach).toStrictEqual(['none', 'unvalidated']);
  });

  it('starts offline when the restored switch says so, and drops unchanged reports', () => {
    const real = createFakeConnectivity(true);
    const simulated = createSimulatedConnectivity(real, true);
    const online: boolean[] = [];
    simulated.port.subscribe((isOnline) => online.push(isOnline));

    simulated.setOffline(true);

    expect(simulated.port.isOnline()).toBe(false);
    expect(online).toStrictEqual([]);
  });

  it('stops following the real adapter', () => {
    const real = createFakeConnectivity(true);
    const simulated = createSimulatedConnectivity(real, false);

    simulated.stop();

    expect(real.listenerCount()).toBe(0);
  });
});
