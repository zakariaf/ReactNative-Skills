// src/core/push/registration-plan.ts
// Decides what one sync of the push registration does: register (again), unregister, or nothing.
// It runs at launch, when the app returns to the foreground, when the token rotates and when the
// account changes, so it must be cheap to call often and never register the same thing twice in a
// row. Pure: time and every fact arrive as values. The last accepted registration is saved between
// launches (PushRecordPort), so a launch after notifications were switched off in Settings still
// knows which token to unregister: Android ends the process when a permission is revoked, and iOS
// often ends a backgrounded app while the person is in Settings.
import * as v from 'valibot';

import { attempt } from '@/core/result';

/** Re-send an unchanged registration after this long, so the server's last-seen time stays fresh. */
export const REREGISTER_AFTER_MS = 24 * 60 * 60 * 1000;

/** What the server last accepted from this device (saved between launches). */
export type RegisteredRecord = {
  readonly token: string;
  readonly accountId: string | null;
  /** The language the server writes this device's notifications in. */
  readonly language: string;
  readonly atMs: number;
};

const registeredRecordSchema = v.object({
  token: v.pipe(v.string(), v.minLength(1)),
  accountId: v.nullable(v.string()),
  language: v.pipe(v.string(), v.minLength(1)),
  atMs: v.pipe(v.number(), v.finite()),
});

/** The saved form of a record. */
export function encodeRegisteredRecord(record: RegisteredRecord): string {
  return JSON.stringify(record);
}

/**
 * Reads a saved record back. Damaged text or an older shape reads as null: the next sync then
 * registers again, which the server's idempotent upsert absorbs.
 */
export function decodeRegisteredRecord(text: string): RegisteredRecord | null {
  const json = attempt(
    (): unknown => JSON.parse(text),
    () => null,
  );
  if (!json.ok) return null;
  const parsed = v.safeParse(registeredRecordSchema, json.value);
  return parsed.success ? parsed.output : null;
}

/** Everything one sync knows. */
export type RegistrationFacts = {
  /** The notification permission allows delivery (granted or provisional). */
  readonly isAllowed: boolean;
  /** The current token, or null when none could be fetched. */
  readonly token: string | null;
  /** The signed-in account, or null when signed out (or the app has no accounts). */
  readonly accountId: string | null;
  /** True when the server accepts only registrations of a signed-in account. */
  readonly requiresAccount: boolean;
  /** The app's language now: a change registers again, so notifications follow it. */
  readonly language: string;
  readonly last: RegisteredRecord | null;
  readonly nowMs: number;
};

export type RegistrationStep =
  | { readonly kind: 'register'; readonly token: string; readonly previousToken: string | null }
  | { readonly kind: 'unregister'; readonly token: string }
  | {
      readonly kind: 'none';
      readonly reason: 'not-allowed' | 'signed-out' | 'no-token' | 'up-to-date';
    };

function isUpToDate(facts: RegistrationFacts, token: string): boolean {
  const { last } = facts;
  return (
    last !== null &&
    last.token === token &&
    last.accountId === facts.accountId &&
    last.language === facts.language &&
    facts.nowMs >= last.atMs &&
    facts.nowMs - last.atMs < REREGISTER_AFTER_MS
  );
}

/**
 * The step for these facts. Notifications switched off in Settings unregister the saved record (from
 * this launch or an earlier one), so the server stops sending into the void; a new token, account or
 * language registers again, and so does a record older than a day (or dated in the future, after the
 * clock was set back).
 */
export function planRegistration(facts: RegistrationFacts): RegistrationStep {
  const { last } = facts;
  if (!facts.isAllowed) {
    return last === null
      ? { kind: 'none', reason: 'not-allowed' }
      : { kind: 'unregister', token: last.token };
  }
  if (facts.requiresAccount && facts.accountId === null)
    return { kind: 'none', reason: 'signed-out' };
  if (facts.token === null) return { kind: 'none', reason: 'no-token' };
  if (isUpToDate(facts, facts.token)) return { kind: 'none', reason: 'up-to-date' };
  const previousToken = last !== null && last.token !== facts.token ? last.token : null;
  return { kind: 'register', token: facts.token, previousToken };
}
