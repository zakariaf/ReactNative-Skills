// src/services/consent/expo-tracking-consent-adapter.ts
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';

export async function askForTracking(): Promise<boolean> {
  const { granted } = await requestTrackingPermissionsAsync();
  return granted;
}
