// src/services/install-marker/install-marker-port.ts
// A flag in the app's own sandbox that says "this install has started before". The iOS Keychain
// outlives an uninstall, so after a reinstall the secure store may still hold the previous install's
// tokens; the sandbox does not survive, so a missing marker means "fresh install: wipe the secrets".
// Synchronous: it is read once at startup, before the session is restored. Adapter:
// kv-install-marker-adapter.ts (expo-sqlite/kv-store). Fake: fake-install-marker.ts.
import type { Result } from '@/core/result';

export type InstallMarkerFailure = { readonly kind: 'install-marker-unavailable' };

/** Never throws: an unexpected failure is recorded by the adapter and returned as a failure. */
export type InstallMarkerPort = {
  /** True once write() succeeded on this install. */
  readonly isPresent: () => Result<boolean, InstallMarkerFailure>;
  readonly write: () => Result<void, InstallMarkerFailure>;
  /** Makes the next launch wipe the secure store again (used when a sign-out wipe failed). */
  readonly clear: () => Result<void, InstallMarkerFailure>;
};
