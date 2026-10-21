// src/services/app-check/fake-app-check.ts
// Jest only: an AppCheckPort that counts its starts, so a composition test can prove App Check started
// before the first Firestore call.
import { ok } from '@/core/result';

import type { AppCheckPort } from './app-check-port';

export type FakeAppCheck = AppCheckPort & { readonly startCount: () => number };

export function createFakeAppCheck(): FakeAppCheck {
  let starts = 0;
  return {
    start: () => {
      starts += 1;
      return ok(undefined);
    },
    startCount: () => starts,
  };
}
