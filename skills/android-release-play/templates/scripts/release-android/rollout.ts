// scripts/release-android/rollout.ts
// Staged rollout on the production track. A build reaches production only by promotion of a
// versionCode that was uploaded to a testing track (it has an upload tag), and only in steps: the
// contract's rollout fractions (for example 0.05, 0.2, 0.5, 1), each raise after the reviewer looked
// at the crash-free rate and the reviews. A regression halts the release (users who have it keep
// it; nobody new gets it) and the fix ships under a new versionCode: a halted or rolled-out
// versionCode is never rebuilt.
import type { TrackRelease } from './play-client.ts';

/** The next fraction after `current` (null: not on production yet); throws when already at 1. */
export function nextRolloutFraction(steps: readonly number[], current: number | null): number {
  const next = current === null ? steps[0] : steps.find((step) => step > current);
  if (next === undefined) {
    throw new Error('the release already reaches every user: there is no next rollout step');
  }
  return next;
}

/** A fraction of production users: inProgress below 1, completed at 1. */
export function rolloutRelease(input: {
  readonly versionCode: number;
  readonly fraction: number;
}): TrackRelease {
  const { versionCode, fraction } = input;
  if (!(fraction > 0 && fraction <= 1)) {
    throw new Error(`rollout fraction ${String(fraction)} is not in (0, 1]`);
  }
  const versionCodes = [String(versionCode)];
  return fraction === 1
    ? { versionCodes, status: 'completed' }
    : { versionCodes, status: 'inProgress', userFraction: fraction };
}

/** Stops serving the release to new users; the fraction it reached is kept for the record. */
export function haltRelease(input: {
  readonly versionCode: number;
  readonly fraction: number;
}): TrackRelease {
  return {
    versionCodes: [String(input.versionCode)],
    status: 'halted',
    userFraction: input.fraction,
  };
}

/** Why this versionCode may not be promoted: it was never uploaded (no Android upload tag). */
export function promotionProblems(input: {
  readonly versionCode: number;
  readonly uploadedVersionCodes: readonly number[];
}): string[] {
  return input.uploadedVersionCodes.includes(input.versionCode)
    ? []
    : [
        `versionCode ${String(input.versionCode)} has no upload tag: only a build that went through a testing track is promoted`,
      ];
}
