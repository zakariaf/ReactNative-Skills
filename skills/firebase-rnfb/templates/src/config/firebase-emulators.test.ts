// src/config/firebase-emulators.test.ts
import { EMULATOR_PORTS, firebaseEmulators } from './firebase-emulators';

describe('firebaseEmulators', () => {
  it.each(['preview', 'production'] as const)('connects no emulator in a %s build', (variant) => {
    expect(
      firebaseEmulators({ variant, platform: 'ios', hostOverride: '192.168.1.20' }),
    ).toBeNull();
  });

  it('uses loopback on the iOS simulator and 10.0.2.2 on the Android emulator', () => {
    expect(firebaseEmulators({ variant: 'development', platform: 'ios' })).toStrictEqual({
      host: '127.0.0.1',
      ports: EMULATOR_PORTS,
    });
    expect(firebaseEmulators({ variant: 'development', platform: 'android' })?.host).toBe(
      '10.0.2.2',
    );
  });

  it('takes the LAN address a physical device needs, and ignores a blank one', () => {
    expect(
      firebaseEmulators({
        variant: 'development',
        platform: 'android',
        hostOverride: ' 192.168.1.20 ',
      })?.host,
    ).toBe('192.168.1.20');
    expect(
      firebaseEmulators({ variant: 'development', platform: 'ios', hostOverride: '  ' })?.host,
    ).toBe('127.0.0.1');
  });
});
