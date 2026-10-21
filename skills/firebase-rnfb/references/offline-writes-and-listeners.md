# Offline writes, reads and listeners

How Firestore data moves through the app so that it works on a plane: the offline cache, one batched
write per user action, why the UI never waits for the server, merge writes and forward-compatible
reads, snapshot listeners and their cleanup, the auth listener, Functions calls, and Storage uploads
that the cache does not protect. Firestore behaviour is quoted from the Firebase documentation
("Access data offline", "Transactions and batched writes") and the RNFB 26.4.0 and 27.0.0 sources,
read on 2026-10-21.

## Contents

- The offline cache
- One batched write per user action
- Never a client transaction
- Never wait for the server in UI code
- Merge writes, forward-compatible reads
- Server timestamps while offline
- Listeners and their cleanup
- The auth state listener
- Functions calls
- Storage uploads and their offline limits
- The data layer split with persistence-and-migrations
- What check-rnfb reports

## The offline cache

- On iOS and Android, Firestore persistence is **on by default** and controlled by the native SDK
  (RNFB `initializeFirestore` settings `persistence`, `cacheSizeBytes`, `serverTimestampBehavior`,
  `ignoreUndefinedProperties`; the web-only `localCache` / `persistentLocalCache` do not apply).
  Verified in the RNFB 27.0.0 sources and typings on 2026-10-21.
- The template `src/data/firestore/firestore-client-adapter.ts` states the defaults explicitly:
  `persistence: true`, `cacheSizeBytes: 100 MB` (Firebase's default; the minimum is 1 MB, or
  `CACHE_SIZE_UNLIMITED`, -1), and `serverTimestampBehavior: 'estimate'`.
- **Settings go in before any other Firestore call.** RNFB stores them natively; given later, they take
  effect only on the next launch (RNFB's Firestore usage page, 2026-10-21). The composition root calls
  `createFirestoreClient` once, right after App Check starts. In 26.4.0 and 27.0.0 `initializeFirestore`
  returns the instance synchronously (the docs still show an `await`; the typings win).
- The cache holds the documents the app has read and the queue of writes not yet confirmed; both
  survive an app kill and a restart, and the queue is sent when the network returns.

## One batched write per user action

A user action ("add task", "complete task") is one `writeBatch`: the task document and the list's
counter change together or not at all, and the batch is applied to the cache at once. "Batched writes
execute even when the user's device is offline" (Firebase, "Transactions and batched writes").

```ts
const batch = writeBatch(db);
batch.set(doc(tasks), { listId, title, isDone: false, updatedAt: serverTimestamp() }, { merge: true });
batch.set(doc(lists, listId), { openCount: increment(1), updatedAt: serverTimestamp() }, { merge: true });
void batch.commit().catch((error: unknown) => {
  deps.onWriteRejected({ kind: 'write-rejected', taskId, code: errorCode(error) });
});
```

- Commutative updates (`increment`, `arrayUnion`, `arrayRemove`, set-merge of a map key) merge
  safely from several offline devices; a read-modify-write does not.
- New ids come from `doc(collection)` (generated on the device, offline too) or from a UUID, never
  from the server, so the id is known the moment the user taps.
- A bulk change (renaming a list with thousands of tasks) does not belong in one client batch: batches
  have operation and request-size limits (read the current numbers on Firebase's "Usage and limits"
  page; not re-checked here) and every device would repeat the work. Do it in a Cloud Function
  (cloud-functions-backend).

## Never a client transaction

"Transactions will fail when the client is offline" (Firebase, "Transactions and batched writes";
RNFB repeats it). A transaction reads on the server, so offline it rejects and the user's change is
lost. Use a batch with commutative updates, or move the read-then-write to a Cloud Function, which
runs next to the database. `check-rnfb.mjs` reports `runTransaction` in app code (`client-transaction`).

## Never wait for the server in UI code

`commit()`, `setDoc`, `updateDoc`, `addDoc` and `deleteDoc` resolve only when the backend has stored
the write; offline the promise "will not resolve for a potentially-long time" (the Firebase JS SDK's
typings, which RNFB mirrors). A screen that `await`s it shows a spinner forever on a plane. So:

- The adapter sends the commit and returns at once (`void batch.commit().catch(...)`); the port's write
  method returns synchronously (`Result` for invalid input) and a later refusal (a rules failure,
  `permission-denied`) arrives through the adapter's `onWriteRejected` callback, which the composition
  root routes to the error log and, when the user must know, to a store the UI reads.
- Pending state comes from the listener: `snapshot.metadata.hasPendingWrites` is true until the server
  confirms; show a small "not synced yet" mark from that, never from an awaited promise.
- `waitForPendingWrites(db)` is the one place to wait on purpose (before signing out or deleting the
  account, with a timeout and an explanation to the user); async-safety's `withTimeout` bounds it.

`check-rnfb.mjs` (`awaited-commit-in-ui`) reports an `await` of a commit or a write function in routes,
features, UI, hooks and stores, and an `await` of a port method whose adapter returns or awaits one.

## Merge writes, forward-compatible reads

Several app versions read and write the same documents (an old phone that has not updated, the newest
build). Two habits keep them from breaking each other:

- **Writes merge:** `set(ref, data, { merge: true })` or `update`, naming only the fields this version
  owns. A plain `set` replaces the document and deletes the fields a newer version added.
- **Reads parse with a lenient codec:** `src/data/firestore/task-doc-codec.ts` checks every document
  with valibot `v.object` (unknown keys dropped, known keys type-checked) and skips a document that
  does not parse instead of crashing the list. A strict schema would fail on a newer version's field.
  persistence-and-migrations' synced-store profile exempts this folder from its `schema-strict` rule.

## Server timestamps while offline

`serverTimestamp()` is written as a sentinel; until the server confirms, a local snapshot reads it as
`null` by default. Read with `data({ serverTimestamps: 'estimate' })` (the template also sets
`serverTimestampBehavior: 'estimate'` on the instance), so a fresh task sorts by the device's estimate
instead of jumping when the server answers. RNFB computes the estimate natively (`'estimate' |
'previous' | 'none'`, read in the 27.0.0 `FirestoreDocumentSnapshot` source, 2026-10-21).

## Listeners and their cleanup

- `onSnapshot` returns its unsubscribe. The adapter's `watchList(listId, listener)` returns it unchanged,
  and the model hook returns it from its effect:

  ```ts
  useEffect(() => store.watchList(listId, { onTasks: setTasks, onError: reportWatchFailure }), [store, listId]);
  ```

  A dropped unsubscribe keeps the native listener alive after the screen unmounts: every visit adds one
  more, each downloading the same documents over the bridge.
- Always pass the error callback: a listener stops for good after an error (permission-denied after
  sign-out); the screen then shows the error state (ui-states-and-feedback).
- Keep queries narrow (`where`, `limit`) and listen to the few documents a screen shows; a listener over
  a whole large collection pushes every change of every document across the native bridge.
- `check-rnfb.mjs` (`listener-leak`) reports `onSnapshot`, `onAuthStateChanged`, `onIdTokenChanged`,
  `onTokenChanged` or `onSnapshotsInSync` called as a statement, and a `watch*` or `subscribe*` port
  call made as a statement in UI code.

## The auth state listener

The signed-in user's id (`uid`) is the root of every path (`users/{uid}/tasks`). One auth adapter in
`src/services/auth/rnfb-auth-adapter.ts` owns `onAuthStateChanged(getAuth(), next)` and returns its
unsubscribe; the composition root (or a root kit) subscribes once and publishes the uid to a session
store. The data adapters are created per uid, after sign-in, and replaced on a user change. Anonymous
sign-in (`signInAnonymously`) creates the user on the server, so the very first launch needs the
network once; after that the native SDK keeps the session offline. Linking providers and the sign-in
screens belong to auth-and-secure-storage.

## Functions calls

- Name the region the functions are deployed in: `getFunctions(getApp(), 'europe-west1')` (the
  signature `getFunctions(app?, regionOrCustomDomain?)`, 26.4.0 typings); a wrong region is a
  `not-found` error at run time.
- `httpsCallable(functions, 'enrichTask', { timeout: 30_000 })` sends the user's ID token and the App
  Check token itself. A callable needs the network: it is not queued, so the UI shows the offline
  state before calling and treats `unavailable` as "try again later".
- Validate the response with valibot at the adapter, like a document. The function side (App Check
  enforcement, input validation, secrets) belongs to cloud-functions-backend.

## Storage uploads and their offline limits

Storage uploads are **not** queued and persisted like Firestore writes. An upload task survives only
while the process lives; `pause()`/`resume()` work in-process, and on module invalidation the native
code cancels every pending task (read in the RNFB 27.0.0 Android and iOS sources, 2026-10-21; no
official sentence says it). So an image added offline is lost on a kill unless the app keeps it:

1. Copy the file into the app's document directory (media-images-and-files owns the file handling).
2. Record it in a device-only upload queue (persistence-and-migrations: a kv-store entry behind a port,
   or an SQLite table when it needs retry counts), with the target path.
3. Upload with `putFile(ref(getStorage(), path), localUri)` when online and on app start.
4. Only after the upload succeeds, write the storage path into the Firestore document (one batch).
   Never write a local file URI into a synced document: other devices cannot open it.

## The data layer split with persistence-and-migrations

The Firestore cache is the app-data copy, so a second local engine for the same data is the bug
persistence-and-migrations exists to prevent. Declare the store in `contracts/persistence.json`:

```json
{ "mode": "synced", "keyValueStore": "expo-sqlite/kv-store",
  "syncedStore": { "package": "@react-native-firebase/firestore", "adapterDir": "src/data/firestore/" } }
```

(`"mode": "tables"` with `syncedStore` when device-only tables stay in SQLite). Its checker then accepts
the Firestore SDK only in that folder and still fails AsyncStorage, MMKV and a second synced store.
Device-only data (a draft, the upload queue, an in-progress screen) stays on the device behind ports.

## What check-rnfb reports

| Rule | Means |
|---|---|
| `namespaced-api` | a default import or a `firebase` import from `@react-native-firebase/*`, or `require(...).default` |
| `client-transaction` | `runTransaction` imported from `@react-native-firebase/firestore` or called in app code |
| `awaited-commit-in-ui` | UI code awaits a commit or a write function, or a port method whose adapter returns or awaits one |
| `sdk-outside-adapter` | `@react-native-firebase/*` imported (types too) outside `*-adapter.ts` files in the Firestore folder and in `src/services/<concern>/`; tests, root mocks and scripts excepted |
| `emulator-in-production` | an emulator connection with a literal host, or in a file that does not import the emulator config; the config guarded by `__DEV__` or never comparing with `'development'`; connections with no config module |
| `config-file-committed` | a `GoogleService-Info*.plist` or `google-services*.json` the root `.gitignore` does not ignore; a literal `googleServicesFile` path |
| `listener-leak` | a listener called as a statement (unsubscribe dropped), or a `watch*`/`subscribe*` port call as a statement in UI code |

Options: `--firestore-dir <dir>` (default `src/data/firestore`) and `--emulator-config <file>` (default
`src/config/firebase-emulators.ts`); other folders come from `resolveLayout` (`rn-skills.config.json`
overrides them). `NOT APPLICABLE` when no `package.json` lists an `@react-native-firebase` package.

**Limits (heuristic):** the checker reads source text, not types. A port method is linked to its
adapter by name (one level of delegation is followed); a listener passed around under another name, an
`if (x) onSnapshot(...)` without braces, or a leak through a class field is not seen. The rules about
App Check order, region names, merge writes and estimate timestamps are proven by the templates' tests,
not by the checker; review them in a diff.
