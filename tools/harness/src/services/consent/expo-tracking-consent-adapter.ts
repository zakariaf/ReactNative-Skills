// src/services/consent/expo-tracking-consent-adapter.ts
// Owned by the admob-ads-and-consent skill (canonical copy). Apple's App Tracking Transparency
// prompt through expo-tracking-transparency: this file is the only importer of the tracking module.
// The composition root hands it to the AdMob consent adapter as its `tracking` option (general
// audience). A child-directed app deletes this file, passes `tracking: null` and does not install
// expo-tracking-transparency: Kids Category apps do not implement ATT (App Review guideline 1.3).
import {
  getTrackingPermissionsAsync,
  PermissionStatus,
  requestTrackingPermissionsAsync,
} from 'expo-tracking-transparency';
import { AppState, Platform } from 'react-native';

import type { TrackingConsent, TrackingStatus } from './consent-port';
import type { PermissionResponse } from 'expo-tracking-transparency';

/** What the adapter needs. */
export type ExpoTrackingOptions = {
  /** The error log: a failing read is recorded, never shown, and answers 'unavailable'. */
  readonly onError: (error: unknown) => void;
};

// expo-tracking-transparency (SDK 57) reports ATTrackingManager's .restricted as 'denied', exactly
// like a declined prompt, so this adapter never returns 'restricted'; both mean ads without the IDFA.
function toTrackingStatus(response: PermissionResponse): TrackingStatus {
  if (response.status === PermissionStatus.GRANTED) return 'authorized';
  if (response.status === PermissionStatus.DENIED) return 'denied';
  return 'not-determined';
}

// Apple shows the prompt only while the app is active; asked in any other state it answers at once
// without asking, so the request waits for the app to come back.
function whenActive(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      subscription.remove();
      resolve();
    });
  });
}

// ATT exists on iOS only. Android has no such prompt: the user resets or deletes the advertising ID
// in the system settings, and the ads SDK reads what is there.
async function requestTracking(onError: (error: unknown) => void): Promise<TrackingStatus> {
  if (Platform.OS !== 'ios') return 'unavailable';
  try {
    const current = toTrackingStatus(await getTrackingPermissionsAsync());
    if (current !== 'not-determined') return current; // asked before: Apple never asks twice
    await whenActive();
    return toTrackingStatus(await requestTrackingPermissionsAsync());
  } catch (error) {
    onError(error);
    return 'unavailable'; // ads still load, without the IDFA
  }
}

/** Apple's ATT prompt for the ConsentPort (never rejects). */
export function createExpoTrackingConsentAdapter(options: ExpoTrackingOptions): TrackingConsent {
  return { requestTracking: () => requestTracking(options.onError) };
}
