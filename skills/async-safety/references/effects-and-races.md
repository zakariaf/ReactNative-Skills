# Effects and races

How async work started by an effect, a handler or a store keeps its results from landing where they
no longer belong: one cancellation per effect run, latest-wins for overlapping calls, the first read
of an outside value racing its change event, writes that must not run twice, and navigation after an
await. Read it before writing an effect that awaits, a search, a filter, a refresh or an OS mirror.

**Scope.** These shapes are for async work that is not server state: SQLite repositories, native
SDKs, OS reads, device APIs. Data behind the `ApiClient` is read with `useQuery`
(networking-and-server-state), never copied into `useState` from an effect or a latest-request
handler: the query key already gives latest-wins, TanStack passes the signal to the `queryFn` and
owns retries (cancellation-and-deadlines.md, section 10).

## Contents

1. What actually goes wrong
2. The effect shape: one AbortController per run
3. The flag shape, for work that takes no signal
4. State that remembers which request it answers
5. Async acquisition: a subscription that arrives later
6. Focus effects
7. Latest-wins outside effects (createLatestRequest)
8. The first read racing the change event
9. Writes: never twice, never cancelled half-way
10. Navigating after an await
11. Async work around a synchronous store
12. Platform notes

## 1. What actually goes wrong

- **Out-of-order answers.** The user opens task 1, then task 2. Task 1's request is slower and lands
  last: the screen titled "Task 2" shows task 1. Nothing throws; every test that resolves promises in
  order passes.
- **Writes into a screen the user left.** A response for a screen that was popped calls a setter. In
  React 18 and later that is a silent no-op for an unmounted component (the old warning was removed),
  so the cost is wasted work, unless the continuation also navigates, writes a store, shows a toast or
  starts more work: then the user sees something they never asked for.
- **Leaks that outlive their owner.** A subscription created after the cleanup ran (section 5), a
  timer nobody clears (listeners-and-timers.md), a retry loop that keeps sleeping and acting.

Expo Router does not wrap the app in React's StrictMode (verified: no `StrictMode` in expo-router
57.0.24's build), so the double effect run that exposes a missing cleanup on the web never happens on
a device. The race tests in test-recipes.md are the proof instead.

## 2. The effect shape: one AbortController per run

```ts
useEffect(() => {
  const controller = new AbortController();
  const { signal } = controller;
  taskDetails
    .load(taskId, signal)                 // a SQLite read: the adapter drops its result once aborted
    .then((result) => {
      if (signal.aborted) return;          // a newer run or the unmount owns the screen now
      if (result.ok) setAnswer({ request, state: { status: 'loaded', task: result.value } });
    })
    .catch((error: unknown) => {
      if (!signal.aborted) errorLog.record('service', error);   // cancellation is not a failure
    });
  return () => {
    controller.abort();                   // the id changed, the user retried, or the screen unmounted
  };
}, [taskDetails, errorLog, taskId, request]);
```

- One controller per run, created inside the effect, aborted by that run's cleanup. React runs the
  cleanup before the next run and on unmount, so the previous request is always cancelled first.
- Check `signal.aborted` before every write, not only once: an `await` can hide anywhere in between.
- Pass the signal down into every port call that accepts one; that is what stops the network (a port
  that takes no signal still works: the check drops its late result).
- No setter runs synchronously in the effect body (react-components-and-hooks: `set-state-in-effect`);
  derive "loading" from the request key instead (section 4).
- `effect-stale-result` fails an effect whose continuation sets state, dispatches, navigates or calls
  a same-file async function that does, unless its cleanup aborts a controller (and the continuation
  reads `signal.aborted` after each await that precedes a write), flips a flag the continuation checks,
  or calls `cancel()`/`invalidate()`. A write whose argument awaits (`setTitle(await repo.get(id))`)
  always fails: no check can sit between the answer and the write, so await into a `const` first.
- Imitate `examples/use-task-details-model.ts` and its race tests.

## 3. The flag shape, for work that takes no signal

```ts
useEffect(() => {
  let isCurrent = true;
  repository
    .countOpen(listId)                       // SQLite: nothing to abort, so drop the late result
    .then((count) => {
      if (isCurrent) setOpenCount({ listId, count });
    })
    .catch(reportError);
  return () => {
    isCurrent = false;
  };
}, [repository, listId, reportError]);
```

A flag the continuation never reads proves nothing; the checker fails a cleanup that sets a flag
that a writing continuation does not read. Prefer the controller when any call in the chain takes a
signal: the flag stops the write, the signal also stops the work.

A mounted ref (`isMounted.current = false` in the cleanup) is not this flag. It is one value for the
component's whole life, so it covers unmount only: when a dependency changes, the next run sets it
back to `true` and the older run's answer writes. The checker reads it like a flag only in an effect
with `[]` deps; anywhere else it reports the ref. Use one local flag or controller per run.

## 4. State that remembers which request it answers

When the input changes (`taskId`), the old answer is wrong immediately, not when the new one arrives.
Keep the request key next to the answer and derive the visible state:

```ts
const request = `${taskId}#${String(attempt)}`;
const [answer, setAnswer] = useState<{ request: string; state: TaskDetailsState } | null>(null);
// ...
return { state: answer?.request === request ? answer.state : LOADING, onRetry };
```

No effect sets "loading", nothing flashes the previous task, and a retry (`attempt + 1`) shows loading
at once. The other React-native answer to an identity change is a `key` on the screen component
(`<TaskDetails key={taskId} />`), which remounts it with fresh state (react-components-and-hooks).

## 5. Async acquisition: a subscription that arrives later

Some APIs hand you the subscription asynchronously: `Location.watchPositionAsync(options, callback)`
resolves with a subscription; an SDK's `connectAsync()` resolves with a session. If the cleanup runs
before the promise resolves, the cleanup has nothing to remove, and the subscription created afterwards
runs forever (location tracking, battery, a privacy indicator on iOS and Android).

```ts
useFocusEffect(() => {
  let isActive = true;
  let subscription: LocationSubscription | undefined;
  location
    .watchPositionAsync(options, onPosition)
    .then((created) => {
      if (isActive) subscription = created;
      else created.remove();                 // too late: release it at once
    })
    .catch(reportError);
  return () => {
    isActive = false;
    subscription?.remove();
  };
});
```

`effect-stale-result` fails an effect that awaits a `watch*Async()` call without such a guard.

## 6. Focus effects

`useFocusEffect` (exported by expo-router) runs on focus and cleans up on blur, not on unmount. A
stack screen that another screen covers stays mounted, and so do inactive tabs; their `useEffect`s
keep running (listeners-and-timers.md, section 6). Work that only makes sense while the user looks at
the screen (polling, a countdown, sensors, location, an animation loop) belongs in `useFocusEffect`,
with the same cleanup rules as `useEffect`. With React Compiler on, pass it an inline function (the
compiler keeps it stable); without the compiler, wrap it in `useCallback` as the expo-router docs say.
`focus-scoped-work` fails a screen's `useEffect` that runs an interval, a `watch*Async()` subscription
or an expo-sensors listener.

## 7. Latest-wins outside effects (createLatestRequest)

Search as you type over on-device data, a filter switch over a repository, pull-to-refresh of an SDK
read while a load runs: one action, many overlapping calls, and only the newest may write (a server
search or filter is a `useQuery` key instead). The template `src/core/async/latest-request.ts` holds one
`AbortController` per action; `start()` aborts the previous call and returns the new signal:

```ts
const [latest] = useState(createLatestRequest);               // one per action, per mounted model
useEffect(() => () => { latest.cancel(); }, [latest]);        // unmount cancels whatever runs
const search = async (text: string): Promise<void> => {
  const signal = latest.start();
  if ((await delayOrAbort(SEARCH_DEBOUNCE_MS, signal)) === 'aborted') return;   // debounce
  const result = await withTimeout((inner) => taskDetails.search(text, inner), SEARCH_DEADLINE_MS, signal);
  if (signal.aborted) return;                                 // a newer keystroke owns the screen
  setState(toSearchState(result));
};
const onQueryChange = (text: string): void => {
  setQuery(text);
  search(text).catch(reportError);
};
```

The signal does both jobs: work that accepts it stops; work that cannot be stopped (SQLite, an SDK
without cancellation) has its result dropped by the `signal.aborted` check.

An effect may call such an action directly (a first search for the route's initial text):
`useEffect(() => { search(initialText).catch(reportError); }, [initialText]);` needs no cleanup of
its own, because the next run's `start()` aborts the older call and the unmount effect above cancels
the last. `check-async-safety` accepts that shape when the action calls `latest.start()`, reads
`.aborted` and the file calls `latest.cancel()`. When the latest request lives elsewhere (a ref, a
store, another file), return `() => { latest.cancel(); }` from the effect itself. A `useRef` holding the
controller works too, but reading `ref.current` in an effect cleanup draws an `exhaustive-deps`
warning, and the holder in `useState` is simpler. Imitate `examples/use-task-search-model.ts`.

## 8. The first read racing the change event

Mirroring an outside value that has both a change event and an async "read it now" call (network
state, a permission, an accessibility switch, a purchase status):

1. Subscribe first, so no change is missed between the read and the subscription.
2. Then read. A change event that arrives while the read is in flight is newer than the read: it
   cancels the read (`firstRead.cancel()`), and the late read result is dropped.

```ts
const firstRead = createLatestRequest();
const signal = firstRead.start();
const unsubscribe = source.subscribe((status) => {
  firstRead.cancel();
  onStatus(status);
});
source.current().then((status) => { if (!signal.aborted) onStatus(status); }).catch(onError);
return () => { firstRead.cancel(); unsubscribe(); };
```

Read first and subscribe second, and a change in between is lost until the next one; read without the
cancel, and a stale "online" can overwrite a fresh "offline". Imitate `examples/watch-sync-status.ts`.
A boolean "an event already arrived" flag is the same idea and fine for a module that lives for the
whole app (networking-and-server-state's connectivity adapter does exactly that).

## 9. Writes: never twice, never cancelled half-way

Latest-wins is for reads. A write (save, purchase, delete, send) is different:

- **Never abort a write to make room for a newer one.** An aborted request may still have reached the
  server or the database; the client then believes a write failed that succeeded. Queue writes, or
  coalesce them (save the latest draft once the previous save settles).
- **One in flight per action.** A second tap while the first save runs is ignored or disabled: the
  model exposes `isSaving`, the button shows busy and does nothing while busy. A double-submitted
  purchase or message is a real defect, not a cosmetic one.
- **Keep the user's input until the write returns ok** (error-handling-typed-results rule 12).
- **A write outlives its screen.** Leaving the editor does not cancel the save; its continuation may
  update a store (fine) but must not navigate (section 10).

## 10. Navigating after an await

`await save(); router.back();` pops whatever screen is on top when the save returns. If the user
already left (back gesture, Android back, a tab switch), `router.back()` pops the wrong screen. Either
navigate first and let the write finish in the background (optimistic), or navigate only while the
screen is still focused: in an effect, the controller pattern of section 2 (blur runs the
`useFocusEffect` cleanup); in a handler, check `navigation.isFocused()` (from `useNavigation()`) after
the await. `effect-stale-result` counts `router.*`/`navigation.*` calls after async work as writes.

## 11. Async work around a synchronous store

A Zustand store never awaits (state-management-zustand, `check-stores` `[store-async]`; its
store-pattern.md section "Async work around a synchronous store" is the rule). The races live in the
hook or service that starts the work, and only the result enters the store:

```ts
// src/features/backup/use-restore-backup.ts: the hook owns the request; the store stays synchronous.
export function useRestoreBackup(): (file: BackupFile) => void {
  const { backup, errorLog } = useServices();
  const stores = useStores();
  const [latestRestore] = useState(createLatestRequest);
  useEffect(() => () => { latestRestore.cancel(); }, [latestRestore]);
  return (file) => {
    const signal = latestRestore.start();
    backup
      .read(file, signal)
      .then((result) => {
        if (signal.aborted) return;          // a newer restore or the unmount won
        if (result.ok) updateAndPublish(stores, () => backup.apply(result.value));
      })
      .catch((error: unknown) => { errorLog.record('storage', error); });
  };
}
```

- One `createLatestRequest()` per operation, held by the hook (`useState` initializer) or by the
  service, never by the store factory.
- After each `await` (or in each `.then`), return when `signal.aborted`, then call the store's
  synchronous method, or `updateAndPublish` when the result changes rows several stores hold.
- A write is never aborted for a newer one; it is queued (section 9).
- Whoever started the request cancels it: the effect cleanup above, or the service's `dispose()`
  called by the composition root.

## 12. Platform notes

- **iOS and Android alike:** the JS rules here are platform-neutral; Hermes runs the same promise and
  timer semantics on both (New Architecture, React Native 0.86).
- **Android back** pops a screen without any JS of yours running first: a request in flight must not
  assume its screen still exists (sections 2 and 10).
- **Interactive back gestures** (iOS swipe back; Android predictive back when the app opts in) can be
  started and then cancelled. React Navigation, which Expo Router runs on, fires blur only when the
  screen really leaves, so a `useFocusEffect` cleanup does not run for a cancelled gesture (its
  documented behaviour; not run on a device by this library). Never start or stop work from gesture
  progress; tie it to focus.
- **App backgrounding** does not unmount anything; see listeners-and-timers.md, section 5.
