# Setup and credentials

Installing push in an Expo SDK 57 app, configuring both platforms per variant, and the credential
steps a person does by hand. Verified on 2026-10-14 (expo-notifications 57.0.21, eas-cli 24.10.0);
re-verify with `npm view expo-notifications@~57.0.21 version` and `npx eas-cli@latest credentials --help`.

## Contents

- 1 Packages
- 2 The app config
- 3 Variants
- 4 Credentials (by hand)
- 5 Contracts
- 6 Store declarations
- 7 What not to do

## 1. Packages

```sh
npx expo install expo-notifications expo-constants
```

`expo-notifications` is the SDK (behind `PushPort`); `expo-constants` gives the EAS project id
(portless: a read-only build fact). `expo-device` is not needed: the adapter reports a simulator or
emulator without push as `token-unavailable` with the native code, and iOS simulators do receive
pushes now. Add `expo-notifications` to `vendorSdks` in `contracts/architecture.json` and to the
ESLint vendor list in the same commit (architecture-and-boundaries).

## 2. The app config

`examples/app.config.ts` shows every push key. In `app.config.ts`:

```ts
android: {
  package: identity.appId,
  googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
},
plugins: [
  ['expo-notifications', {
    mode: APNS_MODE[variant],           // development for the dev client, production otherwise
    icon: './assets/images/notification-icon.png',
    color: '#208AEF',
    defaultChannel: 'general',           // contracts/push.json defaultChannel
  }],
],
extra: { eas: { projectId: '<the id eas init prints>' } },
```

| Option (plugin 57.0.21) | Platform | Meaning |
|---|---|---|
| `icon` | Android | the status-bar icon, 96×96 white on transparent |
| `color` | Android | tint of the icon in the shade (default `#ffffff`) |
| `defaultChannel` | Android | the FCM v1 default channel |
| `sounds` | both | `.wav` files bundled as custom sounds |
| `mode` | iOS | `aps-environment`: `development` (default) or `production` |
| `enableBackgroundRemoteNotifications` | iOS | adds `UIBackgroundModes` `remote-notification` (only for data-only pushes, default false) |

Every option is baked in at prebuild: a change needs a new binary, never an OTA update. After the
change, regenerate the native snapshot (expo-prebuild-and-config-plugins).

## 3. Variants

- Each variant has its own bundle id / package (`com.example.tasks.dev`, `.preview`, store id):
  **each needs its own Android app in the Firebase project**, and `google-services.json` downloaded
  after adding them lists every package; a package missing from it gets no FCM token.
- One APNs key (`.p8`) serves every bundle id of the Apple team; EAS stores it once per account and
  links it to each bundle id when `eas build` or `eas credentials` asks.
- `mode` states the APNs environment each variant ships with: `development` for the development
  client, `production` for preview and production, because TestFlight, ad hoc and App Store builds
  talk to the production APNs (`examples/app.config.ts`, `APNS_MODE`). Expo's docs say Xcode changes
  the entitlement to `production` in a release archive, so distribution export signs with the
  profile's production entitlement anyway: `mode` keeps the config and the native snapshot honest,
  it is not what makes a store build receive pushes (not verified on a device here). A store build
  that gets nothing lacks the Push capability or the APNs key for its bundle id in EAS
  (platform-behaviour.md section 8).
- The EAS project id is the same for every variant (one project); the Expo push token differs per
  bundle id, so a development build and the store app on one phone are two registrations.

## 4. Credentials (by hand)

These steps create or upload keys in outside accounts. An agent stops and asks the developer to do
them; it never creates, downloads, reads or commits a key, and never runs `eas credentials` or
`eas build` against the real project without being asked.

1. **iOS (APNs):** a paid Apple Developer account. During the first `eas build` for iOS, answer yes
   to "set up Push Notifications" and to generating a new APNs key; or run `eas credentials` →
   iOS → the profile → Push Notifications. Revoking an APNs key stops pushes for every app that
   uses it; uploading a new key does not change the users' Expo push tokens (docs).
2. **Android (FCM V1):** create the Firebase project, add every variant's package, download
   `google-services.json` (public identifiers: safe to commit), point `android.googleServicesFile` at
   it. Create a Google service account key for FCM V1 and upload it: `eas credentials` → Android →
   production → Google Service Account → "Manage your Google Service Account Key for Push
   Notifications (FCM V1)" → upload. The service account JSON is a secret: never in the repo (check-push
   `push-credentials`), delete the local copy after the upload.
3. **Enhanced push security:** turn it on in the EAS dashboard and give the server the Expo access
   token through its own secret store. The app never holds it.

## 5. Contracts

- `contracts/push.json` (+ `push.schema.json`) from `templates/contracts/`: fill in `provider`,
  `requiresAccount`, the kinds, the channels and `defaultChannel`; hand it to the server's developer.
- `contracts/auth.json` (auth-and-secure-storage): add `"push-registration"` to
  `serverSignOutSteps` when `requiresAccount` is true.
- `contracts/permissions.json` (permissions-and-system-prompts): a `notifications` entry, without
  `purposeKey` (iOS has no purpose string for notifications), with the explain and settings copy keys
  in every catalog and `askedFrom` = the model that asks from the press (`use-share-list-model.ts`),
  whose sibling test names blocked and declined. Without it, check-permissions reports
  `[contract]`/`[undeclared-permission]` on the push adapter. That skill's asking-flow section 12
  shows the entry.
- `rn-skills.config.json` key `pushContract`: another contract path (check-push reads it).

## 6. Store declarations

Hand these facts to privacy-and-store-declarations, which owns the forms and the privacy manifest:
the push token is a device identifier sent to the app's server (and to Expo, Apple and Google as
processors); it is used for app functionality, linked to the account when `requiresAccount` is true,
not used for tracking. Marketing pushes need an opt-in the person can withdraw in the app.

## 7. What not to do

- No `requestPermissionsAsync` in the root layout "to get it over with".
- No `expo-server-sdk` in the app, no `fetch` to `exp.host/--/api/v2/push/send` from the app.
- No `EXPO_PUBLIC_*` variable holding a push key or access token.
- No `.p8`, `.p12` or service account JSON anywhere in the repo, not even git-ignored in a subfolder
  an agent might read.
- No `useLastNotificationResponse()` in a screen: one router hook below the navigator.
