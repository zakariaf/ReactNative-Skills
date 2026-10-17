# Testing the network layer and server state

Which seam each test uses, so no test reaches the network, none replaces a global, and each layer is
proved once. The forms (renderWithProviders, renderHookWithProviders, the no-providers marker, fake
timers policy) belong to unit-and-component-tests; this file says how they apply here.

## Contents

1. The seams, layer by layer
2. The transport: a fake fetch
3. Query and mutation factories: plain Jest, a test QueryClient
4. Model hooks: the fake ApiClient through the test app
5. Managers, focus and offline
6. Optimistic updates and held answers
7. Timing without fake timers
8. What never to do in a test
9. Device checks that Jest cannot make

## 1. The seams, layer by layer

| Layer | Seam | Template test |
|---|---|---|
| `fetch-api-client.ts` | `createFetchApiClient({ fetch: fakeFetch })` | `src/api/fetch-api-client.test.ts` |
| status and error conversion | pure functions | `src/api/to-api-failure.test.ts`, `api-failure.test.ts`, `build-url.test.ts` |
| query factories | `createFakeApiClient()` + a test `QueryClient` | `src/api/tasks/task-queries.test.ts` |
| mutation factories | the same, through a `MutationObserver` | `src/api/tasks/task-mutations.test.ts` |
| the client factory | `createQueryClient({ errorLog: createFakeErrorLog() })` | `src/api/create-query-client.test.ts` |
| managers and provider | `createFakeConnectivity()` + a fake AppState source | `src/api/query-managers.test.ts`, `query-provider.test.tsx` |
| connectivity adapter | `jest.mock('expo-network')` (a native module: the one allowed module mock) | `src/services/connectivity/expo-network-connectivity-adapter.test.ts` |
| model hooks | the fake ApiClient as the `api` port of the test app | `examples/use-tasks-model.test.tsx` |

Each layer trusts the one below it: a model hook test never asserts on URLs, a query factory test never
asserts on headers.

## 2. The transport: a fake fetch

`FetchLike` is the narrow fetch the client calls, so a test passes a function that returns
`{ ok, status, headers: { get }, text }` or rejects. Cases worth a test each (all in the template):
2xx with a valid body, 204 with `NO_CONTENT`, a body that fails the schema (recorded once, without the
body), non-JSON 2xx, each status family, a rejection (`network-unavailable`), the
deadline (`timeoutMs: 5` and a fetch that never settles until aborted), a body that stalls after the
headers, a caller abort before and during the request, a `headers()` that rejects, and the idempotency and
content-type headers. `Retry-After` parsing and the status table are tested on the pure functions in
`to-api-failure.test.ts`.

## 3. Query and mutation factories: plain Jest, a test QueryClient

```ts
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const api = createFakeApiClient();
api.respond('GET', '/tasks', { items: [TASK] });
await expect(queryClient.query(taskQueries.list(api, 'all'))).resolves.toEqual([TASK]);
expect(api.calls()[0]?.signal).toBeInstanceOf(AbortSignal);
```

- `retry: false` makes a failure fail at once; `gcTime: Infinity` leaves no garbage-collection timer
  running after the test (Jest would report an open handle).
- The fake validates canned bodies through the request's schema, so the factory test proves the schema
  (an unknown priority reads as `'normal'`, an extra field is dropped).
- An unscripted request rejects naming `METHOD path`: a test never passes against a request it did not
  expect.
- These files import no React and render nothing: they need no providers and carry no marker.

## 4. Model hooks: the fake ApiClient through the test app

The test app (`test/test-app.tsx`, unit-and-component-tests) builds a fresh `QueryClient` per render
(no retries, `gcTime: Infinity`) and returns it in the render result, with the ports the test gave:

```ts
const api = createFakeApiClient();
api.respond('GET', '/tasks', { items: [TASK] });
const { result, queryClient } = await renderHookWithProviders(() => useTasksModel(), {
  services: { api, errorLog: createFakeErrorLog() },
});
await waitFor(() => { expect(result.current.tasks).toHaveLength(1); });
```

- Seed the cache with `queryClient.setQueryData(taskKeys.list('all'), [...])` to test the ready state
  without a request; read it after a mutation to test cache effects.
- A hook that reads `useIsFocused` (`subscribed: isFocused`) needs a route: render it with
  `renderRouterWithProviders` (unit-and-component-tests), as the example does.
- The app's `createTestServices` gains `api` and `connectivity` members when the app adds the ports
  (`examples/composition-root/create-test-services.ts`); an unexpected port use throws and names it.

## 5. Managers, focus and offline

- `connectQueryManagers` takes `{ appState, connectivity }`: tests pass a fake AppState source (an
  object with `currentState` and `addEventListener`) and `createFakeConnectivity(false)`, then assert
  `focusManager.isFocused()` and `onlineManager.isOnline()` as the fakes change.
  `connectivity.setReachability('unvalidated')` proves that an Android network without validation
  keeps queries running (only `'none'` pauses them); a banner test reads `reachability()` the same way.
- **The managers are module singletons.** A test that changes them restores them (call the returned
  disconnect, or `onlineManager.setOnline(true)` in a `finally`), or the next test file in the same
  worker starts offline.
- Paused behaviour: with the fake connectivity offline, a query's `fetchStatus` is `'paused'` and the
  fake ApiClient records no call; `setOnline(true)` resumes it.

## 6. Optimistic updates and held answers

`api.hold('PATCH', '/tasks/t1')` returns `{ release }`: the request waits until the test releases it
with `{ body }` or `{ failure }` (or until its signal aborts, which settles as `cancelled`). That makes
the in-flight moment observable:

1. seed two lists, `hold` the write, start the mutation, `await flushMicrotasks()`;
2. assert the optimistic value in every list;
3. `release({ failure: { kind: 'server-unavailable', status: 503 } })`, await the mutation;
4. assert the snapshot is back, and that an invalidation was triggered (`queryClient.getQueryState(key)?.isInvalidated`).

## 7. Timing without fake timers

unit-and-component-tests keeps fake timers out of logic tests. Here that works because every delay is
injectable or short: the transport's deadline is `timeoutMs` (5 ms in tests, real time), retries are
off in the test client, `queryRetryDelay` and `shouldRetryQuery` are pure functions tested directly, and
`flushMicrotasks()` (`test/flush-microtasks.ts`) settles promise chains. A test that needs to wait for
React uses RNTL's `waitFor`.

## 8. What never to do in a test

- Replace the global fetch (`jest.spyOn(globalThis, 'fetch')`, `global.fetch = ...`,
  `jest.mock('expo/fetch')`): it leaks across tests and tests no seam the app uses (`test-fetch-mock`).
- `jest.mock('@/api/...')` of the app's own modules: pass the fake ApiClient as a port instead.
- Share one `QueryClient` between tests (a module-level client): cached data and pending retries leak.
- Assert on `error.message`: assert on `apiFailureOf(error)?.kind`.
- Run a real server in unit tests. Contract tests against a staging API, if the app has them, run in
  their own CI job, never in `npm test`.

## 9. Device checks that Jest cannot make

Jest runs Node's fetch and no native networking. Once per networking change, on a named simulator and
emulator (e2e-maestro for automation): airplane mode on a list screen (cached data stays, the notice
shows, nothing spins forever), a write while offline then reconnect (it syncs once), background the app
for longer than `staleTime` and return (it refetches), and a release (preview) build against the real
HTTPS endpoint (no cleartext surprises). Say in the report which of these ran.
