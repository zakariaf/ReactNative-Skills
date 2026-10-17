// src/services/create-device-services.test.ts (example: the composition root's test with the new ports)
// The connectivity adapter reads expo-network at creation, so the test mocks it (Jest's automock,
// read back with a typed requireMock); the environment is a literal, so nothing reads process.env.
import { createDeviceServices } from './create-device-services';

import type { PublicEnvironment } from '@/config/environment';

jest.mock('expo-network');

type MockedNetwork = {
  readonly getNetworkStateAsync: jest.Mock<Promise<{ readonly isConnected: boolean }>>;
};

const network = jest.requireMock<MockedNetwork>('expo-network');
const ENVIRONMENT: PublicEnvironment = { variant: 'development', apiBaseUrl: 'api.tasks.test/v1' };

describe('createDeviceServices', () => {
  beforeEach(() => {
    network.getNetworkStateAsync.mockResolvedValue({ isConnected: true });
  });

  it('creates every port of Services', () => {
    const services = createDeviceServices(ENVIRONMENT);

    expect(Object.keys(services).sort()).toStrictEqual([
      'api',
      'clock',
      'connectivity',
      'directionGuard',
      'errorLog',
    ]);
  });

  it('creates new adapters on each call, so nothing is shared at module level', () => {
    expect(createDeviceServices(ENVIRONMENT).api).not.toBe(createDeviceServices(ENVIRONMENT).api);
  });
});
