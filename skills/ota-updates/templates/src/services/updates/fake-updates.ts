// src/services/updates/fake-updates.ts
// An UpdatesPort for tests: answers what the test scripted and records every call in order. By
// default it behaves like a release build with nothing new on the server.
import { ok } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  RunningUpdate,
  UpdateCheck,
  UpdateDownload,
  UpdatesFailure,
  UpdatesPort,
} from '@/services/updates/updates-port';

export type UpdatesCall = 'check' | 'download' | 'apply';

/** The answers the fake gives until the test changes them. */
export type FakeUpdatesAnswers = {
  readonly check: Result<UpdateCheck, UpdatesFailure>;
  readonly download: Result<UpdateDownload, UpdatesFailure>;
  readonly apply: Result<void, UpdatesFailure>;
};

export type FakeUpdates = UpdatesPort & {
  /** Every call, oldest first. */
  readonly calls: readonly UpdatesCall[];
  /** Replaces some answers; the others stay. */
  readonly answer: (next: Partial<FakeUpdatesAnswers>) => void;
};

/** A release build running the bundle embedded in the binary. */
export const EMBEDDED_LAUNCH: RunningUpdate = {
  updateId: null,
  channel: 'production',
  runtimeVersion: 'c771bc775a1159b784a37f8698e0a8b7fd6e5ecc',
  isEmbeddedLaunch: true,
  isEmergencyLaunch: false,
  emergencyLaunchReason: null,
};

const NOTHING_NEW: FakeUpdatesAnswers = {
  check: ok('none'),
  download: ok('nothing-new'),
  apply: ok(undefined),
};

export function createFakeUpdates(
  running: Partial<RunningUpdate> = {},
  answers: Partial<FakeUpdatesAnswers> = {},
): FakeUpdates {
  const launch: RunningUpdate = { ...EMBEDDED_LAUNCH, ...running };
  const calls: UpdatesCall[] = [];
  let current: FakeUpdatesAnswers = { ...NOTHING_NEW, ...answers };
  return {
    calls,
    answer: (next) => {
      current = { ...current, ...next };
    },
    running: () => launch,
    check: () => {
      calls.push('check');
      return Promise.resolve(current.check);
    },
    download: () => {
      calls.push('download');
      return Promise.resolve(current.download);
    },
    apply: () => {
      calls.push('apply');
      return Promise.resolve(current.apply);
    },
  };
}
