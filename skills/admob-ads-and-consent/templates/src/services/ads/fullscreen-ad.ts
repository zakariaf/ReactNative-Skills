// src/services/ads/fullscreen-ad.ts
// A fullscreen ad covers the app, but on iOS it does not background it (AppState stays 'active'), so
// audio, video, timers and animations keep running unless the app pauses them itself. Every
// fullscreen ad runs inside runFullscreenAd with the app's one MediaLifecycle; the gate below is a
// ready-made one that media code subscribes to (useSyncExternalStore). On Android the ad is a
// separate activity, so AppState may change too (not verified on a device); pausing here is right on
// both platforms either way.

/** Why media is suspended. */
export type SuspendReason = 'fullscreen-ad';

/** What the app pauses while a fullscreen ad shows. */
export type MediaLifecycle = {
  readonly suspend: (reason: SuspendReason) => void;
  readonly resume: (reason: SuspendReason) => void;
};

/** A MediaLifecycle that media code reads: isShowing() is true while an ad covers the app. */
export type FullscreenAdGate = MediaLifecycle & {
  readonly isShowing: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
};

/** Runs `show` with media suspended, and resumes in finally: also when the ad fails or throws. */
export async function runFullscreenAd<T>(
  lifecycle: MediaLifecycle,
  show: () => Promise<T>,
): Promise<T> {
  lifecycle.suspend('fullscreen-ad');
  try {
    return await show();
  } finally {
    lifecycle.resume('fullscreen-ad');
  }
}

/** The app's one gate: create it once (composition root) and hand it to every fullscreen ad. */
export function createFullscreenAdGate(): FullscreenAdGate {
  const listeners = new Set<() => void>();
  let isShowing = false;
  const set = (isNowShowing: boolean): void => {
    if (isNowShowing === isShowing) return;
    isShowing = isNowShowing;
    listeners.forEach((listener) => {
      listener();
    });
  };
  return {
    suspend: () => {
      set(true);
    },
    resume: () => {
      set(false);
    },
    isShowing: () => isShowing,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
