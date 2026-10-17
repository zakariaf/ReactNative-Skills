// src/services/updates/updates-port.ts
// The app's only view of over-the-air updates (the ota-updates skill). The expo-updates adapter
// implements it; tests use fake-updates.ts. Nothing here rejects: a disabled updater (a development
// build, Expo Go, a build without updates.url) and a failed network call come back as failures.
import type { Result } from '@/core/result';

/** What the running JavaScript is, read once from the native module. */
export type RunningUpdate = {
  /** The update's id, or null for the bundle embedded in the binary and for a disabled updater. */
  readonly updateId: string | null;
  /** The channel baked into this binary at build time; null in development builds. */
  readonly channel: string | null;
  /** The runtime version (the fingerprint) of this binary; null when the updater is disabled. */
  readonly runtimeVersion: string | null;
  readonly isEmbeddedLaunch: boolean;
  /** True when the updater fell back to the embedded bundle after a failure (a broken update). */
  readonly isEmergencyLaunch: boolean;
  readonly emergencyLaunchReason: string | null;
};

/** Why an updater call did nothing. `disabled` is expected outside release builds. */
export type UpdatesFailure =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'check-failed'; readonly message: string }
  | { readonly kind: 'download-failed'; readonly message: string }
  | { readonly kind: 'apply-failed'; readonly message: string };

/** The server's answer for this binary's channel and runtime version. */
export type UpdateCheck = 'none' | 'new-update' | 'roll-back-to-embedded';

/** What a download left on the device: something to run at the next launch, or nothing new. */
export type UpdateDownload = 'ready' | 'nothing-new';

export type UpdatesPort = {
  readonly running: () => RunningUpdate;
  /** Asks the update server; downloads nothing. */
  readonly check: () => Promise<Result<UpdateCheck, UpdatesFailure>>;
  /** Downloads the newest update (or a roll-back directive); it runs at the next cold start. */
  readonly download: () => Promise<Result<UpdateDownload, UpdatesFailure>>;
  /**
   * Restarts the JavaScript on the downloaded update now. Call it only from the person's action
   * (a "Restart to update" button) in a mounted component: nothing after it is guaranteed to run.
   */
  readonly apply: () => Promise<Result<void, UpdatesFailure>>;
};
