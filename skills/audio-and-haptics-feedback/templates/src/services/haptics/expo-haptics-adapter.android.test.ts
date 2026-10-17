// src/services/haptics/expo-haptics-adapter.android.test.ts
// Runs in the android Jest project (jest-expo/android): the adapter reads the real Platform.
import {
  androidHapticFor,
  createExpoHapticsAdapter,
  currentHapticsDevice,
} from './expo-haptics-adapter';

jest.mock('expo-haptics', () => {
  const calls: string[] = [];
  const record = (name: string) => (arg?: string) => {
    calls.push(arg === undefined ? name : `${name}:${arg}`);
    return Promise.resolve();
  };
  return {
    calls,
    AndroidHaptics: { Clock_Tick: 'clock-tick', Segment_Tick: 'segment-tick' },
    selectionAsync: record('selection'),
    performAndroidHapticsAsync: record('android'),
  };
});

const native = jest.requireMock<{ readonly calls: string[] }>('expo-haptics');

describe('createExpoHapticsAdapter', () => {
  it('pulses through performAndroidHapticsAsync, never the Vibrator calls', () => {
    const haptics = createExpoHapticsAdapter({ isEnabled: () => true, nowMs: () => 0 });
    haptics.play('selection');
    expect(haptics.isSupported).toBe(true);
    const constant = androidHapticFor('selection', currentHapticsDevice().apiLevel);
    expect(native.calls).toStrictEqual([`android:${constant}`]);
  });
});

describe('currentHapticsDevice', () => {
  it('reads an Android device that is never an iPad', () => {
    expect(currentHapticsDevice()).toMatchObject({ os: 'android', isPad: false });
  });
});
