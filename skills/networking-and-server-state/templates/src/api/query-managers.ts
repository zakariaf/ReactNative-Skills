// src/api/query-managers.ts
// TanStack Query's focus and online managers listen to window events ('visibilitychange',
// 'online', 'offline'). React Native has a `window` without addEventListener, so out of the box
// nothing refetches when the app returns to the foreground, and nothing pauses or resumes when the
// network goes and comes back. This file feeds both managers from React Native instead.
import { focusManager, onlineManager } from '@tanstack/react-query';

import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';

/** The part of React Native's AppState this file reads (AppState itself satisfies it). */
export type AppStateSource = {
  readonly currentState: string | null | undefined;
  readonly addEventListener: (
    type: 'change',
    listener: (state: string) => void,
  ) => { readonly remove: () => void };
};

export type QueryManagerSources = {
  readonly appState: AppStateSource;
  readonly connectivity: ConnectivityPort;
};

/**
 * Focused while the app is 'active'; iOS also reports 'inactive' (app switcher, Control Center,
 * a call), which counts as unfocused, so returning from it refetches stale queries.
 */
function isFocusedState(state: string | null | undefined): boolean {
  return state === 'active';
}

/**
 * Connects the focus manager to AppState and the online manager to the ConnectivityPort, and returns
 * the disconnect, which restores TanStack's defaults. Call it once, from QueryProvider's effect.
 */
export function connectQueryManagers({ appState, connectivity }: QueryManagerSources): () => void {
  focusManager.setEventListener((setFocused) => {
    setFocused(isFocusedState(appState.currentState));
    const subscription = appState.addEventListener('change', (state) => {
      setFocused(isFocusedState(state));
    });
    return () => {
      subscription.remove();
    };
  });
  onlineManager.setEventListener((setOnline) => {
    setOnline(connectivity.isOnline());
    return connectivity.subscribe(setOnline);
  });
  return () => {
    focusManager.setEventListener(() => undefined);
    onlineManager.setEventListener(() => undefined);
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  };
}
