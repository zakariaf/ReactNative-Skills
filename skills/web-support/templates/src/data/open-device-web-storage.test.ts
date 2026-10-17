// src/data/open-device-web-storage.test.ts
import { openDeviceWebStorage } from './open-device-web-storage';

describe('openDeviceWebStorage', () => {
  it('waits for nothing on iOS and Android', () => {
    expect(openDeviceWebStorage()).toBeNull();
  });
});
