// src/hooks/use-is-app-active.ts
// Owned by the react-components-and-hooks skill. A shared cross-feature hook: canvases pause their
// frame clock and audio stops its sources while the app is not in the foreground.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

function subscribe(onChange: () => void): () => void {
  const subscription = AppState.addEventListener('change', onChange);
  return () => {
    subscription.remove();
  };
}

// React Native updates AppState.currentState in a listener it registers before any app listener,
// so the snapshot is already current when onChange runs (react-native 0.86.3, AppState.js).
function isActiveNow(): boolean {
  return AppState.currentState === 'active';
}

// Static web rendering (web.output: 'static') and hydration have no AppState, and React throws
// "Missing getServerSnapshot" without this. A page being rendered is about to be shown: active.
function isActiveOnServer(): boolean {
  return true;
}

/**
 * True while the app is in the foreground ('active'); 'inactive', 'background' and an unknown
 * state are false. iOS reports 'inactive' for the app switcher, Control Center and incoming calls;
 * Android reports only 'active' and 'background'. Reads the OS through useSyncExternalStore: one
 * subscription per mounted hook, no state copy, no effect that sets state.
 */
export function useIsAppActive(): boolean {
  return useSyncExternalStore(subscribe, isActiveNow, isActiveOnServer);
}
