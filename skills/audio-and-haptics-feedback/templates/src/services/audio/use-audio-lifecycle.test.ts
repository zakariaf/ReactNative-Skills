// src/services/audio/use-audio-lifecycle.test.ts
// no-providers: the lifecycle hook takes the audio port and the interruption flag as arguments.
import { renderHook } from '@testing-library/react-native';

import { flushMicrotasks } from '@test/flush-microtasks';

import { createFakeAudio } from './fake-audio';
import { useAudioLifecycle } from './use-audio-lifecycle';

import type { FakeAudio } from './fake-audio';

// The foreground check is replaced by a switch the test flips (AppState is not driven in Jest).
jest.mock('@/hooks/use-is-app-active', () => {
  const appState = { isActive: true };
  return { appState, useIsAppActive: () => appState.isActive };
});

const { appState } = jest.requireMock<{ appState: { isActive: boolean } }>(
  '@/hooks/use-is-app-active',
);

type Props = { readonly isInterrupted: boolean };

async function mountLifecycle(audio: FakeAudio) {
  const reportError = jest.fn();
  const { rerender } = await renderHook(
    (props: Props) => {
      useAudioLifecycle({ audio, reportError, ...props });
    },
    { initialProps: { isInterrupted: false } },
  );
  return { rerender, reportError };
}

describe('useAudioLifecycle', () => {
  beforeEach(() => {
    appState.isActive = true;
  });

  it('suspends the context while something full-screen plays and resumes it afterwards', async () => {
    const audio = createFakeAudio();
    const { rerender, reportError } = await mountLifecycle(audio);
    await rerender({ isInterrupted: true });
    await rerender({ isInterrupted: false });
    expect(audio.calls.map((call) => call.kind)).toStrictEqual(['resume', 'suspend', 'resume']);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('suspends the context when the app leaves the foreground', async () => {
    const audio = createFakeAudio();
    const { rerender } = await mountLifecycle(audio);
    appState.isActive = false;
    await rerender({ isInterrupted: false });
    expect(audio.calls.map((call) => call.kind)).toStrictEqual(['resume', 'suspend']);
  });

  it('reports a failed suspend instead of throwing into the UI', async () => {
    const audio = { ...createFakeAudio(), suspend: () => Promise.reject(new Error('busy')) };
    const reportError = jest.fn();
    await renderHook(() => {
      useAudioLifecycle({ audio, reportError, isInterrupted: true });
    });
    await flushMicrotasks();
    expect(reportError).toHaveBeenCalledWith(new Error('busy'));
  });
});
