# Tracking, ATT, advertising ids and apps for children

## Contents

- What counts as tracking
- The default profile: analytics never tracks
- The tracking profile (attribution and ad measurement)
- Android: the advertising ID
- The privacy manifest's tracking keys
- Apps for children
- Checks

## What counts as tracking

Apple, App Privacy Details (read 2026-10-14): "Tracking refers to linking data collected from your
app about a particular end-user or device, such as a user ID, device ID, or profile, with Third-Party
Data for targeted advertising or advertising measurement purposes, or sharing data collected from
your app about a particular end-user or device with a data broker." It includes "placing a
third-party SDK in your app that combines user data from your app with user data from other
developers' apps to target advertising or measure advertising efficiency, even if you don't use the
SDK for these purposes." Data linked solely on the device, and not sent off it in an identifying
way, is not tracking.

Guideline 5.1.2(i): "You must receive explicit permission from users via the App Tracking
Transparency APIs to track their activity", and the app "may not require users to enable system
functionalities (e.g. ... tracking) in order to access functionality, content, use the app, or receive
monetary or other compensation."

## The default profile: analytics never tracks

Product analytics measures how the app is used, for the developer, with a first-party vendor that
does not combine the data with other apps' data. That is not tracking, so the default contract says
`tracking: false` and:

- no ATT request from analytics (`createAnalytics` gets no `tracking` option; check-analytics
  `tracking`);
- the adapter never reads an advertising identifier (IDFA, AAID/GAID) and never enables an SDK's
  advertising-id collection (check-analytics `tracking` scans for `getAdvertisingId`, `IDFA`,
  `setAdvertiserTrackingEnabled`, ... in the adapter);
- every `collects` entry says `tracking: false`;
- the vendor must not resell or combine the data: that is a contract term to confirm with the
  vendor (PostHog, Amplitude, Mixpanel and Firebase Analytics without Ads linking qualify by their
  terms; an SDK whose terms let it reuse data across apps makes the app a tracker whatever the code
  does). Stop and ask the developer when unsure.

The app's ads may still track (admob-ads-and-consent asks ATT for them); that does not change the
analytics profile.

## The tracking profile (attribution and ad measurement)

An attribution SDK (AppsFlyer, Adjust, Branch) or analytics linked to an ads platform measures
advertising across apps: that is tracking. Then:

1. `contracts/analytics.json`: `tracking: true`; the data types used for it (usually `device-id` and
   `product-interaction`) say `tracking: true`; `endpoints` lists the SDK's hosts.
2. The root-kit registry passes the canonical tracking adapter, never a second import of
   `expo-tracking-transparency`:

   ```ts
   createAnalytics({ ..., tracking: createExpoTrackingConsentAdapter({ onError }) });
   ```

   `expo-tracking-consent-adapter.ts` belongs to admob-ads-and-consent's canonical
   `src/services/consent/` folder (synced into this skill): it asks only while the status is
   not-determined and the app is active, answers `'unavailable'` off iOS, and never rejects. The ESLint
   rule and architecture-and-boundaries allow `expo-tracking-transparency` only in
   `src/services/consent/*-consent-adapter.ts`.
3. The gate asks when it starts the SDK (right after the user's yes to the app's own question, so
   Apple's prompt follows the app's explanation) and creates the adapter with
   `isTrackingAllowed: status === 'authorized'`. The adapter reads the IDFA only then; declined,
   restricted or unavailable still runs analytics, without the identifier. Nothing in the app depends
   on the answer. On a later launch the status is already known and Apple asks nothing.
4. The `expo-tracking-transparency` plugin entry and `NSUserTrackingUsageDescription` in every
   language exist once (admob-ads-and-consent's `att-plugin` rule owns that check when ads are
   installed; i18n-strings-and-catalogs owns the catalogs).
5. App Privacy: the tracking data types are "Used to track you"; the privacy manifest's
   `NSPrivacyTracking` is true only if the app's own code tracks (an attribution SDK normally declares
   its own manifest; privacy-and-store-declarations aggregates).

Known gap: a user who said yes to analytics on an earlier version, before the app adopted the
tracking profile, sees Apple's prompt when the SDK first starts on the new version (often at launch).
Raise `ANALYTICS_CONSENT_VERSION` with the profile change, so the app's own question comes first.

## Android: the advertising ID

Android has no ATT prompt. Apps targeting Android 13 (API 33) and later must declare
`com.google.android.gms.permission.AD_ID` to read the advertising ID; the user can delete it in the
system settings. Product analytics must not add the permission: when an analytics SDK's library
manifest merges it (React Native Firebase's analytics does through the ads-identifier library,
documented by Firebase, not verified here) and nothing else needs it, block it with
`android.blockedPermissions: ['com.google.android.gms.permission.AD_ID']` in `app.config.ts` and
switch off the SDK's ad-id collection (`google_analytics_adid_collection_enabled: false` in
`firebase.json`). An app with AdMob keeps the permission for the ads SDK (general audience).
expo-prebuild-and-config-plugins' native snapshot shows the merged permissions after prebuild.

## The privacy manifest's tracking keys

- `NSPrivacyTracking`: whether the app's own code tracks. Product analytics: false.
- `NSPrivacyTrackingDomains`: the hosts used for tracking. iOS blocks requests to these hosts while
  the user has not allowed tracking (Apple, NSPrivacyTrackingDomains). Never list a product
  analytics host there: analytics would stop for everyone who declined ATT, which is the correct
  behaviour only for a host that is used solely for tracking.

The whole manifest belongs to privacy-and-store-declarations; this skill contributes
`NSPrivacyCollectedDataTypes` (store-declarations.md).

## Apps for children

App Review 1.3 (Kids Category): "Apps in the Kids Category should not include third-party analytics
or third-party advertising. ... In limited cases, third-party analytics may be permitted provided
that the services do not collect or transmit the IDFA or any identifiable information about children
(such as name, date of birth, email address), their location, or their devices." 5.1.4 applies the
same to apps primarily for kids outside the category. Google Play's Families policy allows only SDKs
self-certified for Families.

A persisted install id is device information, so the default rule is strict: a contract with
`audience: 'child-directed'` has `sdk: 'none'`, `tracking: false` and `identifies: false`
(check-analytics `child-directed`). Keeping the port, the catalog and the gate is fine (they send
nothing without a vendor). Before any analytics in an app for children, stop and ask the developer:
it needs their own review of COPPA, GDPR-K and the store policies, and a vendor that documents its
Kids Category practices.

## Checks

check-analytics `tracking` (contract, composition root, adapter and `collects` agree),
`child-directed`, `sdk-import` (only the vendor adapter imports the SDK; `expo-tracking-transparency`
stays with the consent adapter); check-analytics-behaviour `tracking-gate` (no option: never
allowed; denied, restricted or unavailable: not allowed; authorized: allowed).
