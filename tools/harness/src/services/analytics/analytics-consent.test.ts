// src/services/analytics/analytics-consent.test.ts
import {
  ANALYTICS_CONSENT_VERSION,
  consentStateOf,
  encodeConsentRecord,
  parseConsentRecord,
} from './analytics-consent';

describe('the consent record', () => {
  it('survives a round trip through its text', () => {
    const record = {
      choice: 'denied',
      version: ANALYTICS_CONSENT_VERSION,
      decidedAtMs: 42,
    } as const;
    expect(parseConsentRecord(encodeConsentRecord(record))).toStrictEqual(record);
  });

  it('reads anything malformed as no record', () => {
    for (const text of [
      null,
      '',
      'not json',
      '[]',
      'null',
      '{"choice":"maybe","version":1,"decidedAtMs":1}',
    ]) {
      expect(parseConsentRecord(text)).toBeNull();
    }
    expect(parseConsentRecord('{"choice":"granted","version":-1,"decidedAtMs":1}')).toBeNull();
  });

  it('means unknown without a record or for an older question', () => {
    expect(consentStateOf(null)).toBe('unknown');
    expect(consentStateOf({ choice: 'granted', version: 1, decidedAtMs: 1 }, 2)).toBe('unknown');
    expect(consentStateOf({ choice: 'granted', version: 2, decidedAtMs: 1 }, 2)).toBe('granted');
    expect(consentStateOf({ choice: 'denied', version: 3, decidedAtMs: 1 }, 2)).toBe('denied');
  });
});
