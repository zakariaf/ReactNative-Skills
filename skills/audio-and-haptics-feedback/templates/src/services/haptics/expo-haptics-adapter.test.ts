// src/services/haptics/expo-haptics-adapter.test.ts
import {
  ANDROID_CUES_API,
  ANDROID_OUTCOME_CUES_API,
  androidHapticFor,
  createExpoHapticsAdapter,
} from './expo-haptics-adapter';

import type { HapticsDevice } from './expo-haptics-adapter';
import type { HapticCue } from './haptics-port';

// Tests never import the SDK: a factory mock records every native call instead.
jest.mock('expo-haptics', () => {
  const calls: string[] = [];
  const record = (name: string) => (arg?: string) => {
    calls.push(arg === undefined ? name : `${name}:${arg}`);
    return Promise.resolve();
  };
  return {
    calls,
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
    AndroidHaptics: {
      Segment_Tick: 'segment-tick',
      Clock_Tick: 'clock-tick',
      Context_Click: 'context-click',
      Virtual_Key: 'virtual-key',
      Long_Press: 'long-press',
      Confirm: 'confirm',
      Reject: 'reject',
    },
    impactAsync: record('impact'),
    notificationAsync: record('notification'),
    selectionAsync: record('selection'),
    performAndroidHapticsAsync: record('android'),
  };
});

const native = jest.requireMock<{ readonly calls: string[] }>('expo-haptics');

const CUES: readonly HapticCue[] = [
  'selection',
  'light',
  'medium',
  'heavy',
  'success',
  'warning',
  'error',
];
const IPHONE: HapticsDevice = { os: 'ios', isPad: false, apiLevel: 0 };

type Clock = { now: number };

function adapter(clock: Clock, device: HapticsDevice = IPHONE, isEnabled = true) {
  return createExpoHapticsAdapter({ isEnabled: () => isEnabled, nowMs: () => clock.now, device });
}

/** Plays every cue 100 ms apart (past the throttle) and returns the native calls. */
function playAll(device: HapticsDevice): string[] {
  const clock = { now: 0 };
  const haptics = adapter(clock, device);
  for (const cue of CUES) {
    haptics.play(cue);
    clock.now += 100;
  }
  return native.calls;
}

describe('createExpoHapticsAdapter', () => {
  beforeEach(() => {
    native.calls.length = 0;
  });

  it('maps every cue to its iOS feedback generator', () => {
    expect(playAll(IPHONE)).toStrictEqual([
      'selection',
      'impact:light',
      'impact:medium',
      'impact:heavy',
      'notification:success',
      'notification:warning',
      'notification:error',
    ]);
  });

  it('maps every cue to an Android haptic constant on Android 14 and later', () => {
    expect(playAll({ os: 'android', isPad: false, apiLevel: ANDROID_CUES_API })).toStrictEqual([
      'android:segment-tick',
      'android:context-click',
      'android:virtual-key',
      'android:long-press',
      'android:confirm',
      'android:reject',
      'android:reject',
    ]);
  });

  it('drops a pulse closer than 40 ms to the previous one', () => {
    const clock = { now: 1000 };
    const haptics = adapter(clock);
    haptics.play('medium');
    clock.now = 1039;
    haptics.play('medium');
    clock.now = 1040;
    haptics.play('heavy');
    expect(native.calls).toStrictEqual(['impact:medium', 'impact:heavy']);
  });

  it('stays silent while the haptics preference is off', () => {
    adapter({ now: 0 }, IPHONE, false).play('success');
    expect(native.calls).toStrictEqual([]);
  });

  it('reports no support on an iPad and never pulses there', () => {
    const ipad = adapter({ now: 0 }, { os: 'ios', isPad: true, apiLevel: 0 });
    ipad.play('success');
    expect(ipad.isSupported).toBe(false);
    expect(adapter({ now: 0 }).isSupported).toBe(true);
    expect(native.calls).toStrictEqual([]);
  });
});

describe('androidHapticFor', () => {
  it('keeps Confirm and Reject from API 30, where Segment_Tick does not exist yet', () => {
    expect(CUES.map((cue) => androidHapticFor(cue, ANDROID_CUES_API - 1))).toStrictEqual([
      'clock-tick',
      'context-click',
      'virtual-key',
      'long-press',
      'confirm',
      'reject',
      'reject',
    ]);
    expect(androidHapticFor('success', ANDROID_OUTCOME_CUES_API)).toBe('confirm');
  });

  it('uses constants every supported Android level has below API 30', () => {
    expect(CUES.map((cue) => androidHapticFor(cue, ANDROID_OUTCOME_CUES_API - 1))).toStrictEqual([
      'clock-tick',
      'context-click',
      'virtual-key',
      'long-press',
      'context-click',
      'long-press',
      'long-press',
    ]);
  });
});
