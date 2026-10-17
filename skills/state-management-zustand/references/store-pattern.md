# The store pattern: shape, composition, reducers, selectors, tests, checks

How an Expo app holds client state in Zustand 5: one thin store per domain over a pure reducer,
created once per app start from the data layer's ports and handed down through context. The example
domain is a Tasks app (lists and tasks); the templates hold the complete files.
`scripts/check-stores.mjs` checks the pattern in the source and `scripts/check-reducers.mjs` runs the
reducers.

## Contents

- Kinds of state, one home each
- The store shape
- Persist before publish: the two orders
- Memory-only stores
- Entitlements and other service-fed state
- Composition: createStores, StoresProvider, the root layout, the test app
- Action names
- Reducers and their cases tables
- Selectors and the useShallow rule
- Writes that span stores
- Async work around a synchronous store
- Reading a store outside React
- Document mode (the save-document appendix)
- Testing a store
- iOS and Android: why the order matters on a device
- When multi-package
- What the checkers report
- The contract and the config keys
- Verified

## Kinds of state, one home each

| State | Lives in | Persisted | Example |
|---|---|---|---|
| Server data | TanStack Query's cache over the ApiClient port (networking-and-server-state) | the query cache, if the app persists it | a shared list from the server |
| Local rows | SQLite tables behind repositories (persistence-and-migrations), mirrored by a domain store | yes, before the store publishes | lists, tasks |
| An entitlement or the signed-in account | its table (or secure-store port) behind a repository, mirrored by a domain store whose method writes first (see Entitlements below) | yes, before the store publishes | Premium |
| Preferences | the settings store over its storage port (settings-and-preferences) | yes | theme, language |
| UI choices across screens | a memory-only domain store | no, on purpose | the filter chip |
| One screen's UI state | `useState` in the model hook | no | an open sheet |
| Form drafts | react-hook-form (forms-and-input) | only when the form says so | a new task's title |
| Navigation | Expo Router (route params, the navigator's own state) | no | the open list's id |
| An editing session with undo | a per-session store (references/undoable-session.md) | yes, written before it is shown | a bulk edit |
| OS switches | an OS-mirror store (accessibility-as-code) | no | reduce motion |

[state-homes.md](state-homes.md) explains each choice and how to move state from Redux, Context, MobX
or a `persist` + AsyncStorage store.

## The store shape

```ts
// src/stores/tasks-store.ts (abridged; the full file is a template)
export function createTasksStore({ tasks }: TasksStoreDeps): TasksStore {
  return createStore<TasksStoreState>()((set, get) => ({
    ...tasksReducer(DEFAULT_TASKS_STATE, readTasks(tasks)),   // hydrated once, synchronously
    setDone: (taskId, isDone) => {
      const current = get();
      const next = tasksReducer(current, { type: 'set-done', taskId, isDone });   // 1. reduce
      if (next === current) return ok(undefined);        //    nothing changes: no write, no render
      const saved = tasks.setDone(taskId, isDone);       // 2. persist (committed when ok)
      if (!saved.ok) return saved;                       //    a failed write publishes nothing
      set(next);                                         // 3. publish
      return saved;
    },
    reload: () => {
      const action = readTasks(tasks);
      set(tasksReducer(get(), action));
    },
  }));
}

export function useTasksStore<TSlice>(selector: (state: TasksStoreState) => TSlice): TSlice {
  return useStore(useStores().tasks, selector);
}
```

Why each part:

- **A factory with its ports as arguments, never a module-level store.** Tests build fresh stores over
  fake repositories, and a singleton leaks state between tests. Fast Refresh re-runs an edited module
  while components keep their state, so a module-level store is created a second time beside the one
  on screen; a store made in the root layout's `useState` initializer is created exactly once per React
  tree (a full reload rebuilds the tree, so it is made again with it).
- **`createStore` from `zustand/vanilla` plus `useStore(store, selector)`.** Services and handlers read
  the same store outside React with `getState()`. `create` from `zustand` makes a hook-store singleton.
- **Hydrated through the reducer, synchronously, when the store is made.** The repository is
  synchronous, so the first frame already shows the saved rows, with no effect and no loading flash. A
  failed read becomes state (`loadFailure`), never a throw: the screen explains it.
- **Methods return a `Result`.** The caller (a model hook) shows the failure; nothing throws for an
  expected failure (error-handling-typed-results).
- **The hook lives in the store file** (`tasks-store.ts` exports `useTasksStore`, naming-conventions'
  main-export rule) and reads the store through `useStores()`.

## Persist before publish: the two orders

| The change | Order | Template |
|---|---|---|
| The reducer can compute the next state (an update, a delete, a toggle) | reduce → same object? stop → persist → check → `set(next)` | `tasks-store.ts` `setDone` |
| Persistence assigns something (an id, a timestamp) | persist → check → `set(reducer(get(), { type: 'add-task', task: saved.value }))` | `tasks-store.ts` `addTask`, `lists-store.ts` `addList` |

Both keep the same promise: the screen never shows a value that is not on disk, a failed write shows
nothing (the failure comes back as a `Result`, or is recorded in a `…Failure` field the screen reads, as
settings-and-preferences' store does with `lastWriteFailure`), and a change that changes nothing neither
writes nor re-renders. A write is synchronous on purpose: when the repository returns ok, the transaction
has committed.

## Memory-only stores

A store whose state should start fresh on every launch (a filter chip, a selection) has no port to
write through. It says so in the file, with the reason, so a reviewer and `check-stores` can tell a
decision from a forgotten write:

```ts
// src/stores/task-filter-store.ts
// memory-only: the filter chip starts at "open tasks" on every launch, by design.
export function createTaskFilterStore(): TaskFilterStore {
  return createStore<TaskFilterStoreState>()((set, get) => ({
    isShowingDone: false,
    toggleShowingDone: () => {
      set(taskFilterReducer(get(), { type: 'toggle-showing-done' }));
    },
  }));
}
```

It still has a reducer, a cases table and selectors; it needs no store test (there is no write order).
The marker is only for state that is meant to be lost. A store whose state is saved somewhere, even by
someone else, never carries it: that would hide exactly the bug `check-stores` exists to catch.

## Entitlements and other service-fed state

Some state is produced by a service, not by a tap: a Premium entitlement the purchase flow verified
(in-app-purchases), the signed-in account the auth flow established (auth-and-secure-storage). The
tempting shape is a publish-only store, where the service writes the row itself and then calls
`dispatch(action)`, which only runs `set(reducer(get(), action))`. That splits one fact between two
writers: the store cannot tell a failed write from a good one, a second caller can publish without
writing, and `check-stores` cannot tell it from a forgotten write (`store-persist-order`).

The default: **the store owns the write, like every other store.** The service does its own work
(the store purchase, the receipt check, the network sign-in, all asynchronous and outside the store),
then hands the result to a store method that reduces, writes through the repository, checks the
`Result` and publishes:

```ts
// src/stores/premium-store.ts (abridged)
export function createPremiumStore({ entitlements }: PremiumStoreDeps): PremiumStore {
  return createStore<PremiumStoreState>()((set, get) => ({
    ...premiumReducer(DEFAULT_PREMIUM_STATE, { type: 'replace-entitlement', entitlement: entitlements.current() }),
    grantPremium: (entitlement) => {
      const current = get();
      const next = premiumReducer(current, { type: 'grant-premium', entitlement });
      if (next === current) return ok(undefined);       // already owned: no write, no render
      const saved = entitlements.save(entitlement);     // the entitlements table, committed when ok
      if (!saved.ok) return saved;                      // the purchase flow keeps the transaction open
      set(next);
      return saved;
    },
  }));
}

// in the purchase flow (in-app-purchases), after the receipt is verified:
const granted = stores.premium.getState().grantPremium(entitlement);
if (granted.ok) await finishTransaction({ purchase, isConsumable: false });   // only once it is on disk
```

- **Finish the store transaction only after the grant returns ok.** If the write failed, StoreKit
  delivers the unfinished transaction again at the next launch and Google Play lists the unacknowledged
  purchase again, so the grant is retried (Play refunds a purchase left unacknowledged for three days, so
  the retry must not wait for a manual step); finishing first would lose a paid purchase. The grant is
  idempotent: an entitlement already owned returns the same state, writes nothing and returns ok.
- **Premium never turns off without a dated revocation.** The reducer keeps the entitlement unless the
  action is `revoke-premium` with the store's revocation time; a reset never touches it
  (persistence-and-migrations keeps the entitlements table, or the document's premium section,
  protected from "Delete all my data"), and the store's `reload` after a reset reads it back unchanged.
- **Sign-in state has the same shape, without secrets.** The auth flow keeps the token in
  `expo-secure-store` behind auth-and-secure-storage's port; the account store holds only non-secret
  facts (the account id, a display name, "signed out") and its `signIn(account)` / `signOut()` methods
  write those through a port before they publish. The token never enters a store.
- The premium store joins `createStores` and `updateAndPublish` like any store that holds rows; the
  purchase flow receives the stores (or just `grantPremium`) from the composition root.
- in-app-purchases ships the other accepted shape: like the settings store, the premium store has its
  own context and `usePremiumStore` hook instead of joining `createStores`, and `openPurchaseStores` is
  the single caller of `createPremiumStore` and `createPaywallStore`. Its methods are
  `grantPremium({ ownedSinceMs })` and `revokePremium(revokedAtMs)`, both returning
  `Result<void, EntitlementFailure>`; the paywall flow is a separate memory-only store driven by
  `paywallReducer` with imperative action names. check-stores and check-reducers pass on both shapes;
  a store outside `createStores` is outside `updateAndPublish` too, which is right for premium (a reset
  never touches it) and wrong for any store whose rows a cross-store write changes.

## Composition: createStores, StoresProvider, the root layout, the test app

```ts
// src/stores/create-stores.ts
export function createStores(deps: StoreDeps): Stores {
  return { lists: createListsStore(deps), tasks: createTasksStore(deps) };
}
```

- The deps are the data layer's repositories (`StoreDeps = { tasks: TaskRepository }`), not the
  services object: a store writes rows through a repository, which exists only after
  `openDeviceData(services)` has opened the database and run the migrations, so a store can never
  publish before its storage is ready, and a test passes a fake repository without building services.
- AppRoot (the canonical startup component under DirectionGate, app-startup-and-bootstrap) calls
  `createStores({ tasks: data.tasks })` once in its `startApp` state initializer, after `openDeviceData`
  and the error net's sink, and renders `<StoresProvider stores={app.stores}>` right after
  `SettingsStoreProvider` (or after `AppDataProvider` and `QueryProvider` when the app has no settings)
  and before `PreferencesRoot` (the skill's `examples/app-root.tsx` and `examples/app-providers.tsx`;
  `contracts/startup.json` `appRootOrder` holds the order). check-stores accepts a factory call in
  `src/features/root-navigator/`, the startup's home; anywhere else under features it is a store per
  mount.
- `test/test-app.tsx` (unit-and-component-tests owns it) builds the same stores over fakes, so component
  and hook tests run the real factories and return the stores for the test to call:

  ```tsx
  const tasks = createFakeTaskRepository(options.clock);   // seed rows through tasks.addList(...)
  const stores = createStores({ tasks });
  // <ServicesProvider ...><AppDataProvider ...><StoresProvider stores={stores}>{children}</StoresProvider>...
  ```

- Each domain factory is called in one composition file only; `check-stores` reports a second caller,
  and any call in feature, UI or shared-hook code (a new store per mount that no other screen sees).
- `useStores()` throws without a provider: a missing provider is a programmer error, never a default.
- A store another skill ships with its own provider (settings-and-preferences' settings store, created
  once at startup by its own opener) follows the same rules; it does not need to join `Stores`.
- A per-session store (the shipped `createSessionStore`) is created by the feature that runs the
  session, once per session, in a `useState` initializer. `check-stores` knows it by its shape, not its
  name: its file also declares a hook whose first parameter is the store
  (`useUndoableSessionStore(store, selector)`). Any other factory is a domain factory, including an auth
  `createSessionStore` read through `useSessionStore(selectIsSignedIn)`.

## Action names

- kebab-case, imperative, verb first: `set-<field>`, `toggle-<flag>`, `add-<thing>`, `remove-<thing>`,
  `reset-<thing>`, `record-<fact>`, `replace-<things>`; sessions use `apply-command`, `undo`, `pause`,
  `resume` (naming-conventions holds the verb table).
- Never an event name: `task-added`, `on-toggle`, `did-pause`, `theme-changed` are reported
  (`action-name`). A command verb followed by a field or flag that ends in -ed is a command, not an
  event: `set-completed`, `toggle-pinned`, `set-haptics-enabled`, `show-archived` pass.
- How `action-name` decides: it reads the action union (`type <Name>Action = ...` and the local member
  types it names; without one, every `type: '...'` literal of a reducer or types file). A name is an
  event when its first word ends in -ed or is `on`, `handle`, `did`, `was`, `has`, `is`, `should` or
  `will`, or when its last word ends in -ed and its first word is not a known command verb (`set`,
  `toggle`, `add`, `remove`, `reset`, `record`, `replace`, `show`, `hide`, `mark`, `clear`, `select`,
  `apply`, `undo`, `pause`, `resume`, `load`, `save`, `move`, `rename`, `grant`, `revoke`, `start`,
  `finish`, `enable`, `disable`, `open`, `close`, `update`, `delete`, `copy`, `assign`, `duplicate`,
  `share`, `snooze` and a few more; the full list is `IMPERATIVE_VERBS` in `scripts/lib/store-rules.mjs`).
  A last word of `failed` or `succeeded` is always an outcome, even after a listed verb (`load-failed`,
  `save-succeeded` are reported; record the fact with `record-load-failure`). A command on the failed
  items names them (`retry-failed-tasks`, `clear-failed-uploads`), because `retry-failed` reads the same
  as the event "the retry failed".
- Two limits of that word test: a command starting with a verb outside the list and ending in -ed
  (`nudge-expired`) is reported, so pick a listed verb (`mark-expired`) or start with the verb that
  changes the state; and an event that starts with a listed verb (`set-changed`) passes, so review
  still reads the names.
- The action type is a discriminated union of readonly objects; the reducer switches over `action.type`
  with every case returning (`noImplicitReturns` and the exhaustive switch catch a missing case).
- Time and ids arrive in the action (`{ type: 'add-active-time', ms }`, a saved row with its id).

## Reducers and their cases tables

- Pure: no React, React Native, Zustand, Expo, services, data-layer adapters or API imports (types are
  fine; schema defaults are plain data), no `Date`, `Math.random`, `performance.now`, `randomUUID`.
- Never mutate: spread (`{ ...state, tasks: [...state.tasks, task] }`).
- Return the same object when nothing changes, so the store skips the write and the render.
- The cases table beside the reducer is the rules as data:

  ```ts
  // src/stores/tasks-reducer-cases.ts (abridged)
  export const TASKS_REDUCER_CASES: ReducerCases<TasksState, TasksAction> = {
    reducer: 'tasksReducer',
    initial: { tasks: [MILK, MAIL], loadFailure: null },
    cases: [
      { rule: 'add-task-appends', action: { type: 'add-task', task: BREAD }, expect: { tasks: [MILK, MAIL, BREAD] } },
      { rule: 'set-done-unchanged-is-a-no-op', action: { type: 'set-done', taskId: 2, isDone: true }, same: true },
    ],
  };
  ```

  `expect` matches objects key by key (keys left out are free) and arrays item by item; `same: true`
  requires the very same object back; `state` replaces `initial` for one case. States and actions are
  plain JSON values. The reducer's test runs every case with `caseProblem` (`src/stores/reducer-cases.ts`)
  and adds fast-check properties for ranges and idempotence.
- `check-reducers` imports the reducer and its table in Node and runs every case again with the generic
  invariants: the input is deep-frozen (a mutation throws), each case runs twice and must give equal
  results (hidden module state, a clock), and at least one case must pin a no-op.
- **A rules-bound reducer** (`gameSessionReducer(rules, session, action)`: one reducer, bound to the
  rules of whichever game or ruleset it runs) keeps the `*-reducer.ts` name and its cases table names
  the rules export: `{ reducer: 'gameSessionReducer', rules: 'LIGHTS_OUT_RULES', initial, cases }`.
  The cases file exports the rules object (importing a pure rules module is fine); `check-reducers`
  runs `reducer(rules, state, action)`, and the test binds it the same way:
  `caseProblem((state, action) => gameSessionReducer(LIGHTS_OUT_RULES, state, action), TABLE, item)`.
  The undoable session reducer keeps its own built-in checks (its export name is the signal).

## Selectors and the useShallow rule

- A selector returns a primitive or a reference that already lives in the state (`state.tasks`,
  `state.loadFailure`, `state.setDone`). Those need nothing else.
- A selector that builds a new object or array on every call (`(s) => ({ a: s.x, b: s.y })`, `.map`,
  `.filter`, `.sort` on a copy, `Object.entries`, a spread) is wrapped in `useShallow` from
  `zustand/shallow`:

  ```ts
  const lists = useListsStore(useShallow(selectListsByName));
  const tasks = useTasksStore(useShallow((state) => selectTasksOfList(state, listId)));
  const openCount = useTasksStore(selectOpenTaskCount);   // a number: no useShallow
  ```

- Why: Zustand 5 hands the selector to React's `useSyncExternalStore`; a new reference on every call is
  a change on every render, and React throws "Maximum update depth exceeded". `tasks-store.test.tsx`
  proves it on React 19.2 with RNTL 14. Zustand 4's equality argument <!-- stack-pin-ignore: the old major, named on purpose -->
  (`useStore(store, selector, shallow)`) no longer exists, and `zustand/traditional` brings it back in a
  second style: `check-stores` reports both (`shallow-v4`).
- A store hook is never called without a selector: `useTasksStore()` re-renders on every change, and
  `useStore(store)` returns the whole state (`selector-missing`).
- Which form a hook has comes from its declaration, not its name: a hook declared in `src/` whose first
  parameter is a store (`store: SessionStore<...>`, `StoreApi<S>`) takes `(store, selector)`; every other
  `use<X>Store` takes `(selector)`. A `…Session…Store` hook declared outside the scanned files is read as
  `(store, selector)` only when it gets two arguments or one that is not a selector (a `select…` name, an
  arrow or function, `useShallow(...)`), so `useSessionStore(selectIsSignedIn)` is a domain hook.
- Named selectors live in `<domain>-selectors.ts`. A selector that builds a value says so in its TSDoc
  and declares a non-primitive return type; `check-stores` finds every such builder and reports a call
  site without `useShallow`. A selector that filters but returns a number (`.length`) declares `: number`.
- React Compiler memoizes components; it does not make a new object selector stable. Keep `useShallow`.
- Derived screen data (a summary card) comes from a pure function called in the model hook with
  reference selectors, not from a selector that builds the whole model.

## Writes that span stores

```ts
// src/stores/update-and-publish.ts
export function updateAndPublish<TValue, TFailure>(stores: Stores, write: () => Result<TValue, TFailure>): Result<TValue, TFailure> {
  const written = write();               // ONE transaction (a repository method, a reset, an import)
  if (!written.ok) return written;       // nothing published
  stores.lists.getState().reload();      // every store re-reads what is on disk
  stores.tasks.getState().reload();
  return written;
}
```

Use it for removing a list (the list and its tasks), "Delete all my data", a data import, and a
backup restore: data-export-and-restore's `BackupService.restore(preview)` replaces every backed-up table
in one transaction, a whole-data change exactly like a reset, so its model runs
`updateAndPublish(stores, () => backup.restore(preview))` and every store re-reads. Name it in
`crossStoreWrites` (`restore`) unless another API of the app has a method of that name
(auth-and-secure-storage's `session.restore()` does); then wrap it once under a distinct name
(`const restoreBackup = (preview) => backup.restore(preview)`) and list that name. Pass the write
inline (`() => tasks.removeList(id)`), or as a `const` the same file hands to `updateAndPublish`. The write
returns a `Result`; a data-layer function that throws instead is converted once, at that boundary.
persistence-and-migrations' `AppData.resetAllData()` is that write: one transaction returned as
`Result<void, StorageFailure>` (the raw error is already recorded as `'storage'`). The composition root
(the root layout, which holds `AppData`; features never do) hands it to the settings screen, mapping the
failure to the screen's own type at that boundary:

```ts
// in the root layout or the composition root, handed to the settings screen as deleteAllData
const deleteAllData = (): Result<void, DataResetFailure> =>
  updateAndPublish(stores, () => {
    const reset = data.resetAllData();
    return reset.ok ? reset : err({ kind: 'data-not-deleted' });
  });
```

The contract name stays `resetAllData`. A data layer whose reset still throws (`resetAllData(driver):
void`) is wrapped once in `attempt(...)` there instead. Never build
such a change from several store calls: that is several transactions, and a kill between them leaves
half of it. Never call the write alone either: the disk is right, but the other stores keep showing the
old rows until the next launch (`check-stores` reports `cross-store-write` for every name in
`contracts/stores.json` `crossStoreWrites` called outside `updateAndPublish`'s argument, outside the
data folder and tests). A new store that holds rows gets a `reload` method and a line here.

A second shape, from dates-streaks-and-statistics: completing a task also records the day in the
progress store (streak and stats), so the completion is one repository transaction that writes both,
with the new progress computed by a pure function first:

```ts
updateAndPublish(stores, () =>
  tasks.complete({ taskId, completedAtMs, progress: recordCompletion(progress, completion) }),
);
```

`complete` is listed in `crossStoreWrites`; `recordCompletion` returns the same object for a repeat day
or a practice run, so the progress store's selectors keep their references and nothing re-renders.

## Async work around a synchronous store

A store never awaits (rule 7). Work that must wait, such as a file import, a backup restore or a
refresh whose answer is kept locally, runs in a hook or a service, and only its result enters a store:

- one `createLatestRequest()` per operation (async-safety's `src/core/async/latest-request.ts`), held
  by the hook or service that starts it, never by the store;
- after each `await`, return when `signal.aborted` (a newer request or an unmount won), then call the
  store's synchronous method, or `updateAndPublish` when the result changes rows several stores hold;
- a write is never cancelled for a newer one; queue it (async-safety's rule);
- whoever starts the request cancels it: the effect cleanup or the service's `dispose()`.

Network data itself stays in TanStack Query (rule 6); this is for results the app owns afterwards.

## Reading a store outside React

- A handler, a service or another store reads with `stores.tasks.getState()` at the moment it runs.
- Never in render: `useStores().tasks.getState().tasks` in a component reads once and never updates; use
  the hook with a selector.
- Nothing outside the store calls `setState` (`store-set-outside`): changes go through the store's own
  methods, which reduce and persist first; `updateAndPublish` asks stores to `reload`.

## Document mode (the save-document appendix)

When persistence-and-migrations runs in `"mode": "document"` or `"both"`, small app state lives in one
validated document. A store over it receives the `DocumentService`:

```ts
setTheme: (theme) => {
  const current = get();
  const next = preferencesReducer(current, { type: 'set-theme', theme });
  if (next === current) return;
  const isSaved = document.update((doc) => ({ ...doc, preferences: next.preferences }));
  if (!isSaved) {
    set({ lastWriteFailure: { kind: 'document-not-saved' } });
    return;
  }
  // What the document holds now: validated and on disk. replace-preferences clears lastWriteFailure.
  set(preferencesReducer(get(), { type: 'replace-preferences', preferences: document.doc().preferences }));
},
```

`update` returns `false` when the change did not reach the disk; publish only on `true`, and publish
what the document now holds (`document.doc()`), not the reducer's `next`: the service validates (and may
normalise) the document it writes, so reading it back keeps the store equal to what was validated and
saved. Each store's recipe replaces only its own sections.

A change spanning sections (a reset, an import) is one `update` through `updateAndPublish`, written with
`{ refreshBackup: true }` so that a later backup restore cannot bring the deleted data back:

```ts
updateAndPublish(stores, () =>
  document.update(resetAllSections, { refreshBackup: true }) ? ok(undefined) : err({ kind: 'document-not-saved' }),
);
```

Then every section store's `reload` re-reads `document.doc()`. Per-change writes from one store touch
the `current` copy only.

## Testing a store

- Build the store over a fake repository (`createFakeTaskRepository()`), seeded through its own methods.
- Persist before publish: subscribe, and inside the listener read the fake's rows; the listener must
  already see the new value.
- A failed write: set `failNextWrite` and assert the listener never ran and the method returned the
  failure.
- A no-op: spy on the repository method and assert it was not called and no listener ran.
- A hook: `renderHook` with a wrapper around `StoresProvider` (or `renderHookWithProviders`), awaited:
  RNTL 14 is async.
- Store tests stay thin; the rules live in the cases table and the reducer test.

## iOS and Android: why the order matters on a device

- iOS suspends a backgrounded app and the system may end it at any time (memory pressure, an update);
  Android's low-memory killer ends background processes, and "Don't keep activities" or a process-death
  test (`adb -s <serial> shell am kill <package>` while the app is in the background) does the same.
  JavaScript state is gone; only what was committed survives. A store that publishes first or writes
  later ("on background") loses the last change.
- Fast Refresh in development re-runs an edited module while components keep their state, so a
  module-level store is created a second time beside the one on screen; tests need a fresh store each.
  A store made in the root layout's `useState` initializer is created exactly once per React tree, and a
  full reload (`reloadAppAsync`, an RTL direction switch) rebuilds the tree, and the stores with it.
- Kill-and-relaunch by hand on a named device: iOS `xcrun simctl terminate <udid> <bundle-id>` then
  `xcrun simctl launch <udid> <bundle-id>`; Android `adb -s <serial> shell am force-stop <package>` then
  `adb -s <serial> shell monkey -p <package> -c android.intent.category.LAUNCHER 1`. The persistence
  skill's kill test automates the data side; Maestro flows (e2e-maestro) can assert the screen after it.

## When multi-package

Stores belong to the app workspace (`apps/<app>/src/stores/`); a shared package holds only pure
reducers, selectors and types (no `zustand` import), so it stays testable without React. Install with
`npm install -E zustand@5.0.15 -w apps/<app>`. `check-stores` and `check-reducers` scan every
workspace's `src/` from `package.json` `workspaces` (or `--src-dir` for one); per-workspace layout keys
come from `rn-skills.config.json` `workspaces`.

## What the checkers report

`check-stores.mjs` (static, reads `src/`):

| Rule | Means | Fix |
|---|---|---|
| `contract` | `contracts/stores.json` missing while two or more stores persist, or malformed | copy the template and fill it |
| `missing-file` | `update-and-publish.ts` missing while the contract lists `crossStoreWrites` | copy the template |
| `store-singleton` | `create` from `zustand`, or a store made at module level outside `osMirrorStores` | a factory called by `createStores` |
| `store-created-twice` | a domain factory called in two files, or in feature, UI or shared-hook code (a per-session factory, whose file declares a hook taking the store first, is left out) | one composition file |
| `store-persist-order` | a method publishes before it persists, or never persists without `// memory-only:` (a publish-only `dispatch` fed by a service too) | reduce, persist, publish |
| `store-unchecked-write` | a write's result dropped or never tested before `set` | keep and test the `Result` |
| `store-logic-outside-reducer` | `set` publishes a value no reducer produced (a failure-only object is allowed) | publish the reducer's result |
| `store-async` | `async`, `await` or `.then(` in a store | synchronous ports; network in TanStack Query |
| `store-set-outside` | `.setState(` from a file that creates no store | the store's own methods, `updateAndPublish` |
| `reducer-impure` | a reducer or selectors file imports runtime code or reads time or randomness | types only; time in the action |
| `reducer-untested` | a reducer or a persisting store without its sibling test | add the test |
| `action-name` | an action-union member not kebab-case, or an event name (`task-added`, `load-failed`; `set-completed`, `copy-selected` pass) | `set-…`, `add-…`, `record-…` |
| `selector-missing` | a store hook without a selector (`useTasksStore()`, `useUndoableSessionStore(store)`), or with one that returns the whole state (`(s) => s`) | select what is shown |
| `selector-new-object` | a built value selected without `useShallow` | wrap it, or select primitives |
| `shallow-v4` | an equality argument, `zustand/traditional`, `createWithEqualityFn` | `useShallow` |
| `second-persistence` | zustand `persist` anywhere in `src/`, or AsyncStorage or MMKV in a store (persistence's `legacyImports` allowed; a key-value adapter in `src/services/` is persistence-and-migrations' rule, including MMKV when `contracts/persistence.json` `keyValueStore` names it) | the data layer's ports |
| `store-bypasses-persistence` | a store imports SQLite, secure storage, files, an adapter, the driver or the slot store | receive a repository or service |
| `server-state-in-store` | a store imports TanStack Query, the API layer or an HTTP client, or calls `fetch` | networking-and-server-state |
| `query-data-copied` | an effect copies query data into a store | read `useQuery` where it is shown |
| `cross-store-write` | a `crossStoreWrites` call outside `updateAndPublish` | `updateAndPublish(stores, write)` |

`check-reducers.mjs` (runs code in Node): `module-load`, `reducer-cases-missing`,
`reducer-cases-invalid`, `reducer-case`, `reducer-no-op-new-object`, `reducer-mutates`,
`reducer-nondeterministic`, and for the session reducer `session-command`, `session-undo`,
`session-paused`, `session-finished` (its `--help` explains each). Both are NOT APPLICABLE when `zustand`
is not in `package.json`; `check-reducers` also when `src/` holds no `*-reducer.ts`.

Limits (heuristic, by design; review covers the rest): a store's persistence is recognised as a call
through the parameters of the innermost function around `createStore`, in any form (`export function
createXStore(deps)`, Zustand's `export const createXStore = ({ repo }: Deps) => createStore<S>()(...)`,
a function expression or a method), including names the body destructures or reads off a parameter
before `createStore` (`const { tasks } = deps;`, `const tasks = deps.tasks;`). A port reached another
way (imported at module level, or captured from a function two levels up) is not seen; `clock`,
`errorLog`, `logger` and similar ports never count. `store-created-twice` knows a domain factory by its
export (`export function create<X>Store` or `export const create<X>Store = (...) =>`); one renamed on
import is not seen, and a per-session factory is recognised only when its own file declares the hook
that takes the store first. A store hook's form is read from its declaration in `src/` (first parameter
typed as a store, or named `store`); a hook declared elsewhere falls back to the `…Session…Store` and
argument test above, which takes a lone argument for a store unless it is an inline function, `useShallow(…)` or a
`select…` name, so `useAuthSessionStore(isSignedIn)` from another package is reported as
`selector-missing`: name the selector `selectIsSignedIn`, or declare the hook in the scanned `src/`. A
builder selector is recognised by its body and a non-primitive return type, when it is an exported
`select…` of a `*-selectors.ts` file or a function declared at the top level (column 0) of the file that
calls the hook; a builder imported from any other file, renamed on import, or held in a variable inside
a function is not seen. `query-data-copied` follows `query.data` and a `data: alias` destructured from
`useQuery`, but not data passed through another variable or hook. Cross-store writes are recognised by
name. A store file is a file under the stores folder or one that holds a `createStore` initializer.
`action-name` reads only the action union and the member types it names in the same file; a member
type imported from another file is checked in its own file only when that file is a reducer or types
file, and the event test is the word heuristic described under Action names.

## The contract and the config keys

`contracts/stores.json` (template and JSON schema in `templates/contracts/`):

- `crossStoreWrites`: names of the functions or repository methods whose one transaction changes rows
  more than one store holds (`removeList`, `resetAllData`, an import). Calls inside the data folder (the
  definition and its own helpers) and tests are left out.
- `osMirrorStores`: files that may create a store at module level (an OS mirror that is never
  persisted; accessibility-as-code's `src/ui/a11y/system-a11y-store.ts`). Without a contract this is the
  only default.

`rn-skills.config.json` (optional): the layout keys (`srcDir`, `storesDir`, `dataDir`, `apiDir`,
`contractsDir`, ...) and `storesContract` (another path for the contract). Options: `--src-dir`,
`--stores-dir`, `--contract`.

## Verified

On 2026-10-03 in the reference Expo SDK 57 app (expo 57.0.26, React Native 0.86.3, React 19.2.3,
TypeScript 6.0.3, zustand 5.0.15, Jest 29.7 with jest-expo 57.0.5, RNTL 14.0.1, fast-check 4.10.2): every
template type-checks under the strict tsconfig set, lints clean with the canonical ESLint config, and its
59 tests pass, including the "Maximum update depth exceeded" proof. zustand 5.0.15's `shallow.d.ts`
re-exports `useShallow` from `zustand/react/shallow`; `useStore(api)` without a selector returns the whole
state. Re-verify: `npm view zustand version`, then `npx jest src/stores --ci --maxWorkers=2`.
