// src/services/consent/fake-consent.test.ts — the fake behaves like the port: answers from its
// script, records calls in order, and asks its ATT prompt once, only while not-determined.
import { createFakeConsent } from './fake-consent';

const ALLOWED = { canRequestAds: true, isPrivacyOptionsRequired: true };
const REFUSED = { canRequestAds: false, isPrivacyOptionsRequired: true };

describe('createFakeConsent', () => {
  it('answers from its script and records every call in order', async () => {
    const consent = createFakeConsent({ afterRefresh: REFUSED, afterForm: ALLOWED });

    await expect(consent.refresh()).resolves.toStrictEqual(REFUSED);
    await expect(consent.showFormIfRequired()).resolves.toStrictEqual(ALLOWED);
    await expect(consent.showPrivacyOptions()).resolves.toStrictEqual(ALLOWED);
    await expect(consent.requestTracking()).resolves.toBe('unavailable');

    expect(consent.calls()).toStrictEqual([
      'refresh',
      'showFormIfRequired',
      'showPrivacyOptions',
      'requestTracking',
    ]);
  });

  it('asks once while not-determined, then keeps the answer', async () => {
    const consent = createFakeConsent({
      afterRefresh: ALLOWED,
      afterForm: ALLOWED,
      tracking: 'not-determined',
      trackingAnswer: 'authorized',
    });

    await expect(consent.requestTracking()).resolves.toBe('authorized');
    await expect(consent.requestTracking()).resolves.toBe('authorized');
    expect(consent.trackingPrompts()).toBe(1);
  });

  it('declines by default and never asks an answered status', async () => {
    const asked = createFakeConsent({
      afterRefresh: ALLOWED,
      afterForm: ALLOWED,
      tracking: 'not-determined',
    });
    const answered = createFakeConsent({
      afterRefresh: ALLOWED,
      afterForm: ALLOWED,
      tracking: 'restricted',
    });

    await expect(asked.requestTracking()).resolves.toBe('denied');
    await expect(answered.requestTracking()).resolves.toBe('restricted');
    expect(answered.trackingPrompts()).toBe(0);
  });
});
