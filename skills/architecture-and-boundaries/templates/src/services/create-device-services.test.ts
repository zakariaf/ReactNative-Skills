// src/services/create-device-services.test.ts
import { createDeviceServices } from './create-device-services';

describe('createDeviceServices', () => {
  it('creates every port of Services', () => {
    const services = createDeviceServices();

    expect(Object.keys(services).sort()).toStrictEqual(['clock', 'directionGuard', 'errorLog']);
  });

  it('wires the error log to the same clock', () => {
    const services = createDeviceServices();
    services.errorLog.record('startup', new Error('probe'));
    const [entry] = services.errorLog.entries();

    expect(entry?.atMs).toBeLessThanOrEqual(services.clock.nowMs());
  });

  it('creates new adapters on each call, so nothing is shared at module level', () => {
    expect(createDeviceServices().errorLog).not.toBe(createDeviceServices().errorLog);
  });
});
