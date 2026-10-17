// src/services/audio/use-audio-lifecycle.ts
import { useEffect, useEffectEvent } from 'react';

import { useIsAppActive } from '@/hooks/use-is-app-active';

import type { AudioPort } from './audio-port';

export type AudioLifecycleInput = {
  readonly audio: AudioPort;
  /** True while something full-screen plays its own sound (a video, an interstitial ad). */
  readonly isInterrupted: boolean;
  /** `(error) => { errorLog.record('service', error); }`: a failed suspend or resume is logged. */
  readonly reportError: (error: unknown) => void;
};

/** Mounted once, in the root layout: the context runs only while the app is in front. */
export function useAudioLifecycle(input: AudioLifecycleInput): void {
  const isAudible = useIsAppActive() && !input.isInterrupted;
  const apply = useEffectEvent((isOn: boolean) => {
    const change = isOn ? input.audio.resume() : input.audio.suspend();
    change.catch(input.reportError);
  });
  useEffect(() => {
    apply(isAudible);
  }, [isAudible]);
}
