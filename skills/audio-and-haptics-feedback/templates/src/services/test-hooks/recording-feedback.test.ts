// src/services/test-hooks/recording-feedback.test.ts
import { createFakeAudio } from '@/services/audio/fake-audio';
import { playUiFeedback } from '@/services/feedback/ui-feedback';
import { createFakeHaptics } from '@/services/haptics/fake-haptics';

import { recordAudioFeedback, recordHapticsFeedback } from './recording-feedback';

import type { FeedbackEntry, FeedbackRecorder } from './recording-feedback';

function recorder(): FeedbackRecorder & { readonly entries: FeedbackEntry[] } {
  const entries: FeedbackEntry[] = [];
  let now = 1_000;
  return {
    entries,
    record: (entry) => {
      entries.push(entry);
    },
    nowMs: () => {
      now += 1;
      return now;
    },
  };
}

describe('recordAudioFeedback', () => {
  it('passes a moment through both ports and records the sound and the pulse', () => {
    const log = recorder();
    const audio = createFakeAudio();
    const haptics = createFakeHaptics();
    playUiFeedback(
      { audio: recordAudioFeedback(audio, log), haptics: recordHapticsFeedback(haptics, log) },
      'toggle',
    );
    expect(audio.calls).toStrictEqual([{ kind: 'play', soundId: 'ui.toggle', delayMs: 0 }]);
    expect(haptics.played).toStrictEqual(['selection']);
    expect(log.entries).toStrictEqual([
      { kind: 'feedback', label: 'ui.toggle', atMs: 1_001, data: { delayMs: 0 } },
      { kind: 'feedback', label: 'selection', atMs: 1_002, data: {} },
    ]);
  });

  it('keeps a timeline cue delay and leaves every other audio call untouched', async () => {
    const log = recorder();
    const audio = createFakeAudio();
    const recorded = recordAudioFeedback(audio, log);
    recorded.play('goal', 120);
    recorded.cancelPending();
    await recorded.suspend();
    expect(audio.calls).toStrictEqual([
      { kind: 'play', soundId: 'goal', delayMs: 120 },
      { kind: 'cancel-pending' },
      { kind: 'suspend' },
    ]);
    expect(log.entries.map((entry) => [entry.label, entry.data])).toStrictEqual([
      ['goal', { delayMs: 120 }],
    ]);
  });
});

describe('recordHapticsFeedback', () => {
  it('keeps whether the device has a haptic engine', () => {
    const log = recorder();
    expect(recordHapticsFeedback(createFakeHaptics(false), log).isSupported).toBe(false);
    expect(recordHapticsFeedback(createFakeHaptics(true), log).isSupported).toBe(true);
  });
});
