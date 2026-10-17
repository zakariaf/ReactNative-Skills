// src/config/external-links.test.ts
import {
  PRIVACY_POLICY_PAGE,
  privacyPolicyUrl,
  storeReviewUrl,
  supportMailUrl,
} from './external-links';

const IDS = { appStoreId: '1234567890', androidPackage: 'com.acme.tasks' };

describe('storeReviewUrl', () => {
  it('opens the App Store write-review sheet on iOS', () => {
    const url = new URL(storeReviewUrl('ios', IDS) ?? '');

    expect([url.host, url.pathname, url.searchParams.get('action')]).toStrictEqual([
      'apps.apple.com',
      '/app/id1234567890',
      'write-review',
    ]);
  });

  it('opens the Play listing on Android', () => {
    const url = new URL(storeReviewUrl('android', IDS) ?? '');

    expect([url.host, url.pathname, url.searchParams.get('id')]).toStrictEqual([
      'play.google.com',
      '/store/apps/details',
      'com.acme.tasks',
    ]);
  });

  it('returns null on iOS until the app has an App Store id', () => {
    expect(storeReviewUrl('ios', { ...IDS, appStoreId: null })).toBeNull();
  });
});

describe('supportMailUrl', () => {
  it('fills the address and puts the version in the subject', () => {
    const url = new URL(supportMailUrl('help@acme.test', '1.4.0 (52)'));

    expect([url.protocol, url.pathname, url.searchParams.get('subject')]).toStrictEqual([
      'mailto:',
      'help@acme.test',
      'Support 1.4.0 (52)',
    ]);
  });
});

describe('privacyPolicyUrl', () => {
  it("opens the app's own policy page, so a placeholder left in fails here", () => {
    expect(privacyPolicyUrl(PRIVACY_POLICY_PAGE)).toBe(PRIVACY_POLICY_PAGE);
  });

  it('refuses plain http, an address without a scheme and anything that is not a web page', () => {
    const insecure = PRIVACY_POLICY_PAGE.replace(/^https:/, 'http:');
    const inputs = [
      insecure,
      'acme.test/privacy',
      'mailto:help@acme.test',
      'privacy-policy-url',
      '',
    ];

    expect(inputs.map((url) => privacyPolicyUrl(url))).toStrictEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
