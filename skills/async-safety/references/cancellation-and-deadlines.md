# Cancellation and deadlines

AbortController on a React Native device is not the AbortController of Node, Jest or a browser. This
reference holds the verified API differences, the one rule that survives them (ask the signal, not the
error), the deadline helper, the abortable pause, bounded retries, and how a signal travels through
the app's ports. Read it before writing any code that aborts, times out, retries or waits.

## Contents

1. What the device really has (verified table)
2. expo/fetch: what an aborted request rejects with
3. The rule: cancellation is read from the signal
4. Cancelled is an outcome, not a failure
5. Passing signals through ports and adapters
6. Deadlines: withTimeout
7. Pauses: delayOrAbort
8. Bounded retries with backoff
9. What cannot be cancelled
10. Server state: TanStack Query owns its own cancellation

## 1. What the device really has (verified table)

React Native 0.86.3 installs `AbortController` and `AbortSignal` from the `abort-controller` 3.0.0
package (`Libraries/Core/setUpXHR.js`, `polyfillGlobal`, which replaces any engine global). Expo SDK 57
then loads its WinterCG runtime (`expo/src/winter/runtime.native.ts`, imported by `expo`): it installs
a global `DOMException` and patches the static `AbortSignal.timeout()` and `AbortSignal.any()` onto the
polyfill. Jest runs on Node 26, whose native AbortController has everything. So:

| API | iOS / Android (RN 0.86.3 + Expo 57.0.26) | Jest (Node) | Rule |
|---|---|---|---|
| `new AbortController()`, `.abort()`, `signal.aborted` | yes | yes | use these |
| `signal.addEventListener('abort', fn)` / `removeEventListener` | yes (event-target-shim 5.0.1) | yes | remove by hand |
| `addEventListener(type, fn, { once: true })` | yes | yes | fine |
| `addEventListener(type, fn, { signal })` | **ignored**: the listener stays | yes | `abort-signal` |
| `controller.abort(reason)` then `signal.reason` | **undefined** (the polyfill takes no reason) | the reason | `abort-signal` (reading `.reason`) |
| `signal.throwIfAborted()` | **missing** (TypeError) | yes | `abort-signal` |
| `AbortSignal.abort()` (static) | **missing** | yes | `abort-signal` |
| `AbortSignal.timeout(ms)` | yes (Expo patch; its signal sets `reason` to a `TimeoutError` DOMException; the timer is never cleared early) | yes | allowed; prefer `withTimeout` |
| `AbortSignal.any(signals)` | yes (Expo patch; it removes its listeners only when one source aborts) | yes | allowed with long-lived sources in mind |
| global `DOMException` | yes (Expo runtime) | yes | do not decide cancellation by it (section 2) |

Verified on 2026-10-04 by reading the installed sources and by loading the polyfill under Node:
`node -e "const {AbortController}=require('abort-controller'); const c=new AbortController(); c.abort(new Error('x')); console.log(c.signal.reason, typeof c.signal.throwIfAborted)"`
prints `undefined undefined` (run it inside the app's `node_modules`), while the same lines in a Jest
test print the reason and `function`. Re-verify after an SDK upgrade with
`grep -n AbortController node_modules/react-native/Libraries/Core/setUpXHR.js` and
`cat node_modules/expo/src/winter/AbortSignal.ts`.

This is the trap: a test that calls `signal.throwIfAborted()` or reads `signal.reason` passes in Jest
and throws, or silently misbehaves, on every phone. `check-async-safety` (`abort-signal`) is the only
gate that sees it before a device does.

## 2. expo/fetch: what an aborted request rejects with

On iOS and Android, Expo SDK 57 installs `expo/fetch` as the global `fetch` (unless the app sets
`EXPO_PUBLIC_USE_RN_FETCH=1`; Expo's SDK 57 `expo` page says so). Reading `expo/src/winter/fetch/fetch.ts`
(expo 57.0.26):

- a signal that already aborted before the request starts: rejects with a `FetchError` whose message
  is `fetch failed: The operation was aborted.` (its `name` is `Error`);
- an abort while the request runs: the native request is cancelled and the promise rejects with a
  `FetchError` wrapping the native error (`fetch failed: ...`), not an `AbortError`;
- an abort while the body is being read: the read rejects with the signal's `reason` when it has one,
  else with a `DOMException` named `AbortError`.

React Native's own fetch (whatwg-fetch 3.6.20, when `EXPO_PUBLIC_USE_RN_FETCH=1`) rejects with a
`DOMException('Aborted', 'AbortError')`, and Node's fetch in Jest with an `AbortError` too. So
`error.name === 'AbortError'` works in Jest, works with React Native's fetch, and misses most aborted
requests on a device with the default fetch. (Verified by reading the source, not run on a device.)

## 3. The rule: cancellation is read from the signal

Whoever aborted owns the signal, so ask it. The one `fetch` of the app sits in the `ApiClient`
adapter in `src/api/` (networking-and-server-state owns it); every other adapter decides the same way:

```ts
try {
  const response = await fetch(url, { signal });
  return ok(await response.json());
} catch (error: unknown) {
  if (signal.aborted) return err({ kind: 'cancelled' });   // whatever the error looks like
  return err(toNetworkFailure(error));
}
```

`abort-signal` fails `error.name === 'AbortError'` comparisons and `instanceof DOMException` checks:
both decide cancellation by the error's shape, which differs per fetch implementation and per phase
of the request. A signal you did not create (`AbortSignal.timeout(8000)`) is still yours to ask:
keep it in a variable (`const deadline = AbortSignal.timeout(8000)`) and read `deadline.aborted`.

## 4. Cancelled is an outcome, not a failure

- A cancelled call shows nothing (no error banner, no toast) and records nothing (no error-log entry).
  The user caused it, by typing, leaving or retrying.
- In a Result-returning port, cancellation is its own failure kind (`{ kind: 'cancelled' }`) so callers
  switch on it exhaustively and drop it; the template `withTimeout` returns it as `Cancelled`.
- In an effect or a `.catch`, `if (signal.aborted) return;` comes first.
- A timed-out call is different: the user is waiting, so it is a failure with a message and a retry
  (`{ kind: 'timed-out', afterMs }`), mapped to a translated message (error-handling-typed-results).

## 5. Passing signals through ports and adapters

- Every port member that does I/O and can be abandoned takes `signal: AbortSignal` as its last
  parameter (`load(taskId, signal)`), as in `examples/task-details-port.ts`.
- The adapter hands it to whatever accepts one: an SDK option, `fetch(url, { signal })` inside the
  `ApiClient`. It never creates its own controller for the caller's work. (A screen reads server data
  with `useQuery`, whose `queryFn` receives TanStack's signal: section 10.)
- An adapter whose SDK cannot cancel still checks `signal.aborted` after each await and returns
  `cancelled`, so callers see one behaviour.
- A fake port (`fake-<concern>.ts`) records the signals it was given, so a test can assert that leaving
  the screen aborted the request (test-recipes.md).

## 6. Deadlines: withTimeout

`templates/src/services/async/with-timeout.ts`:

```ts
const result = await withTimeout(
  (signal) => attemptAsync(() => api.get('/tasks', { signal }), toTaskFailure),
  8_000,
  callerSignal,                 // optional: the effect's or the latest request's signal
);
// result: Result<Task[], TaskFailure | TimedOut | Cancelled>
```

- The task receives its own signal, which aborts at the deadline and when the caller's signal aborts,
  so the abandoned request stops instead of finishing and writing later.
- The timer is cleared and the caller listener removed however it ends (`finally`), so nothing fires
  afterwards and `jest.getTimerCount()` is 0 in tests.
- It never rejects while the task never rejects: pair it with `attemptAsync` (error-handling-typed-results),
  whose checker also accepts awaits inside `withTimeout(...)` in adapters.
- This signature is the canonical one: async-safety owns `src/services/async/with-timeout.ts`.
- Migrating an app's own `with-timeout.ts`: a form that takes a started promise
  (`withTimeout(sdk.fetch(), 8000)`) stops type-checking once this file replaces it; rewrite each call
  to hand over a task, `withTimeout((signal) => attemptAsync(() => sdk.fetch({ signal }), toFailure), 8_000)`.
  A zero-argument task (`withTimeout(() => attemptAsync(...), 8_000)`) still type-checks (a function
  with fewer parameters is assignable) and gets the deadline, but cannot stop the abandoned work, so
  take the signal parameter whenever the work accepts one.
- Pick deadlines per call kind and keep them as named constants: a user-visible lookup (8 s), a
  background sync (30 s), an SDK initialisation (10 s). A deadline that is too short on a slow cellular
  network is a bug of its own.

## 7. Pauses: delayOrAbort

`templates/src/services/async/delay-or-abort.ts` resolves `'elapsed'` or `'aborted'` and never
rejects. Use it for debounce, polling gaps and retry backoff:

```ts
if ((await delayOrAbort(250, signal)) === 'aborted') return;
```

`await new Promise((resolve) => setTimeout(resolve, ms))` cannot be cancelled: the loop that owns it
keeps sleeping and then acting after its screen is gone, and the timer id is dropped (`timer-cleared`
fails it). In tests, unit-and-component-tests' `test-sleep` rule bans sleeping; drive `delayOrAbort`
with fake timers instead.

## 8. Bounded retries with backoff

Server-state retries belong to TanStack Query's retry policy (networking-and-server-state). For the
rest (opening a store connection, an SDK that is briefly busy), a retry loop is bounded, backs off,
and stops when its signal aborts:

```ts
const BACKOFF_MS = [500, 1_000, 2_000, 4_000] as const;

async function connectWithRetry(sdk: StoreSdk, signal: AbortSignal): Promise<Result<void, ConnectFailure>> {
  for (const waitMs of [0, ...BACKOFF_MS]) {
    if (waitMs > 0 && (await delayOrAbort(waitMs, signal)) === 'aborted') return err({ kind: 'cancelled' });
    const result = await sdk.connect(signal);
    if (result.ok || !isRetryable(result.error)) return result;
  }
  return err({ kind: 'unavailable' });
}
```

- A fixed table of waits instead of `2 ** n` keeps the bound visible and the code deterministic.
- Retry only failures that can succeed later (busy, offline, timed out), never "invalid" or "denied".
- Jitter, when several devices would retry in lockstep against one server, comes from an injected
  random source, never `Math.random()` (typescript-and-lint-rules).

## 9. What cannot be cancelled

expo-sqlite queries, most native SDK calls and CPU work on the JS thread run to completion once
started. Aborting their signal does not stop them; it only lets your code drop the result (`if
(signal.aborted) return;`). Two consequences: a cancelled write may still have happened (effects-and-races.md,
section 9), and a long synchronous loop must check `signal.aborted` between chunks if it should stop.

## 10. Server state: TanStack Query owns its own cancellation

With TanStack Query v5 (5.104.0), the query function receives `{ signal }`; when the code reads it,
the query becomes cancellable: the last observer unmounting, `queryClient.cancelQueries(...)` or a
newer fetch for the same key aborts it (verified in `@tanstack/query-core`: reading `signal` marks the
abort signal as consumed). Forward that signal to the ApiClient. Query keys already give latest-wins
per key, so a screen built on `useQuery` needs neither `createLatestRequest` nor an effect.
networking-and-server-state owns the ApiClient, the query keys and the retry policy; this skill only
asks that the signal is forwarded and that `cancelled` is never shown as an error. A mutation awaits
the promise its `onMutate`, `onSuccess`, `onError` and `onSettled` return, so return the invalidation
from them (`onSettled: () => queryClient.invalidateQueries(...)`) instead of ending it with `.catch`;
`async-by-reference` leaves those four alone inside `mutationOptions(`, `useMutation(` and
`new MutationCache(` (checker-rules.md, section 5).
