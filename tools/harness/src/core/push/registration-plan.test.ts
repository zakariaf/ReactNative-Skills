// src/core/push/registration-plan.test.ts
import fc from 'fast-check';

import {
  decodeRegisteredRecord,
  encodeRegisteredRecord,
  planRegistration,
  REREGISTER_AFTER_MS,
} from './registration-plan';

import type { RegisteredRecord, RegistrationFacts } from './registration-plan';

const BASE: RegistrationFacts = {
  isAllowed: true,
  token: 'tok-1',
  accountId: 'acc-1',
  requiresAccount: true,
  language: 'en',
  last: null,
  nowMs: 1_000_000,
};

/** A record the server accepted for BASE's account and language. */
function record(fields: Partial<RegisteredRecord> = {}): RegisteredRecord {
  return { token: 'tok-1', accountId: 'acc-1', language: 'en', atMs: BASE.nowMs, ...fields };
}

describe('planRegistration', () => {
  it('registers a first token', () => {
    expect(planRegistration(BASE)).toStrictEqual({
      kind: 'register',
      token: 'tok-1',
      previousToken: null,
    });
  });

  it('does nothing without the permission when nothing was registered', () => {
    expect(planRegistration({ ...BASE, isAllowed: false })).toStrictEqual({
      kind: 'none',
      reason: 'not-allowed',
    });
  });

  it('unregisters when the permission was switched off after registering', () => {
    const last = record({ atMs: 0 });
    expect(planRegistration({ ...BASE, isAllowed: false, last })).toStrictEqual({
      kind: 'unregister',
      token: 'tok-1',
    });
  });

  it('waits for an account when the server needs one', () => {
    expect(planRegistration({ ...BASE, accountId: null })).toStrictEqual({
      kind: 'none',
      reason: 'signed-out',
    });
  });

  it('registers without an account when the server accepts anonymous devices', () => {
    const facts = { ...BASE, accountId: null, requiresAccount: false };
    expect(planRegistration(facts).kind).toBe('register');
  });

  it('does nothing without a token', () => {
    expect(planRegistration({ ...BASE, token: null })).toStrictEqual({
      kind: 'none',
      reason: 'no-token',
    });
  });

  it('skips an unchanged registration until it is a day old, then sends it again', () => {
    const last = record();
    const fresh = { ...BASE, last, nowMs: BASE.nowMs + REREGISTER_AFTER_MS - 1 };
    const stale = { ...BASE, last, nowMs: BASE.nowMs + REREGISTER_AFTER_MS };
    expect(planRegistration(fresh)).toStrictEqual({ kind: 'none', reason: 'up-to-date' });
    expect(planRegistration(stale).kind).toBe('register');
  });

  it('names the replaced token after a rotation', () => {
    const last = record({ token: 'tok-0' });
    expect(planRegistration({ ...BASE, last })).toStrictEqual({
      kind: 'register',
      token: 'tok-1',
      previousToken: 'tok-0',
    });
  });

  it('registers again for another account', () => {
    const last = record({ accountId: 'acc-0' });
    expect(planRegistration({ ...BASE, last })).toStrictEqual({
      kind: 'register',
      token: 'tok-1',
      previousToken: null,
    });
  });

  it('registers again when the language changed', () => {
    expect(planRegistration({ ...BASE, last: record({ language: 'ar' }) }).kind).toBe('register');
  });

  it('registers again when the record is dated in the future (the clock was set back)', () => {
    const last = record({ atMs: BASE.nowMs + 1 });
    expect(planRegistration({ ...BASE, last }).kind).toBe('register');
  });

  it('returns no register step without the permission, whatever else is true', () => {
    const facts = fc.record({
      token: fc.option(fc.string(), { nil: null }),
      accountId: fc.option(fc.string(), { nil: null }),
      requiresAccount: fc.boolean(),
      language: fc.string(),
      nowMs: fc.nat(),
    });
    fc.assert(
      fc.property(facts, (given) => {
        expect(planRegistration({ ...given, isAllowed: false, last: null }).kind).toBe('none');
      }),
    );
  });
});

describe('decodeRegisteredRecord', () => {
  it('reads back what encodeRegisteredRecord saved', () => {
    const saved = record({ accountId: null });
    expect(decodeRegisteredRecord(encodeRegisteredRecord(saved))).toStrictEqual(saved);
  });

  it.each([
    ['damaged text', '{"token":'],
    ['an older shape without the language', '{"token":"tok-1","accountId":null,"atMs":0}'],
    ['an empty token', '{"token":"","accountId":null,"language":"en","atMs":0}'],
    ['not an object', '42'],
  ])('reads %s as null', (_label, text) => {
    expect(decodeRegisteredRecord(text)).toBeNull();
  });
});
