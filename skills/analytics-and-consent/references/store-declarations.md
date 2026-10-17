# Store declarations that match what analytics collects

`contracts/analytics.json` `collects` is the one source. `scripts/analytics/analytics-manifest.ts`
turns it into the iOS privacy manifest entries (app.config.ts) and the Google Play Data safety rows;
check-analytics `declarations` proves it covers what the catalog, the SDK and the identity setting
imply. privacy-and-store-declarations owns the whole manifest, the SDK inventory and the release
audit; this skill owns the analytics rows, which it adds to that manifest and copies into the
privacy contract (one source, two copies the checker keeps equal).

## Contents

- Apple: App Privacy answers
- Apple: the privacy manifest of a JavaScript SDK
- Google Play: Data safety
- One source: the privacy contract copy
- The mapping table
- What check-analytics requires
- When the answers change
- The privacy policy

## Apple: App Privacy answers

From Apple's App Privacy Details page (read 2026-10-14):

- **Collect** means "transmitting data off the device in a way that allows you and/or your
  third-party partners to access it for a period longer than what is necessary to service the
  transmitted request in real time." Analytics events are collected.
- Third-party partners include "analytics tools ... third-party SDKs": their collection is the
  app's to declare.
- **Linked to the user**: "Data collected from an app is often linked to the user's identity, unless
  specific privacy protections are put in place before collection to de-identify or anonymize it",
  and "'Personal Information' and 'Personal Data', as defined under relevant privacy laws, are
  considered linked to the user." Events sent with a persisted install id are pseudonymous personal
  data under the GDPR, so the template declares `linked: true` for `product-interaction` and
  `device-id`. Declaring "not linked" needs the developer's privacy review and real de-identification
  (no persisted id, for example an SDK in memory-only persistence).
- **Opt-in does not exempt.** "Data collected on an ongoing basis after an initial request for
  permission must be disclosed." The "Product Improvement Programs" optional-disclosure exception
  needs, among other things, data that is "not linked to the user's identity (via their account,
  device, or other details)", which a persisted install id breaks. The default is to declare.
- **Tracking** has Apple's meaning (att-and-tracking.md); product analytics says no.

The usual analytics answers (default profile):

| Data type | Linked | Tracking | Purpose |
|---|---|---|---|
| Usage Data > Product Interaction | yes | no | Analytics |
| Identifiers > Device ID | yes | no | Analytics |
| Location > Coarse Location (only if the vendor derives location from the IP and the adapter does not switch it off) | yes | no | Analytics |
| Identifiers > User ID (only with `identifies: true`) | yes | no | Analytics |

## Apple: the privacy manifest of a JavaScript SDK

Apple: "Third-party SDKs need to provide their own privacy manifest files that record the types of
data they collect. Your app's privacy manifest file doesn't need to cover data collected by
third-party SDKs that your app links to." That works for native SDKs that ship a
`PrivacyInfo.xcprivacy`. posthog-react-native sends its events from JavaScript (`fetch` in
`@posthog/core`) and ships no native manifest for them, so Xcode's privacy report would show nothing
for analytics. The app's own manifest declares the analytics data instead:

```ts
// app.config.ts (examples/app-config-analytics.ts)
ios: {
  privacyManifests: {
    ...PRIVACY_MANIFESTS, // privacy-and-store-declarations: required-reason APIs, NSPrivacyTracking
    NSPrivacyCollectedDataTypes: [...analyticsCollectedDataTypes(projectRoot)],
  },
},
```

Never write the analytics entries instead of `PRIVACY_MANIFESTS`: an inline object without
`NSPrivacyAccessedAPITypes` drops the required-reason APIs and App Store Connect rejects the upload
(ITMS-91053). `analyticsCollectedDataTypes` reads the contract from disk, so it stays in
`app.config.ts` (Node), not in the pure `src/config/privacy-manifest.ts`. Before the app has
`src/config/privacy-manifest.ts`, write the object without the spread and add it when
privacy-and-store-declarations lands; from then on `manifest-wiring` requires the spread.
privacy-and-store-declarations' `audit-repo.mjs` `privacy-manifest` rule accepts the same spread form
(`{ ...PRIVACY_MANIFESTS, NSPrivacyCollectedDataTypes: [...] }`), so both checkers pass on one
`app.config.ts`; crash-reporting-and-observability adds its rows beside the spread the same way.

Expo's `ios.privacyManifests` accepts `NSPrivacyCollectedDataTypes` entries with
`NSPrivacyCollectedDataType`, `NSPrivacyCollectedDataTypeLinked`, `NSPrivacyCollectedDataTypeTracking`
and `NSPrivacyCollectedDataTypePurposes` (`@expo/config-types` for SDK 57, read 2026-10-14). The
values must be Apple's identifiers: "Xcode won't generate a privacy report correctly if you define
your own collected data types". Generate the privacy report from an archive (Organizer > Generate
Privacy Report) before filling App Store Connect.

## Google Play: Data safety

From Play Console Help, "Provide information for Google Play's Data safety section" (read 2026-10-14):

- **Collection** is "transmitting data from your app off a user's device"; data handled by
  third-party libraries or SDKs must be reflected in the form.
- **Sharing** is a transfer to a third party, except to a **service provider** processing on the
  developer's behalf and instructions, which is how an analytics vendor under a data processing
  agreement is answered (collected, not shared). A vendor that uses the data for its own purposes is
  sharing.
- **Optional**: the form may call collection optional only if every user, in every region, can opt in
  or out: the opt-in gate makes analytics optional.
- **Encrypted in transit**: yes (HTTPS; `endpoints` must be https).
- **Deletion requests**: say how (the forget call plus the vendor's deletion request; see consent-gate.md).
- Ephemeral processing does not apply: analytics builds profiles over time.

`dataSafetyRows(collects)` prints the rows; the data types map to Play's categories below.

## One source: the privacy contract copy

privacy-and-store-declarations keeps every network SDK's collected data in `contracts/privacy.json`
`sdks` and prints the whole app's store answers from it. For the analytics SDK,
`contracts/analytics.json` `collects` is the source and the privacy contract holds a copy: whenever
`collects` changes, copy each entry into `sdks["<sdk>"].collects` in the same commit:

```json
"posthog-react-native": {
  "why": "Product analytics after the user agreed (contracts/analytics.json is the source).",
  "tracking": false,
  "collects": [
    { "type": "product-interaction", "linked": true, "tracking": false, "purposes": ["analytics"], "optional": true },
    { "type": "device-id", "linked": true, "tracking": false, "purposes": ["analytics"], "optional": true }
  ]
}
```

`dataType` becomes `type`, `why` stays in the analytics contract, and `optional: true` says the user
can decline (it is consent-gated). check-analytics `privacy-sync` compares the two sets (type,
linked, tracking, purposes, and the SDK's `tracking`) and fails on any difference; before the app has
`contracts/privacy.json` it prints `SKIP contracts/privacy.json [privacy-sync] not yet created
(privacy-and-store-declarations creates it)`.

## The mapping table

| `dataType` | Apple identifier | Play data type |
|---|---|---|
| `product-interaction` | `NSPrivacyCollectedDataTypeProductInteraction` | App activity > App interactions |
| `other-usage-data` | `NSPrivacyCollectedDataTypeOtherUsageData` | App activity > Other actions |
| `search-history` | `NSPrivacyCollectedDataTypeSearchHistory` | App activity > In-app search history |
| `device-id` | `NSPrivacyCollectedDataTypeDeviceID` | Device or other IDs > Device or other IDs |
| `user-id` | `NSPrivacyCollectedDataTypeUserID` | Personal info > User IDs |
| `coarse-location` | `NSPrivacyCollectedDataTypeCoarseLocation` | Location > Approximate location |

The Play labels are the ones privacy-and-store-declarations prints (it owns the store answers), so
both skills' scripts give the same Data safety rows. Crash, performance and other diagnostic data
are not product analytics and are not `collects` types here: the crash reporter declares them
(crash-reporting-and-observability), and an analytics SDK whose error or performance capture is on
fails `sdk-options` instead.

| `purposes` | Apple | Play |
|---|---|---|
| `analytics` | `NSPrivacyCollectedDataTypePurposeAnalytics` | Analytics |
| `app-functionality` | `NSPrivacyCollectedDataTypePurposeAppFunctionality` | App functionality |
| `product-personalization` | `NSPrivacyCollectedDataTypePurposeProductPersonalization` | Personalization |
| `developer-advertising` | `NSPrivacyCollectedDataTypePurposeDeveloperAdvertising` | Advertising or marketing |
| `third-party-advertising` | `NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising` | Advertising or marketing |

Apple identifiers verified against Apple's NSPrivacyCollectedDataType and
NSPrivacyCollectedDataTypePurposes pages (2026-10-14; note the odd casing of
`NSPrivacyCollectedDataTypePhotosorVideos`, not used here). Re-verify:
`curl -s https://developer.apple.com/tutorials/data/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype.json | grep -o 'NSPrivacyCollectedDataType[A-Z][A-Za-z]*' | sort -u`.

## What check-analytics requires

`declarations` fails when `collects` lacks:

- `product-interaction` while the catalog has events;
- `device-id` while the SDK saves an install id (facts: `persistsInstallId`);
- `user-id` while `identifies` is true (and then every entry must be `linked: true`);
- `coarse-location` while the SDK derives a location from the IP and the adapter does not switch it
  off (PostHog: `disableGeoip: true`; vendors without a known switch must declare it).

`tracking` fails a `tracking: true` entry in the default profile; `manifest-wiring` fails an
`app.config.ts` whose `NSPrivacyCollectedDataTypes` does not come from `analyticsCollectedDataTypes()`
or, once `src/config/privacy-manifest.ts` exists, whose `privacyManifests` does not spread
`PRIVACY_MANIFESTS`; `privacy-sync` fails a privacy-contract copy that differs from `collects`;
check-analytics-behaviour `manifest-mapping` proves the mapping script keeps every value.

## When the answers change

Any change to `collects`, `sdk` or `endpoints`: raise `ANALYTICS_CONSENT_VERSION`, copy `collects`
into `contracts/privacy.json`, rebuild (the
manifest is native config: a new binary, not an OTA update), update App Store Connect (App Privacy)
and Play Console (Data safety) before that release is submitted. The store forms are the developer's
accounts: give them the rows (`dataSafetyRows`, the Apple table) and let them submit; never claim the
forms are updated.

## The privacy policy

Guideline 5.1.1(i): the privacy policy, linked in App Store Connect and inside the app, must
"identify what data, if any, the app/service collects, how it collects that data, and all uses of
that data." Play requires a policy link too. Give the developer the vendor's name, the region
(`endpoints`), the data types, the purposes, the retention the vendor project is set to, and the
withdrawal path, for their policy; the wording is theirs.
