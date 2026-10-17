# Online, focus and offline

How the app knows it is online and in the foreground, what TanStack Query does with that, and how an
app keeps working without a network: paused queries and mutations, a persisted cache, and the offline
outbox for writes that must survive a kill. `@tanstack/react-query` 5.104.0 and `expo-network` 57.0.2,
verified on 2026-10-04 by reading the installed sources of an Expo SDK 57 app; re-verify commands in
section 10.

## Contents

1. Why React Native needs wiring
2. The ConnectivityPort and its expo-network adapter
3. Focus: AppState, not window visibility
4. QueryProvider: wiring for as long as the client is mounted
5. What "offline" does to queries and mutations
6. Showing offline state
7. A persisted query cache (opt-in)
8. Writes that must survive a kill: the outbox
9. Sign-out, account switch and the cache
10. Verified facts and how to re-verify them

## 1. Why React Native needs wiring

TanStack's `focusManager` listens to `visibilitychange` on `window`, and its `onlineManager` to
`online`/`offline` on `window`, each guarded by `typeof window !== 'undefined' && window.addEventListener`.
React Native has a global `window` without `addEventListener`, so out of the box:

- `onlineManager` assumes online forever: queries never pause in a tunnel, they fail, retry and show
  errors; nothing resumes when the network returns.
- `focusManager` never fires: returning to the app after an hour shows hour-old data until something
  else triggers a refetch.

`src/api/query-managers.ts` feeds both from React Native (`connectQueryManagers`), and the checker
fails an app that never calls `onlineManager.setEventListener` and `focusManager.setEventListener`
(`managers-wired`).

## 2. The ConnectivityPort and its expo-network adapter

```ts
export type Reachability = 'reachable' | 'unvalidated' | 'none';

export type ConnectivityPort = {
  readonly isOnline: () => boolean; // reachability() !== 'none': feeds onlineManager
  readonly subscribe: (listener: (isOnline: boolean) => void) => () => void;
  readonly reachability: () => Reachability; // a hint for banners, ads and purchases
  readonly subscribeReachability: (listener: (reachability: Reachability) => void) => () => void;
};
```

- **One answer to "online?" for the whole app.** TanStack's onlineManager, an offline banner, ads
  (admob-ads-and-consent) and purchases (in-app-purchases) read the same port. This skill owns the
  canonical files (`src/services/connectivity/`, with `reachability-hub.ts`, the fan-out the adapter
  and the fake share); other skills ship the same bytes.
- **A wrapper implements all four members, through the hub.** A "simulate offline" switch, a test
  double or any decorator around the adapter is built on `createReachabilityHub` (as
  `fake-connectivity.ts` is), not as an object literal with only `isOnline`/`subscribe`: the hub
  keeps `isOnline` derived from the reachability and drops unchanged reports, and a two-member
  literal no longer type-checks. Use `reachability()` only for "may fail" hints.
- **One native listener for the app's life.** `createExpoNetworkConnectivityAdapter` is created once by
  the composition root and fans the state out in JS. expo-network 57 keeps one `NWPathMonitor` per
  module on iOS and cancels it when its last JS listener is removed; a cancelled `NWPathMonitor` cannot
  be started again, so a screen that subscribes and unsubscribes directly can leave the module deaf.
  The listener carries an `// app-lifetime:` comment for async-safety's listener rule.
- **No second subscription.** The onlineManager wiring takes the port, and only
  `src/services/connectivity/*-adapter.ts` imports `expo-network` or
  `@react-native-community/netinfo` (`connectivity-port`; the house ESLint config bans the same imports).
- **Unknown counts as offline.** The port answers `none` (offline) until the first report (iOS reports
  the current path as soon as the monitor starts; the adapter also asks `getNetworkStateAsync()` and
  drops that answer if an event came first). A failed first read is recorded; the next change still
  reports.
- **Online means "on a network"; reachability is only a hint.** `isOnline()` follows `isConnected`
  alone, so TanStack pauses only when there is no network at all. `reachability()` adds what Android
  knows about validation, for code that wants to warn early (a banner saying "connected, but the
  internet may be unavailable", an ad that skips a load, a purchase button that explains a likely
  failure). Never pause queries on it: see the table.

| | iOS | Android |
|---|---|---|
| Source | `NWPathMonitor` path status | `ConnectivityManager` default network callback |
| `isConnected` | path satisfied | a network of a known type |
| `isInternetReachable` | always equal to `isConnected` (no probe) | the network has `NET_CAPABILITY_INTERNET`, `NET_CAPABILITY_VALIDATED` and is not suspended; a VPN also needs `linkDownstreamBandwidthKbps != 0` |
| `isOnline()` (pauses TanStack) | `isConnected === true` | `isConnected === true` |
| `reachability()` | `reachable` or `none` | `reachable`, `unvalidated` (connected, `isInternetReachable === false`) or `none` |

Where the OS's answer and the truth disagree:

| Situation | What expo-network says | What the app does, and why |
|---|---|---|
| Server down, DNS failure, hotel portal on iOS | connected (and reachable) | requests fail as `network-unavailable` or `timed-out`, retry, and the screen shows the failure: wrongly online costs a few failed attempts that retry by themselves |
| Captive portal on Android, before sign-in | connected, not reachable | online (`unvalidated`): requests fail and retry like the row above; the banner may say "sign in to the network" |
| Android network that works but never validates: a corporate or school firewall blocking the probe host, Wi-Fi joined with "use this network anyway", an AOSP device whose probe host is unreachable | connected, not reachable, for good | online (`unvalidated`): requests succeed. Pausing on reachability here would keep every query and mutation paused forever with "we'll load when you're back online", because nothing ever retries a paused request; wrongly offline is the worse direction |
| Android VPN that reports zero downstream bandwidth | connected, not reachable | online (`unvalidated`), for the same reason |
| Airplane mode, no Wi-Fi and no data | not connected | offline (`none`): queries and mutations pause and resume on reconnect |

TanStack's own React Native guide feeds onlineManager from `!!state.isConnected` for the same reason.
Never ping a server to decide "online": it costs battery and data and is wrong in its own ways.

**Simulating offline** on named devices only:

- Android emulator: `adb -s <serial> shell cmd connectivity airplane-mode enable` (and `disable`), or
  `adb -s <serial> shell svc wifi disable` plus `svc data disable`.
- iOS simulator: the simulator shares the Mac's network; use the Network Link Conditioner profile
  "100% Loss" (Xcode Additional Tools) or turn the Mac's Wi-Fi off. There is no per-simulator switch.
- A test build's "simulate offline" switch wraps the real adapter (debug-menu-and-test-hooks), which
  reaches every consumer because they all read the one port.

## 3. Focus: AppState, not window visibility

`connectQueryManagers` calls `focusManager.setEventListener` with an AppState subscription and treats
only `'active'` as focused.

| AppState | iOS | Android | Focused here |
|---|---|---|---|
| `active` | foreground | foreground | yes |
| `inactive` | app switcher, Control Center, an incoming call, Face ID sheet | not used | no |
| `background` | home screen, another app | home screen, another app | no |

Treating `inactive` as unfocused means a return from the app switcher refetches stale queries, and
retries wait instead of firing while the user looks at Control Center. While unfocused, TanStack pauses
retries and interval polling (`refetchIntervalInBackground: false`); JavaScript is suspended in the
background on both platforms anyway.

## 4. QueryProvider: wiring for as long as the client is mounted

```tsx
<ServicesProvider services={app.services}>
  <QueryProvider client={app.queryClient} connectivity={app.services.connectivity}>
    {children}
  </QueryProvider>
</ServicesProvider>
```

- `QueryProvider` renders `QueryClientProvider` and connects the managers in an effect; the cleanup
  restores TanStack's defaults, so a test that mounts it twice starts clean.
- `QueryClientProvider` calls `client.mount()`, which subscribes the client to both managers: on focus
  and on reconnect it first resumes paused mutations, then refetches stale active queries.
- The managers are module singletons: one wiring per process. The checker wants some file outside
  `src/api/` to render `<QueryProvider>` (or `<QueryClientProvider>` together with the wiring), and
  SKIPs that check until the root layout exists (navigation-and-routing creates it).

## 5. What "offline" does to queries and mutations

With the default `networkMode: 'online'`:

| Situation | Query | Mutation |
|---|---|---|
| Starts while offline | `status: 'pending'`, `fetchStatus: 'paused'`; no request | `isPaused: true`; `mutationFn` not called |
| Goes offline between retries | the retryer pauses; the attempt count is kept | same |
| Comes back online | paused fetches continue; stale active queries refetch | `resumePausedMutations()` runs them in order, before the refetches |
| App killed while paused | nothing lost (it refetches next launch) | lost, unless persisted (section 7) or written to the outbox (section 8) |

- `networkMode: 'always'` runs requests regardless (they fail at once and show errors offline). Keep it
  for queries that never touch the network (a local read wrapped as a query) and mark it:
  `// network-mode-always: <why>` inside the options (`network-mode` rule).
- `networkMode: 'offlineFirst'` tries once, then pauses retries: useful when a service worker or an
  HTTP cache could answer, which is not the case in a React Native app by default.
- **Serialize writes to one resource** with a mutation `scope: { id }`: mutations sharing a scope id run
  one after another, also after resuming, so "rename, then delete" never arrives reversed.

## 6. Showing offline state

The model hook turns query state into a view state (`examples/task-list-state.ts`):

- Cached data and offline: keep showing the data with a quiet "offline" notice. Never replace cached
  data with an error.
- Nothing cached and paused: "we'll load this when you're back online", not an error and not an
  endless spinner.
- Writes waiting offline: `useMutationState({ filters: { status: 'pending' }, select: (m) => m.state.isPaused })`
  or `useIsMutating()` in a model hook drives a "will sync when online" hint.
- The banner itself reads `services.connectivity` (subscribe in a model hook with
  `useSyncExternalStore(connectivity.subscribeReachability, connectivity.reachability)`), not query
  state, so it is right even when no query runs: `none` shows "offline", `unvalidated` may show a
  softer "the internet may be unavailable" while requests still run. ui-states-and-feedback owns its
  look and its announcement.

## 7. A persisted query cache (opt-in)

Persist the cache only when the app must show the last data at a cold start without a network (a
read-mostly app used on the move). It is a cache: safe to drop, never the source of truth for data the
user created.

```sh
npm install -E @tanstack/react-query-persist-client@5.104.0 @tanstack/query-async-storage-persister@5.104.0
```

- **Storage:** `expo-sqlite/kv-store`'s `Storage` (async `getItem`/`setItem`/`removeItem`) through an
  adapter in `src/services/query-cache/kv-query-cache-adapter.ts`, never a kv-store import in
  `src/api/` and never AsyncStorage (persistence-and-migrations: one key-value store, behind a port).
- **Provider:** `PersistQueryClientProvider` in place of `QueryClientProvider` inside `QueryProvider`,
  with `persistOptions: { persister: createAsyncStoragePersister({ storage, throttleTime: 1000 }),
  maxAge, buster }`.
- **`buster`** is the API schema version (bump it when a response schema changes shape): restored data
  skipped the schema check of this app version, so a mismatched shape would reach screens unchecked.
  Default `''`. **`maxAge`** bounds how old restored data may be (default 24 h); keep the queries'
  `gcTime` at least `maxAge`, or restored queries are collected before anyone reads them. The checker
  requires both keys (`persist-cache`).
- **What is saved:** by default successful queries and paused mutations
  (`defaultShouldDehydrateQuery`: `status === 'success'`; mutations: `isPaused`). Exclude personal or
  large data with `dehydrateOptions.shouldDehydrateQuery` (a query `meta: { persist: false }` read
  there). The blob is plain text in the app's data folder and rides in device backups.
- **Paused mutations restored after a kill** need their function back: register
  `queryClient.setMutationDefaults(taskKeys.all, { mutationFn })` for each persisted mutation key before
  restoring, and call `queryClient.resumePausedMutations()` in `onSuccess` of the provider. Without the
  defaults a restored mutation has no function and fails. For writes the user must never lose, use the
  outbox instead.

## 8. Writes that must survive a kill: the outbox

Data the user creates offline (a task added on a plane) is app data. persistence-and-migrations owns
where it lives: the row in its table plus an `outbox` row written in the same transaction, behind
repository methods (`pendingChanges(limit)`, `markSynced(id)`, `markRejected(id, status)`). This skill
owns the sync:

- A sync service (`src/api/sync/` or the resource's folder) reads pending changes and sends each through
  the ApiClient with the change id as `idempotencyKey`, oldest first, one at a time per resource.
- It runs when connectivity turns online, on focus, and after each local write; never in a tight loop.
  A retryable failure leaves the row for next time (attempts counted); `rejected` or `conflict` marks it
  for the user to resolve, never silently drops it.
- After the server confirms, `markSynced(id)` and invalidate the resource's keys, so the lists show the
  server's version (with its server id in its own column).
- Background sync while the app is closed belongs to background-tasks (expo-background-task); it calls
  the same service. The shape both paths share: a sender `send(change, signal)` that resolves to a
  `Result<void, { kind: 'offline' } | { kind: 'rejected'; status } | { kind: 'cancelled' }>` (never
  rejects) and passes `change.id` as the `idempotencyKey`, over the repository methods above
  (synchronous Results); background-tasks runs it through `runBackgroundJob`.

## 9. Sign-out, account switch and the cache

The client is created per app run, so data never leaks between runs. Within a run:

- **Sign-out:** `await queryClient.cancelQueries()` then `queryClient.clear()` (queries and
  mutations), and remove the persisted blob (`persister.removeClient()`) when the cache is persisted.
- **Account switch:** the same, or put the account id in every key prefix when two accounts may be
  shown in one session.
- auth-and-secure-storage owns tokens and decides when sign-out happens; it calls a `signOut` that
  clears the cache as one of its steps.

## 10. Verified facts and how to re-verify them

| Fact | Re-verify (in an installed Expo SDK 57 app) |
|---|---|
| Managers listen on `window` only when `window.addEventListener` exists | `grep -n "addEventListener" node_modules/@tanstack/query-core/build/modern/onlineManager.js node_modules/@tanstack/query-core/build/modern/focusManager.js` |
| onlineManager starts online | `grep -n "#online = " node_modules/@tanstack/query-core/build/modern/onlineManager.js` |
| `mount()` resumes paused mutations, then refetches, on focus and reconnect | `grep -n "resumePausedMutations\|onFocus\|onOnline" node_modules/@tanstack/query-core/build/modern/queryClient.js` |
| Default dehydration: successful queries, paused mutations | `grep -n "function defaultShouldDehydrate" -A2 node_modules/@tanstack/query-core/build/modern/hydration.js` |
| `maxAge` default 24 h, `buster` default `''` | `npm pack @tanstack/query-persist-client-core@5.104.0` and `grep -n "maxAge = " package/build/modern/persist.js` |
| `createAsyncStoragePersister({ storage, key, throttleTime, serialize, deserialize, retry })` | `npm pack @tanstack/query-async-storage-persister@5.104.0` and read `package/build/modern/index.d.ts` |
| expo-network `isInternetReachable` semantics per platform | `sed -n 1,25p node_modules/expo-network/build/Network.types.d.ts` |
| Android reachability needs `NET_CAPABILITY_VALIDATED`, and a VPN non-zero downstream bandwidth | `sed -n 15,55p node_modules/expo-network/android/src/main/java/expo/modules/network/NetworkUtils.kt` |
| iOS reachability equals `isConnected` | `grep -n "isInternetReachable" node_modules/expo-network/ios/NetworkModule.swift` |
| One iOS `NWPathMonitor` per module, cancelled with the last listener | `grep -n "NWPathMonitor\|cancel" node_modules/expo-network/ios/*.swift` |
| kv-store `Storage` is async (`getItem` returns a Promise) | `grep -n "getItem\|setItem\|removeItem" node_modules/expo-sqlite/build/Storage.d.ts` |

Read from the shipped sources; not measured on a device in this session.
