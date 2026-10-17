// src/services/share-sheet/fake-share-sheet.ts: a ShareSheetPort that records each request, for tests.
import { err, ok } from '@/core/result';

import type {
  ShareFailure,
  ShareRequest,
  ShareSheetPort,
} from '@/services/share-sheet/share-sheet-port';

export type FakeShareSheet = ShareSheetPort & {
  /** Every request, oldest first. */
  readonly requests: readonly ShareRequest[];
  /** The next shareFile fails with this failure, once. */
  readonly failNext: (failure: ShareFailure) => void;
};

export function createFakeShareSheet(): FakeShareSheet {
  const requests: ShareRequest[] = [];
  let nextFailure: ShareFailure | null = null;
  return {
    requests,
    failNext: (failure) => {
      nextFailure = failure;
    },
    shareFile: (request) => {
      requests.push(request);
      const failure = nextFailure;
      nextFailure = null;
      return Promise.resolve(failure === null ? ok('sheet-closed' as const) : err(failure));
    },
  };
}
