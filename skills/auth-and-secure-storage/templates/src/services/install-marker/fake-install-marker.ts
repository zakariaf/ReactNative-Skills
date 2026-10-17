// src/services/install-marker/fake-install-marker.ts
// In-memory InstallMarkerPort for tests: start as a fresh install or a known one, make it fail.
import { err, ok } from '@/core/result';

import type { InstallMarkerPort } from './install-marker-port';

export type FakeInstallMarker = InstallMarkerPort & {
  /** Whether the marker is set now. */
  readonly isSet: () => boolean;
};

export type FakeInstallMarkerOptions = {
  /** false: a fresh install (the default is an install that has started before). */
  readonly isPresent?: boolean;
  readonly isFailing?: boolean;
};

export function createFakeInstallMarker(options: FakeInstallMarkerOptions = {}): FakeInstallMarker {
  let isPresent = options.isPresent ?? true;
  const failure = err({ kind: 'install-marker-unavailable' } as const);
  const change = (willBePresent: boolean) => {
    if (options.isFailing === true) return failure;
    isPresent = willBePresent;
    return ok(undefined);
  };
  return {
    isSet: () => isPresent,
    isPresent: () => (options.isFailing === true ? failure : ok(isPresent)),
    write: () => change(true),
    clear: () => change(false),
  };
}
