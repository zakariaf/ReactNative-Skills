# Emulators, App Check and the start-up order

Where each Firebase piece starts, in which order, and how development builds talk to the local
emulator suite while preview and production builds never can. App Check names and options were read
in the RNFB 26.4.0 typings (`@react-native-firebase/app-check`, `types/appcheck.d.ts`) and its usage
page on 2026-10-21 (re-verify: `npm pack @react-native-firebase/app-check@26.4.0` and read
`dist/typescript/lib/types/appcheck.d.ts`).

## Contents

- The start-up order
- Emulators only in development
- App Check providers per platform and variant
- Debug tokens
- Enforcement is a console switch
- Tests and mocks

## The start-up order

The composition root (architecture-and-boundaries owns it; `examples/create-firebase-services.ts`
shows the Firebase part) runs once, before the first screen reads data:

1. `appCheck.start()`: App Check first, so the first Firestore, Storage or Functions request already
   carries a token. A request sent earlier has none and fails once enforcement is on.
2. `createFirestoreClient(emulators)`: the instance with its settings, then the emulator connection.
3. The auth adapter subscribes to `onAuthStateChanged` and publishes the uid.
4. Per uid, the data adapters (`createFirestoreTaskAdapter({ db, uid, onWriteRejected })`).

Nothing Firebase-related runs at module import time: an import-time call happens before App Check and
again after a JS reload.

## Emulators only in development

`src/config/firebase-emulators.ts` is the one decision: `firebaseEmulators({ variant, platform,
hostOverride })` returns `null` for every variant but `development`, and otherwise the host and the
suite's ports (Firestore 8080, Auth 9099, Functions 5001, Storage 9199: firebase-tools' defaults, keep
`firebase.json` in step). Each SDK's own adapter connects itself when the value is not null:

```ts
if (emulators !== null) connectFirestoreEmulator(db, emulators.host, emulators.ports.firestore);
if (emulators !== null) connectAuthEmulator(auth, `http://${emulators.host}:${String(emulators.ports.auth)}`);
if (emulators !== null) connectFunctionsEmulator(functions, emulators.host, emulators.ports.functions);
if (emulators !== null) connectStorageEmulator(storage, emulators.host, emulators.ports.storage);
```

- **Why the variant and not `__DEV__`:** `__DEV__` is true in any debug build, a debug build of the
  production variant included, and false in a release build of the development variant; the variant
  says which backend a build belongs to (app-variants-and-environment owns `AppVariant`).
- **Hosts:** the iOS simulator reaches the computer at `127.0.0.1`, the Android emulator at `10.0.2.2`
  (RNFB also rewrites `localhost` to it on Android, 2026-10-21); a physical device needs the computer's
  LAN address, given as `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` in the development EAS environment and
  passed as `hostOverride`.
- **Settings before connecting:** `connectFirestoreEmulator` runs right after `initializeFirestore`,
  before any read or write, or the SDK has already opened its connection to the real backend.
- Emulator data never reaches production, and production data never reaches a laptop: a development
  build that should use a real project uses the development Firebase project, never production.
- `check-rnfb.mjs` (`emulator-in-production`) fails a literal host, a connection in a file that does not
  import the emulator config, and a config that is guarded by `__DEV__` or never compares the variant
  with `'development'`.

## App Check providers per platform and variant

`src/services/app-check/app-check-providers.ts` maps the variant to RNFB's provider options:

| Variant | Apple (`apple.provider`) | Android (`android.provider`) |
|---|---|---|
| development | `debug` | `debug` |
| preview | `appAttestWithDeviceCheckFallback` | `playIntegrity` |
| production | `appAttestWithDeviceCheckFallback` | `playIntegrity` |

- The allowed values (26.4.0 typings): Apple `'debug' | 'deviceCheck' | 'appAttest' |
  'appAttestWithDeviceCheckFallback'` (the default is `deviceCheck`), Android `'debug' |
  'playIntegrity'` (the default), web `'debug' | 'reCaptchaV3' | 'reCaptchaEnterprise'` with `siteKey`;
  each takes an optional `debugToken`.
- **App Attest with the DeviceCheck fallback** on iOS: App Attest is the stronger attestation, and the
  fallback keeps devices where App Attest is unavailable working. A stricter app may choose
  `appAttest`; the developer decides, and the Firebase console must have the matching provider
  registered (App Attest and DeviceCheck each need their own setup in the console: a human step).
- **Play Integrity** on Android needs the app linked to its Google Play app and the SHA-256 signing
  certificate registered in Firebase. A preview build installed outside Google Play (EAS internal
  distribution) may not get a recognised verdict; this was not verified on a device here, so test a
  preview build once, and if it fails, ship preview through a Play testing track.
- Start it with automatic refresh: `initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true })`
  after `provider.configure({ apple, android })` (`rnfb-app-check-adapter.ts`). In 26.4.0 it returns
  synchronously and the native provider finishes in the background; `getToken` before that fails with
  `appCheck/provider-not-ready` (27.0.0 typings and usage page, 2026-10-21).
- The iOS native side needs `'@react-native-firebase/app-check'` in the app config's `plugins`.

## Debug tokens

- The debug provider prints a debug token on first launch (Xcode console on iOS, logcat on Android);
  the developer registers it in the Firebase console under App Check, "Manage debug tokens". Each
  token is a secret that bypasses attestation: never in git, never in a preview or production build.
- A CI run on an emulator can pass a pre-registered token through `appCheckProviderOptions(variant,
  token)`; the function ignores it for every variant but development. Keep it in the development EAS
  environment or the CI secret store only.

## Enforcement is a console switch

App Check verifies nothing until the developer turns enforcement on per product (Firestore, Storage,
Functions) in the Firebase console, after the metrics page shows that current builds send valid
tokens. Turning it on rejects every older build without App Check, so it is a release decision: ask
the developer first. Callable functions enforce it in code (`enforceAppCheck: true`,
cloud-functions-backend).

## Tests and mocks

- The root mocks `__mocks__/@react-native-firebase/{app,firestore,app-check}.ts` are automatic in every
  Jest project: the native modules do not exist in Jest. They mock only the modular functions the
  adapters use, so a call to anything else fails loudly; add a function to the mock when an adapter
  starts using it.
- Feature and store tests use the fakes (`createFakeTaskStore`, `createFakeAppCheck`), never the mocks:
  the mocks prove the adapters, the fakes stand in for the ports.
- Security rules and emulator tests of the rules themselves belong to firestore-rules-and-emulator-tests.
