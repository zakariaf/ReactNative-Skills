# Secure storage on iOS and Android

How `expo-secure-store` keeps a secret on each platform, the options that decide when it can be read,
what survives an uninstall or a backup restore, and the port the app keeps it behind. Verified on
2026-10-10 against expo-secure-store 57.0.4 (Expo SDK 57) by reading the installed sources and the
SDK 57 documentation; not measured on a device in this session.

## Contents

1. What the store is, per platform
2. The one options object
3. Keys, values and limits
4. Uninstall, reinstall and the install marker
5. Backups and device transfer (Android Auto Backup, iCloud)
6. Biometrics (`requireAuthentication`) and why tokens do without
7. The port, the adapter and the fake
8. What never goes into the secure store, and what never goes anywhere else
9. Pitfalls with fixes
10. Verified facts and how to re-verify them

## 1. What the store is, per platform

| | iOS | Android |
|---|---|---|
| Where a value lives | a Keychain item of class `kSecClassGenericPassword`, service = `keychainService` (default `app`) | a JSON envelope in `SharedPreferences` (file `SecureStore`), encrypted with an AES key held in the Android Keystore |
| Who can read it | this app (and apps of the same team sharing an `accessGroup`) | this app only; the Keystore key never leaves the secure hardware where the device has it |
| Readable when | decided by `keychainAccessible` (section 2) | whenever the app runs (the option is iOS-only) |
| Survives an uninstall | **yes**, when the app is reinstalled with the same bundle id (Apple does not guarantee it; plan for both) | no: the Keystore key is deleted with the app |
| Web | not supported (`platforms: android, ios, tvos`); a web build needs another design (an httpOnly cookie set by the server) | |
| Expo Go | works, but each Expo project shares Expo Go's Keychain namespace rules; `requireAuthentication` fails there when Face ID is available (no `NSFaceIDUsageDescription`) | works |

Everything is asynchronous on purpose. A Keychain read can wait for the device to unlock and a
Keystore decrypt can wait for a biometric prompt, so the app reads through `getItemAsync` and never
blocks the JS thread with the synchronous `getItem`/`setItem` (the checker's `secure-store-call`).

## 2. The one options object

```ts
export const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = Object.freeze({
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
});
```

- **Every call passes the same object.** An item written with one `keychainService` is found only
  with the same `keychainService`; a read with other options answers `null`, which the app would take
  for "signed out". One frozen constant in the adapter makes a mismatch impossible.
- **`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`**: readable once the phone was unlocked after a restart, so
  a refresh from a background task works (`WHEN_UNLOCKED`, the default, fails there while the screen
  is locked), and never migrated to another device from a backup. The SDK 57 web page labels this
  constant "Deprecated", but the shipped type declarations do not (only `ALWAYS` and
  `ALWAYS_THIS_DEVICE_ONLY` carry `@deprecated`); the page copies `ALWAYS`'s note by mistake.
- **iOS keeps the accessibility an item was first written with.** `setItemAsync` adds the item and,
  when it exists, calls `SecItemUpdate` with the data only (`ios/SecureStoreModule.swift`). Changing
  `keychainAccessible` later therefore changes nothing for existing items: remove and write them again
  (a one-off migration on the next sign-in is enough, since sign-in overwrites every key).
- **Never `ALWAYS`.** It keeps tokens readable on a locked, stolen phone.

## 3. Keys, values and limits

- Keys may contain only letters, digits, `.`, `-` and `_` (`/^[\w.-]+$/`); anything else throws
  `Invalid key provided to SecureStore` on both platforms. Values are strings.
- Every key lives in one closed list, `SECURE_KEYS` in `src/services/secure-storage/secure-key-names.ts`,
  and the port's key parameter is typed with it. Sign-out and the fresh-install wipe loop over
  `ALL_SECURE_KEYS`, so a key added next year is wiped too (`secure-keys`).
- Keep each value small. Expo does not enforce a limit, but some iOS releases refused values above
  about 2 KB. The session splits into three values: the refresh token, the access token, and a small
  JSON meta value (expiry and the account's non-secret facts). A large id token is never stored: the
  app reads what it needs from it once (`readIdTokenClaims`) and lets it go.
- The file is named `secure-key-names.ts`, not `*-keys.ts`: networking-and-server-state treats every
  `*-keys.ts` file as a TanStack Query key factory.

## 4. Uninstall, reinstall and the install marker

The iOS Keychain outlives an uninstall. Without a guard, a person who deletes the app (perhaps to sign
out for good, or to hand the phone on) and installs it again is signed straight back in as the
previous account. The fix is a marker in the app's own sandbox, which an uninstall does delete:

1. At restore, read the marker (`InstallMarkerPort`, on `expo-sqlite/kv-store`, synchronously).
2. Missing: this is a fresh install. Wipe every declared key, then write the marker. If the wipe
   failed, leave the marker unset so the next launch tries again.
3. Unreadable (the kv-store threw): never wipe on a doubt; restore normally.
4. Present: restore normally.

Sign-in writes the marker too (every key was just overwritten). A sign-out whose wipe failed clears the
marker, so the next launch wipes what would not go away. On Android the wipe finds nothing (the
Keystore key went with the app) and costs one read.

A device backup restores the sandbox (and with it the marker) but not the tokens
(`THIS_DEVICE_ONLY` on iOS, the backup exclusion on Android), so a restored phone starts signed out
either way: the restore reads "empty" or, for a half-restored set, "corrupt".

## 5. Backups and device transfer (Android Auto Backup, iCloud)

- **Android.** Auto Backup copies `SharedPreferences` to Google Drive and to a new phone. The copied
  `SecureStore` envelopes cannot be decrypted there (their Keystore key stayed on the old phone).
  expo-secure-store 57 deletes an entry it cannot decrypt (`BadPaddingException`, or no Keystore key)
  and answers `null`, so the person is merely signed out; other Keystore errors reject with
  `DecryptException`. The config plugin excludes the `SecureStore` preferences from backup by setting
  `android:fullBackupContent` and `android:dataExtractionRules` to its own rule files.
- **The plugin is not applied automatically.** `expo-secure-store` is not in prebuild's list of
  auto-applied plugins (`@expo/prebuild-config` `withDefaultPlugins.js`), so it must be listed in
  `app.config.ts` (`secure-store-plugin`):

  ```ts
  ['expo-secure-store', { faceIDPermission: false }],
  ```

  `configureAndroidBackup` defaults to `true`. `faceIDPermission: false` drops the
  `NSFaceIDUsageDescription` the plugin would otherwise add (an untranslated default, and a purpose
  string for a feature the app does not use). Verified with
  `npx expo config --type introspect`: the plugin wrote both Android attributes, and the Face ID key
  disappeared with `false`.
- **The app's own backup rules.** When the app has its own `fullBackupContent` or
  `dataExtractionRules`, the plugin warns and writes nothing. Exclude `sharedpref` path `SecureStore`
  in both files yourself, set `configureAndroidBackup: false`, and name the rules file in
  `contracts/auth.json` `customAndroidBackupRules`.
- **iOS.** Keychain items marked `THIS_DEVICE_ONLY` are not in iCloud or encrypted-backup restores to
  another device.
- **Export compliance.** expo-secure-store uses only the operating system's encryption. Apple asks
  about encryption at upload; `ios.config.usesNonExemptEncryption: false` answers it for an app that
  uses no other encryption (privacy-and-store-declarations owns that answer).

## 6. Biometrics (`requireAuthentication`) and why tokens do without

`requireAuthentication: true` ties an item to the current biometric enrolment:

- **Android** asks for authentication on every operation, reads included, so a silent token refresh
  would prompt.
- **iOS** asks when reading or updating an existing item (`biometryCurrentSet`), and needs
  `NSFaceIDUsageDescription`.
- Adding a fingerprint or a new face invalidates the item: the read answers `null` and the person is
  signed out without warning. Simulators and emulators do not prompt, so this is tested on a device.

Session tokens therefore never use it. An app that gates something behind biometrics (opening a vault,
confirming a payment) keeps that secret under its own key and options in a second, explicit adapter
method, and says why with a `// biometric-gate: <why>` comment, which the checker accepts.

## 7. The port, the adapter and the fake

| File | Role |
|---|---|
| `secure-storage-port.ts` | `SecureStoragePort`: `read`, `write`, `remove`, each a `Result`; never rejects. A failed read is `secure-storage-unavailable`, never "nothing stored". |
| `expo-secure-store-adapter.ts` | The only importer of `expo-secure-store`; one options object; records the cause with the key name, never the value. |
| `fake-secure-storage.ts` | In memory: seed values, `failNext(operation)`, `holdWrites()` for interleavings, `calls` in order. |
| `secure-key-names.ts` | `SECURE_KEYS`, `ALL_SECURE_KEYS`, `SECURE_KEY_PATTERN`. |

The concern folder is `secure-storage` (architecture-and-boundaries names the port
`SecureStoragePort` in its contract, and its layout check treats every `*-store.ts` file as a Zustand
store, which `fake-secure-store.ts` would trip).

### Secrets without sign-in

An app that keeps a secret but signs nobody in (a person's own API key, a key the server issued to
this installation, a database key) copies only `src/services/secure-storage/*` and
`src/services/install-marker/*` with their tests, declares its keys in `SECURE_KEYS`, lists the
expo-secure-store plugin, and writes `contracts/auth.json` as `{ "signIn": false }`. check-auth then
runs the storage rules only (checker-rules section 1). The Keychain still outlives an uninstall, so the
fresh-install wipe stays: run it at startup, before the first secret is read.

```ts
// src/services/secure-storage/wipe-secrets-on-fresh-install.ts
export async function wipeSecretsOnFreshInstall(
  secureStorage: SecureStoragePort,
  installMarker: InstallMarkerPort,
): Promise<void> {
  const marker = installMarker.isPresent();
  // An unreadable marker is not a fresh install: never wipe on a doubt.
  if (!marker.ok || marker.value) return;
  for (const key of ALL_SECURE_KEYS) {
    const removed = await secureStorage.remove(key);
    if (!removed.ok) return; // marker left unset: the next launch wipes again
  }
  installMarker.write();
}
```

## 8. What never goes into the secure store, and what never goes anywhere else

| Goes into the secure store | Never goes there |
|---|---|
| refresh token, access token, the small session meta | app data, caches, preferences (SQLite and kv-store: persistence-and-migrations, settings-and-preferences) |
| an API key the server issued to this installation | a key that ships in the binary (`EXPO_PUBLIC_*` is public: app-variants-and-environment) |
| a biometric-gated secret under its own key | a client secret (an app cannot keep one; PKCE replaces it) |

And the other way round: a credential never sits in SQLite, kv-store, AsyncStorage, MMKV or a file
(`token-storage`), in a Zustand store (`token-in-state`), in a log, crash report or analytics event
(`token-in-log`), or in a URL (`token-in-url`).

## 9. Pitfalls with fixes

| Symptom | Cause | Fix |
|---|---|---|
| Signed in again after deleting and reinstalling the app (iOS) | the Keychain survived the uninstall | the install marker wipe (section 4) |
| Signed out on every launch after an update | a read used other options (`keychainService` changed) | one frozen options object; migrate by reading with the old options once, writing with the new |
| A background refresh fails with "User interaction is not allowed" | `WHEN_UNLOCKED` and a locked screen | `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (and remove/rewrite existing items) |
| Signed out after restoring a phone from a Google backup | the restored envelope could not be decrypted (expo-secure-store deleted it) | expected; list the plugin so the copy is never made |
| `Invalid key provided to SecureStore` | a space, `/` or non-ASCII letter in the key | keys from `SECURE_KEYS` only |
| A write fails on an old iPhone with a large value | the platform refused a value above about 2 KB | split the session; never store the id token |
| Signed out after enrolling a new fingerprint | `requireAuthentication` item invalidated | no biometrics on session tokens |
| "locked" reads at startup reported as signed out | the restore treated a failed read as empty | a failed read publishes `unavailable` in the background and is retried in the foreground; a second foreground failure signs out with `storage-unavailable`, values kept |

## 10. Verified facts and how to re-verify them

Verified on 2026-10-10 in an installed Expo SDK 57 app (expo-secure-store 57.0.4):

| Fact | Re-verify |
|---|---|
| Key pattern `/^[\w.-]+$/` and the error text | `grep -n "isValidKey" -A2 node_modules/expo-secure-store/build/SecureStore.js` |
| Only `ALWAYS` and `ALWAYS_THIS_DEVICE_ONLY` are `@deprecated` | `grep -n "@deprecated" -A2 node_modules/expo-secure-store/build/SecureStore.d.ts` |
| iOS update writes the data only (accessibility kept) | `sed -n 85,145p node_modules/expo-secure-store/ios/SecureStoreModule.swift` |
| Android deletes undecryptable entries and answers null | `grep -n "BadPaddingException\|reinstalled" node_modules/expo-secure-store/android/src/main/java/expo/modules/securestore/SecureStoreModule.kt` |
| The plugin writes both Android backup attributes; `faceIDPermission: false` deletes the key | `cat node_modules/expo-secure-store/plugin/build/withSecureStore.js`; `npx expo config --type introspect` |
| The plugin is not auto-applied | `grep -n "legacyExpoPlugins\|versionedExpoSDKPackages" node_modules/@expo/prebuild-config/build/plugins/withDefaultPlugins.js` |
| `getItemSync`/`setItemSync`/`removeItemSync` exist in kv-store | `grep -n "ItemSync" node_modules/expo-sqlite/build/Storage.d.ts` |
