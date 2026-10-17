// src/services/consent/consent-factory.test.ts — an ADS_MODE=off build never asks Google's UMP (a
// network request) nor Apple's tracking prompt, and never even creates the AdMob adapter; test and
// live builds use the adapter the composition root hands in.
import { createConsentPort } from './consent-factory';
import { createFakeConsent } from './fake-consent';

const NO_ADS = { canRequestAds: false, isPrivacyOptionsRequired: false };
const ALLOWED = { canRequestAds: true, isPrivacyOptionsRequired: false };

describe('createConsentPort', () => {
  it('answers without any SDK in an ADS_MODE=off build', async () => {
    const createAdmob = jest.fn(() =>
      createFakeConsent({ afterRefresh: ALLOWED, afterForm: ALLOWED }),
    );
    const consent = createConsentPort('off', createAdmob);

    await expect(consent.refresh()).resolves.toStrictEqual(NO_ADS);
    await expect(consent.showFormIfRequired()).resolves.toStrictEqual(NO_ADS);
    await expect(consent.showPrivacyOptions()).resolves.toStrictEqual(NO_ADS);
    expect(createAdmob).not.toHaveBeenCalled();
  });

  it('shows no tracking prompt in an ADS_MODE=off build (every E2E build)', async () => {
    await expect(createConsentPort('off', jest.fn()).requestTracking()).resolves.toBe(
      'unavailable',
    );
  });

  it.each(['test', 'live'] as const)(
    'uses the AdMob adapter in an ADS_MODE=%s build',
    async (adsMode) => {
      const admob = createFakeConsent({ afterRefresh: ALLOWED, afterForm: ALLOWED });
      const consent = createConsentPort(adsMode, () => admob);

      await expect(consent.refresh()).resolves.toStrictEqual(ALLOWED);
      expect(admob.calls()).toStrictEqual(['refresh']);
    },
  );
});
