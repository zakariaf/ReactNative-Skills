// src/services/ads/fullscreen-ad.test.ts — media is suspended around every fullscreen ad and resumed
// in finally; the gate tells its subscribers.
import { createFullscreenAdGate, runFullscreenAd } from './fullscreen-ad';

import type { MediaLifecycle } from './fullscreen-ad';

function recordingLifecycle(): { readonly lifecycle: MediaLifecycle; readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    lifecycle: {
      suspend: (reason) => calls.push(`suspend:${reason}`),
      resume: (reason) => calls.push(`resume:${reason}`),
    },
  };
}

describe('runFullscreenAd', () => {
  it('pauses media around the ad and returns its result', async () => {
    const { lifecycle, calls } = recordingLifecycle();

    await expect(
      runFullscreenAd(lifecycle, () => {
        calls.push('show');
        return Promise.resolve('shown');
      }),
    ).resolves.toBe('shown');
    expect(calls).toStrictEqual(['suspend:fullscreen-ad', 'show', 'resume:fullscreen-ad']);
  });

  it('resumes media even when the ad fails', async () => {
    const { lifecycle, calls } = recordingLifecycle();

    await expect(
      runFullscreenAd(lifecycle, () => Promise.reject(new Error('no fill'))),
    ).rejects.toThrow('no fill');
    expect(calls).toStrictEqual(['suspend:fullscreen-ad', 'resume:fullscreen-ad']);
  });
});

describe('createFullscreenAdGate', () => {
  it('shows while an ad runs and tells subscribers each change once', async () => {
    const gate = createFullscreenAdGate();
    const heard: boolean[] = [];
    const stop = gate.subscribe(() => heard.push(gate.isShowing()));

    await runFullscreenAd(gate, () => {
      heard.push(gate.isShowing());
      return Promise.resolve('shown');
    });
    gate.resume('fullscreen-ad');
    stop();
    gate.suspend('fullscreen-ad');

    expect(heard).toStrictEqual([true, true, false]);
  });
});
