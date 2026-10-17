# Store declarations: App Privacy and Data safety

## Contents

- One contract, two forms
- contracts/privacy.json, key by key
- Collected, linked, tracking, shared: the four questions
- Mapping to App Privacy and Data safety
- Facts other skills hand over
- Permissions and their answers
- Account deletion
- The human step
- A worked answer set

## One contract, two forms

App Store Connect asks the "App Privacy" questionnaire and shows it as the privacy label; Play
Console asks the "Data safety" form and shows it on the store page. Both are legal declarations in
the developer's name, both cover the SDKs' collection as well as the app's, and neither has a
reliable API. This skill keeps the facts once, in `contracts/privacy.json`, checks them against the
code, the SDKs and the binaries, and prints both forms' answers:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/audit-repo.mjs . --answers
```

## contracts/privacy.json, key by key

| Key | Holds |
|---|---|
| `profile` | `api-port` (default) or `offline-only` (references/network-layers.md) |
| `networkModules` | extra first-party files that may open connections (api-port only) |
| `linkFiles` | files that may hold URLs the OS opens, besides `src/config` (api-port); the only place for any URL offline-only |
| `sdks` | every network-capable package, with `why`, `pods`, `maven`, `tracking`, `collects` (references/sdk-inventory.md) |
| `app.collects` | what the app's own server receives (empty for offline-only) |
| `permissionAnswers` | one answer per permission kind (below) |
| `accountDeletion` | `null`, or `{ "inApp": "<route file>", "webUrl": "https://..." }` |

The schema ships beside it (`privacy.schema.json`); `audit-repo.mjs` validates the rest (`contract`).
A `collects` row is `{ "type", "linked", "tracking", "purposes", "shared"?, "optional"? }` with a type
and purposes from `assets/data-types.json`.

## Collected, linked, tracking, shared: the four questions

- **Collected** means the data leaves the device and is kept longer than a real-time request needs.
  Data processed only on the device is not collected (Apple and Google agree): photos attached to a
  local task, a reminder scheduled with expo-notifications, a backup the person shares through the
  system share sheet on their own press (data-export-and-restore: plain files, not encrypted by the
  app; say so, never claim encryption the app does not do).
- **Linked** means tied to the person's identity: an account, a user ID, or a device ID joined with
  other data. An ads SDK's Device ID is linked.
- **Tracking** (Apple's term) means joining the app's data with other companies' data for targeted
  advertising or measurement, or sharing it with a data broker. Any tracking needs App Tracking
  Transparency first (admob-ads-and-consent owns the flow) and makes the app's answers say "used to
  track you". The app's own code never tracks (`store-answer` fails an `app.collects` row with
  tracking): tracking belongs to a declared SDK.
- **Shared** (Google's term) means transferred to a third party; a service provider processing data
  for the app (crash reporting under a processing agreement) is not sharing. SDK data the vendor uses
  for its own purposes (ads) is shared.

Never answer "Data Not Collected" while a declared SDK collects anything: Apple builds its privacy
report from the SDKs' manifests, and Google holds the developer responsible for matching the SDKs'
disclosures.

## Mapping to App Privacy and Data safety

`assets/data-types.json` maps each type id to Apple's category and type, the
`NSPrivacyCollectedDataType` constant pods use, and Play's category and type (Apple constants and
Play labels verified 2026-10-14). Where Play has no exact twin the closest type is used: Apple's
"Advertising Data" and "Other Usage Data" become Play's "App activity > Other actions", "Gameplay
Content" becomes "Other user-generated content", "Sensitive Info", "Environment Scanning", "Hands",
"Head" and "Other Data Types" become "Personal info > Other info". Purposes map the same way; Play's
"Developer communications", "Fraud prevention, security, and compliance" and "Account management"
have no Apple purpose and are printed for Data safety only.

Play also has types Apple lacks. `files-and-docs` (Files and docs), `calendar-events` (Calendar) and
`installed-apps` (App activity > Installed apps) are Play-only (`apple: null`): `--answers` prints
their Data safety line and no App Privacy line, so when such data leaves the device add the Apple
type that covers it too (`other-user-content` for files, `other-data` otherwise). Apple asks once
about "Emails or Text Messages" where Play asks twice: `emails-or-messages` prints Play's
"Messages > Emails" and `sms-or-mms` prints "Messages > SMS or MMS"; both answer the same App Privacy
type, and `--answers` merges App Privacy lines by Apple type. Photos and videos work the same way:
`photos-or-videos` (the constant pods use) prints Play's "Photos and videos > Photos", and `videos`
prints "Photos and videos > Videos"; an app that uploads both declares both rows, which answer Apple's
one "Photos or Videos" type. Apple's Performance Data (launch time, hangs, energy) and Other
Diagnostic Data both print Play's "App info and performance > Diagnostics" (Google's definition: the
app's performance on the device, such as battery life, loading time, latency and frame rate, or any
technical diagnostics), and `--answers` merges Data safety lines by Play type too. Play's "Other app
performance data" is left for data no other type covers. crash-reporting-and-observability's
declarations follow this mapping; analytics-and-consent declares no diagnostics types.

Data safety asks the purposes twice, once for collection and once for sharing. `--answers` prints
"collection purposes" from every row of the type and "sharing purposes" from the rows marked
`"shared": true`. It also prints the form's mandatory **security practices**:

- *Data is encrypted in transit*: yes when nothing is collected, or when every URL the app holds
  (`src/config`, `linkFiles`) is https or wss; a plain `http://` URL prints `NO` with its file and
  line, to fix before answering (networking-and-server-state's `cleartext` rule owns the source
  check under api-port).
- *Users can request that their data is deleted*: yes with both paths when `accountDeletion` is set
  (the web link is the one Play shows in the listing); no when `contracts/auth.json` says
  `createsAccounts: false`; "unknown: confirm whether the app has accounts" when the contract shows
  signs of accounts (below) and nothing settles it; otherwise no, with a request to confirm.

## Facts other skills hand over

| From | Fact | Rule |
|---|---|---|
| admob-ads-and-consent | the ads SDK collects Device ID (linked, tracking) and more; the app's manifest keeps `NSPrivacyTracking: false`; Android merges `AD_ID` unless child-directed; a child-directed app ships no ATT text and answers "not used for tracking" | `undeclared-collection`, `att-string`, `android-ad-id` |
| in-app-purchases | no purchase server by default; `allowedApis` in `contracts/in-app-purchases.json` opts into one, which receives the purchase history | `store-answer` |
| push-notifications | the push token is a device identifier sent to the app's server (and to Expo, Apple and Google as processors), for app functionality, linked when `contracts/push.json` `requiresAccount` is true, not tracking | `store-answer` |
| auth-and-secure-storage | an app that creates accounts collects account data and needs in-app deletion (App Store 5.1.1(v)) plus a web link for deletion requests (Google Play); `expo-secure-store` uses only OS encryption | `store-answer` |
| data-export-and-restore | exports leave the device only through the share sheet on the person's press, unencrypted | (an answer: not collected) |
| crash-reporting-and-observability | `contracts/crash-reporting.json` `declarations` is the source (`crash-data`, `other-diagnostic-data`, `performance-data`: the Sentry pod's manifest lists all three even with tracing off); never linked or tracking; its `privacy-sync` rule keeps `sdks["@sentry/react-native"].collects` equal; the Sentry pod's required reasons (UserDefaults `CA92.1`, SystemBootTime `35F9.1`, FileTimestamp `C617.1`); the ingest host is a network SDK call outside the ApiClient port, covered by declaring `@sentry/react-native`; optional when the person can turn reports off | `network-sdk`, `undeclared-collection`, `required-reason` |
| analytics-and-consent | `contracts/analytics.json` `collects` is the source of the analytics SDK's rows; `sdks["<sdk>"].collects` here is a copy (`{ type, linked, tracking, purposes, optional: true }`) that its `privacy-sync` rule keeps equal, so edit the analytics contract first; its `analyticsCollectedDataTypes(projectRoot)` adds those types to `ios.privacyManifests` beside the spread of `PRIVACY_MANIFESTS` (references/privacy-manifest.md) | `network-sdk`, `privacy-sync` (analytics-and-consent), `privacy-manifest` |
| ota-updates | `expo-updates` checks `u.expo.dev` at every cold start and on foreground checks, with the channel, runtime version, platform and EAS client id, no personal data | `network-sdk` |
| media-images-and-files | uploads of photos mean a `photos-or-videos` row (plus `videos` for video uploads); remote images load through expo-image from API data or config URLs only; transfers stay in `src/services/file-transfer/*-adapter.ts` (a `networkModules` entry); images are re-encoded without EXIF. A custom gallery that keeps `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` also needs Play Console's Photo and Video Permissions declaration; a save-only app blocks those permissions instead | `permission-answer`, `network-call` |
| permissions-and-system-prompts | `contracts/permissions.json` lists every runtime permission the app asks (kind, feature, platforms); each kind needs a `permissionAnswers` entry. App Tracking Transparency stays with admob-ads-and-consent | `permission-answer` |
| background-tasks | background processing adds `UIBackgroundModes` processing and expo-task-manager's fetch; App Review notes should say it syncs the user's data through the ApiClient, which the network layers already cover | (an App Review note) |
| local-notifications | local reminders use no network and collect nothing; the body may show the task title on the lock screen | (an answer: not collected) |
| expo-prebuild-and-config-plugins | `contracts/native-config.json`: the purpose strings and Android permissions prebuild writes (not the permissions libraries merge at build time) | `permission-answer` on the built app |

## Permissions and their answers

Every permission kind the app asks for (`contracts/permissions.json`, permissions-and-system-prompts)
and every purpose string or runtime permission the built binary carries needs an answer in
`permissionAnswers`, keyed by kind (`camera`, `photos`, `location`, `notifications`, `storage`, …,
the table in `assets/privacy-facts.json` `permissionKinds`) or by the raw key
(`NSFaceIDUsageDescription`):

- `"not-collected: <why>"` when the data stays on the device ("task photos stay on the device unless
  the person shares them").
- `"collected: <type>[, <type>]"` when it leaves it; each type must have a `collects` row.

This contract answers per kind, for the store forms. The raw Android permission names stay with the
build gates, each for its own question: android-release-play's `contracts/android-release.json`
(which permissions a release bundle may request, and the Play Console declarations such as AD_ID or
READ_MEDIA_*) and android-emulator-build's `contracts/android-emu-build.json` (the APK allow-list).
`audit-app-bundle.mjs` maps every merged permission to its kind through `permissionKinds`, so a
permission those lists allow still needs its answer here; the three never copy each other.

Libraries and the prebuild template merge permissions the app never asks for: Expo's Android template
adds `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` (`android:maxSdkVersion="32"`), `SYSTEM_ALERT_WINDOW` and
`VIBRATE` (expo-template-bare-minimum 57.0.30, read 2026-10-14). Block the ones the app does not use
with `android.blockedPermissions` in `app.config.ts`, or answer them; `audit-app-bundle.mjs` reads
the merged release manifest and fails a permission without an answer.

## Account deletion

When `contracts/auth.json` `createsAccounts` is true: `accountDeletion.inApp` names the route file
that deletes the account inside the app, and `accountDeletion.webUrl` the page where people request
deletion without the app (Play Console asks for it in the Data safety form). The URL is https and
never a placeholder (`example.com`).

Whenever `accountDeletion` is set, `inApp` must exist and `webUrl` must be a real https link, and
when `contracts/auth.json` names `accountDeletionRoute`, `inApp` must be that same route (one screen
deletes the account; both contracts point at it).

Without `contracts/auth.json` (auth-and-secure-storage not adopted yet) the contract still shows
accounts: a declared sign-in SDK (`expo-auth-session`, Google Sign-In) or an installed sign-in package
that is no network SDK (`expo-apple-authentication`, `signInPackages` in the facts) that app code
imports, a row for `account-management`, or a `user-id` row. A sign-in package nothing imports builds
no sign-in (a stack installed ahead of the feature; auth-and-secure-storage's checker is NOT APPLICABLE
then too), so it is no signal; it still needs its `sdks` entry when it is a network SDK. Then `accountDeletion: null` fails `store-answer`: set
both paths, or state `createsAccounts: false` in `contracts/auth.json` when the sign-in keeps no
account (for example, a one-off identity check). An app with sign-in never answers "no account" by
default.

## The human step

Filling in App Store Connect's App Privacy and Play Console's Data safety is a legal declaration in
the developer's name: stop and hand over the printed answers, never submit them. Re-hand them when the
contract changes: a new SDK, a new `collects` row, a new permission answer. Play Console asks one
more question outside Data safety: when the release manifest merges
`com.google.android.gms.permission.AD_ID` (the ads SDK does unless the app is child-directed), the
developer answers App content > Advertising ID (yes, with advertising or analytics) for apps
targeting Android 13 or later; a child-directed app blocks the permission instead. Apple also needs a
privacy policy URL (both stores and AdMob require one); keep it in `src/config` or a `linkFiles`
entry.

## A worked answer set

For the Tasks app in `examples/contracts/privacy.json` (accounts, banner ads, Premium, crash
reporting, opt-in analytics, pushes, OTA updates, photo attachments), as `--answers` prints it. "Ads" is Third-Party Advertising,
Developer's Advertising or Marketing and Analytics on Apple's side (the purposes Google Mobile Ads
13.6.0 names in its manifest), "Advertising or marketing" and "Analytics" on Play's:

| App Privacy | Linked | Tracking | Apple purposes | Data safety |
|---|---|---|---|---|
| Identifiers > Device ID | yes | yes (ads SDK, after ATT) | ads, App Functionality (push token), Analytics (the analytics SDK's anonymous id) | Device or other IDs: collected, shared; Advertising or marketing, Analytics, App functionality |
| Contact Info > Email Address | yes | no | App Functionality | Personal info > Email address: App functionality, Account management |
| Identifiers > User ID | yes | no | App Functionality | Personal info > User IDs |
| User Content > Photos or Videos | yes | no | App Functionality | Photos and videos > Photos (optional; add a `videos` row, and Play's Videos line, if videos are uploaded too) |
| User Content > Other User Content | yes | no | App Functionality | App activity > Other user-generated content |
| Location > Coarse Location | yes | no | ads, App Functionality (UMP) | Location > Approximate location: collected, shared |
| Usage Data > Advertising Data | yes | no | ads | App activity > Other actions: collected, shared |
| Usage Data > Product Interaction | yes | no | ads, App Functionality (UMP), Analytics (the analytics SDK, optional) | App activity > App interactions: collected, shared |
| Diagnostics > Crash Data | no | no | Analytics (ads SDK), App Functionality (Sentry) | App info and performance > Crash logs |
| Diagnostics > Performance Data, Other Diagnostic Data | no | no | ads, App Functionality (UMP, Sentry) | App info and performance > Diagnostics (one line for both) |

Plus: "Does your app contain ads?" yes (Play); Play Console's Advertising ID declaration yes (the
ads SDK merges AD_ID); account deletion in the app and at the web URL.
