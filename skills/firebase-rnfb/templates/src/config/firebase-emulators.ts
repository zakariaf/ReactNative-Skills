// src/config/firebase-emulators.ts
// Where the Firebase emulators listen, and the one decision that turns them on: only the development
// variant connects to them, so a preview or production build can never write to a laptop. Pure (no
// React Native or Firebase import), so Jest covers every branch; each SDK's adapter connects itself.
import type { AppVariant } from '@/config/app-variant';

/** The emulator suite's default ports (firebase.json `emulators`; keep both in step). */
export const EMULATOR_PORTS = {
  firestore: 8080,
  auth: 9099,
  functions: 5001,
  storage: 9199,
} as const;

/** The host and ports the development build connects to. */
export type FirebaseEmulators = {
  readonly host: string;
  readonly ports: typeof EMULATOR_PORTS;
};

export type FirebaseEmulatorsInput = {
  readonly variant: AppVariant;
  readonly platform: 'ios' | 'android';
  /** A physical device reaches the computer by its LAN address (EXPO_PUBLIC_FIREBASE_EMULATOR_HOST). */
  readonly hostOverride?: string | undefined;
};

/** The host of the computer: the Android emulator sees it as 10.0.2.2, the iOS simulator as loopback. */
function defaultHost(platform: FirebaseEmulatorsInput['platform']): string {
  return platform === 'android' ? '10.0.2.2' : '127.0.0.1';
}

/** The emulators this build connects to, or null for every variant but development. */
export function firebaseEmulators(input: FirebaseEmulatorsInput): FirebaseEmulators | null {
  if (input.variant !== 'development') {
    return null;
  }
  const override = input.hostOverride?.trim() ?? '';
  return { host: override === '' ? defaultHost(input.platform) : override, ports: EMULATOR_PORTS };
}
