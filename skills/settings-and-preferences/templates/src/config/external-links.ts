// src/config/external-links.ts
// Pure: the outbound links the Privacy and About rows hand to the operating system
// (Linking.openURL): the privacy policy page, the store's review page and the mail app. One file,
// so every outbound address is in one reviewable place, and nothing here fetches anything.

export type StoreIds = {
  /** The App Store id (digits); null until the app has a store record. */
  readonly appStoreId: string | null;
  /** The Android application id (package name). */
  readonly androidPackage: string;
};

/**
 * The page where the person writes a review. iOS opens the App Store's write-review sheet; Android
 * opens the Play listing (an https link opens the Play Store app when it is installed and a browser
 * otherwise, where market:// would fail). null on iOS until the app has an App Store id.
 */
export function storeReviewUrl(platform: 'ios' | 'android', ids: StoreIds): string | null {
  if (platform === 'android') {
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(ids.androidPackage)}`;
  }
  return ids.appStoreId === null
    ? null
    : `https://apps.apple.com/app/id${ids.appStoreId}?action=write-review`;
}

/** The mail app with the support address, and the app version in the subject. */
export function supportMailUrl(supportEmail: string, versionText: string): string {
  return `mailto:${supportEmail}?subject=${encodeURIComponent(`Support ${versionText}`)}`;
}

/** The app's public privacy policy page: replace the placeholder; external-links.test.ts pins it. */
export const PRIVACY_POLICY_PAGE = '__PRIVACY_POLICY_URL__';

/**
 * The privacy policy page the Privacy policy row opens (privacyPolicyUrl(PRIVACY_POLICY_PAGE)). Both stores require the link inside the app
 * as well as in the store listing (App Store Review Guideline 5.1.1(i); Google Play's User Data
 * policy), so that row is never hidden. Only a public https page counts: anything else (an
 * unreplaced placeholder, http, a mailto) returns null, which the row records and reports like any
 * failed hand-off.
 */
export function privacyPolicyUrl(pageUrl: string): string | null {
  return /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]\S*)?$/i.test(pageUrl) ? pageUrl : null;
}
