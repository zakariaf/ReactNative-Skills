---
name: firebase-rnfb
description: Builds React Native Firebase adapters - modular API, offline writes, listeners, uploads, App Check. Use when setting up RNFB, adding Firestore, Storage or Functions calls, or writes hang offline. Not for sign-in tokens (auth-and-secure-storage).
---

# React Native Firebase

The app talks to Firebase only through React Native Firebase's modular API inside small adapters
behind ports, so every user action is one batched write that lands in the native offline cache at
once and survives a kill, no screen ever waits for the server, every listener is cleaned up,
development builds alone reach the emulators, App Check runs before the first request, and no
Firebase config file is in git; a checker proves the code, and the templates' tests prove the adapters.

## Rules that must hold

1. **The modular API only:** named functions (`getFirestore`, `collection`, `doc`, `writeBatch`,
   `onSnapshot`, `getAuth`, `httpsCallable`), never `firestore()`, `firebase.app()` or a default
   import. Why: RNFB v26 removed the namespaced API, and the modular names match Firebase's own docs.
2. **RNFB is imported only in `*-adapter.ts` files under `src/data/firestore/` and
   `src/services/<concern>/`,** types included; ports, features and stores stay SDK-free and tests use
   the fakes and the root `__mocks__/@react-native-firebase/*.ts`. Why: one file per SDK concern to
   change on an upgrade, and code that runs in Jest without native modules.
3. **One write per user action, through `writeBatch`; never `runTransaction` on the client.** Why: a
   batch is applied to the offline cache at once and queued for the server, while a transaction needs
   the server and fails offline; read-then-write logic belongs in a Cloud Function.
4. **Never `await` a commit, `setDoc`, `updateDoc`, `addDoc` or `deleteDoc` in UI code, nor a port
   method whose adapter returns one.** The adapter sends the commit and reports a later refusal through
   a callback. Why: offline the promise stays pending until the server answers, so the screen hangs.
5. **Writes merge (`{ merge: true }` or `update`), and reads go through a lenient valibot codec
   (`v.object`) that skips a document it cannot parse.** Why: several app versions share the same
   documents; a replacing write deletes a newer version's fields and a strict read fails on them.
6. **Snapshot reads use `serverTimestamps: 'estimate'`** (and the instance's `serverTimestampBehavior:
   'estimate'`). Why: a pending `serverTimestamp()` reads as null offline, so lists jump and sort wrong.
7. **Every `onSnapshot` and `onAuthStateChanged` unsubscribe is returned:** from the adapter method and
   from the effect (`useEffect(() => port.watchList(...), [deps])`), with an error callback. Why: a
   dropped unsubscribe keeps a native listener alive after unmount, one more on every visit.
8. **Emulators are connected only in the development variant,** with host and ports from
   `src/config/firebase-emulators.ts`, never a literal host and never a `__DEV__` guard. Why: a
   preview or production build that reaches an emulator writes nowhere, and `__DEV__` follows the
   build type, not the backend.
9. **App Check is started before the first Firestore, Storage or Functions call, with a provider per
   platform and variant:** `debug` in development, `appAttestWithDeviceCheckFallback` on iOS and
   `playIntegrity` on Android in preview and production, token refresh on. Why: an earlier request
   carries no token and fails once enforcement is on, and a debug token in a store build bypasses it.
10. **Firestore settings come first and once:** `initializeFirestore` with persistence on, a bounded
    `cacheSizeBytes` and estimated timestamps, then the emulator, before any read or write. Why: RNFB
    applies settings given later only on the next launch.
11. **Per-variant `GoogleService-Info.plist` and `google-services.json` come from EAS file variables
    (`GOOGLE_SERVICES_PLIST`, `GOOGLE_SERVICES_JSON`) read by `app.config.ts`, and are git-ignored.**
    Why: each variant has its own Firebase app, and the files carry the project's keys.
12. **Every `@react-native-firebase/*` package is pinned exactly at the same version (26.4.0, verified
    2026-10-21), in a development build, with `useFrameworks: 'dynamic'` from `expo-build-properties`
    and plugin entries for app, auth and app-check.** Why: mixed versions fail to link, RNFB never runs
    in Expo Go, and its default Swift Package Manager mode fails with static frameworks.
13. **The Firestore cache is the app-data copy; nothing else is.** Declare it as
    persistence-and-migrations' `syncedStore` profile; device-only data (drafts, the upload queue) stays
    in kv-store or SQLite behind ports; never AsyncStorage, MMKV or the Firebase JS SDK. Why: the JS
    SDK has no persistent cache on React Native, so its queued writes die with the app.
14. **Storage uploads are queued by the app, and a storage path is written to Firestore only after its
    upload succeeds.** Why: an upload task does not survive a kill, and a local file URI in a synced
    document is a broken image on every other device.

## Workflow

1. Read [references/setup-and-versions.md](references/setup-and-versions.md): the pin, the release
   age, the install scripts to review, the config plugins, the iOS linkage and the config files. Ask
   the developer before creating EAS file variables or Firebase projects (outward-facing).
2. Install: `npm install -E @react-native-firebase/app@26.4.0 @react-native-firebase/firestore@26.4.0 @react-native-firebase/app-check@26.4.0 @react-native-firebase/auth@26.4.0`
   and `npx expo install expo-build-properties expo-dev-client`; the developer approves the two install
   scripts the reference names. Merge the lines of `examples/app-config-firebase.ts` into `app.config.ts`
   (app-variants-and-environment owns it), and add the two file names to `.gitignore`.
3. Copy the templates: `templates/src/config/` (the emulator config), `templates/src/data/firestore/`
   (client, codec, task adapter and its test), `templates/src/data/tasks/` (port, fake and its test),
   `templates/src/services/app-check/` and `templates/__mocks__/`. The Tasks nouns are a worked example:
   replace them with the app's own collections, keeping the shapes. The templates import `@/core/result`
   (error-handling-typed-results) and `@/config/app-variant` (app-variants-and-environment).
4. Wire the start-up order in the composition root as `examples/create-firebase-services.ts` shows:
   App Check, then `createFirestoreClient(firebaseEmulators(...))`, then the auth listener, then the
   adapters per uid. Read [references/emulators-and-app-check.md](references/emulators-and-app-check.md)
   for providers, debug tokens, hosts and the console steps.
5. A new collection or user action: read [references/offline-writes-and-listeners.md](references/offline-writes-and-listeners.md),
   add the method to the port, implement it in the adapter as one merged `writeBatch` (or an
   `onSnapshot` that returns its unsubscribe), add the fake's behaviour and an adapter test against the
   root mock, and call the port from the model hook without `await`. Then write its security rules
   and their emulator tests (firestore-rules-and-emulator-tests).
6. Declare the store in `contracts/persistence.json` (`syncedStore`, persistence-and-migrations) and run
   its checker too.
7. Run the tests: `npx jest src/config src/data src/services --ci` and `npm run typecheck`.
8. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-rnfb.mjs .` from the repo root; fix every `FAIL` line
   (each names the file, the rule and the fix) and rerun until it prints `RESULT: PASS`.

## Definition of done

- [ ] Every `@react-native-firebase/*` package in `package.json` has the same exact version; `app.config.ts` lists the app, auth and app-check plugins and `useFrameworks: 'dynamic'`, and reads `googleServicesFile` from `GOOGLE_SERVICES_PLIST` / `GOOGLE_SERVICES_JSON`.
- [ ] RNFB is imported only in `*-adapter.ts` files in `src/data/firestore/` and `src/services/<concern>/`; every port has a fake; the root mocks cover every function the adapters call.
- [ ] Each user action is one merged `writeBatch` whose commit is not awaited, and refusals reach `onWriteRejected`; no `runTransaction` in app code; reads parse through a codec with `serverTimestamps: 'estimate'`.
- [ ] Every listener returns its unsubscribe from its adapter and its effect, and passes an error callback.
- [ ] App Check starts before the Firestore instance; emulators connect only through `firebaseEmulators(...)`, which is null outside development.
- [ ] No `GoogleService-Info*.plist` or `google-services*.json` is tracked; `contracts/persistence.json` declares the synced store.
- [ ] `npx jest src/config src/data src/services --ci` passes and `npm run typecheck` is clean.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-rnfb.mjs .` prints `RESULT: PASS`. It prints no SKIP lines; an app without an `@react-native-firebase` package prints `NOT APPLICABLE: package.json lists no @react-native-firebase package`.

## Anti-patterns

- **`await batch.commit()` before navigating back.** Offline the screen never leaves; send the commit,
  navigate at once, and show "not synced yet" from `metadata.hasPendingWrites`.
- **`runTransaction` to bump a counter.** It fails offline and the change is lost; use `increment()` in
  the batch, or a Cloud Function for real read-then-write logic.
- **`useEffect(() => { store.watchList(...); }, [])`.** The braces drop the unsubscribe; return it.
- **`if (__DEV__) connectFirestoreEmulator(db, 'localhost', 8080)`.** A debug build of production then
  writes to a laptop and a release development build to production; take the config from the variant.
- **Committing `google-services.json` "because EAS needs it".** EAS file variables give each build its
  file; the committed one leaks the project's keys and serves the wrong variant.
- **The Firebase JS SDK "because it is simpler".** On React Native its cache is memory-only, so an
  offline user's work dies with the app; use RNFB.
- **`set(ref, task)` without merge.** An older app version deletes the fields a newer one added.
- **Importing a `Timestamp` type into a port.** The SDK leaks into features and their tests; convert
  to milliseconds in the codec.
- **A local file URI in a synced document.** Other devices cannot open it; upload, then write the path.
- **Upgrading one RNFB package alone, or to a release younger than 7 days.** Native builds break on
  mixed versions; bump every package together once the release has aged.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/setup-and-versions.md](references/setup-and-versions.md) | Dated version facts and re-verify commands: the pin and release age, packages, install scripts, config plugins, iOS dynamic frameworks and SPM, Android, per-variant config files, the modular API names, known issues | Workflow steps 1-2 |
| [references/offline-writes-and-listeners.md](references/offline-writes-and-listeners.md) | The offline cache and its settings, batched writes, no transactions, no awaited commits, merge writes and lenient reads, estimated timestamps, listeners, the auth listener, Functions calls with a region, Storage uploads offline, the split with persistence, what check-rnfb reports and its limits | Workflow step 5, and when a write hangs or a list jumps |
| [references/emulators-and-app-check.md](references/emulators-and-app-check.md) | The start-up order, emulators only in development, App Check providers per platform and variant, debug tokens, enforcement, tests and mocks | Workflow step 4 |
| `templates/src/config/` | `firebase-emulators.ts`, the one emulator decision (null outside development, hosts per platform), and its test | Workflow step 3 |
| `templates/src/data/firestore/` | `firestore-client-adapter.ts` (settings, emulator), `task-doc-codec.ts` (lenient codec), `firestore-task-adapter.ts` (batched writes, listener) and its test against the root mock | Workflow steps 3 and 5 |
| `templates/src/data/tasks/` | `task-store-port.ts` (the port), `fake-task-store.ts` and its test | Workflow steps 3 and 5 |
| `templates/src/services/app-check/` | The App Check port, providers per variant (+ test), the RNFB adapter (+ test) and the fake | Workflow steps 3-4 |
| `templates/__mocks__/@react-native-firebase/` | Root Jest mocks for app, firestore and app-check | Workflow step 3 |
| `examples/create-firebase-services.ts` | The Firebase part of the composition root, in start-up order | Workflow step 4 |
| `examples/app-config-firebase.ts` | The Firebase lines of `app.config.ts`: config files from EAS variables, plugins, dynamic frameworks | Workflow step 2 |
| `scripts/check-rnfb.mjs` | The checker: namespaced API, client transactions, awaited commits in UI, SDK outside adapters, emulators outside development, committed config files, listener leaks; options `--firestore-dir`, `--emulator-config` | Workflow step 8 and the definition of done |
| `scripts/selftest.mjs` | Proves the checker passes the templates and catches every planted bug | After changing the checker, a template or a fixture |
| `scripts/check-lib.mjs` | Shared script helper, a synced copy (do not edit here) | Never by hand |
| `scripts/lib/source-scan.mjs` | Shared TypeScript source scanner (imports, masked code), a synced copy (do not edit here) | Never by hand |
| `assets/shared.json` | Declares the shared files this skill copies in | When adding a shared file |
| `tests/` | `bases/app` (a Tasks app's package.json, tsconfig, app.config.ts, .gitignore, feature hook) and `fixtures/check-rnfb/CASES.json` (one planted bug per case, installed skills that must stay silent) | When adding a checker rule |

## Related skills

- `auth-and-secure-storage` - sign-in screens, providers, tokens and secrets.
- `firestore-rules-and-emulator-tests` - security rules for every collection and their emulator tests.
- `cloud-functions-backend` - callables, App Check enforcement, bulk and read-then-write work.
- `persistence-and-migrations` - the synced-store profile, device-only kv-store and SQLite data.
- `networking-and-server-state` - REST APIs and TanStack Query, not Firestore.
- `architecture-and-boundaries` - ports, adapters, fakes and the composition root.
- `app-variants-and-environment` - the variants, `app.config.ts` and EAS environments.
- `expo-prebuild-and-config-plugins` - config plugins and native build properties.
- `error-handling-typed-results` - the Result type the ports return.
- `async-safety` - timeouts around the rare intended wait (`waitForPendingWrites`).
- `dependency-management` - exact pins, release age, install-script approval, `doNotAdd`.
- `privacy-and-store-declarations` - SDK inventory rows for Firebase.
- `media-images-and-files` - local files and the upload queue's file handling.
