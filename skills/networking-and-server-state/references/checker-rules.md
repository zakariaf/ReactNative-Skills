# check-server-state: rules, scope and escapes

What `scripts/check-server-state.mjs` reads, each rule id with what it flags, and the only accepted
ways to tell it that a flagged shape is deliberate. `--help` prints the same list.

## Contents

1. Scope and outcomes
2. ApiClient rules
3. TanStack Query rules
4. Markers
5. Layout keys and monorepos
6. Known limits

## 1. Scope and outcomes

- **App code** is every `.ts/.tsx/.js/.jsx/.mjs/.cjs` file under `srcDir` (default `src`) and the
  routes folder, without tests, `.d.ts` files, and Expo Router server files (`+api.ts`,
  `+middleware.ts`, which run on a server, not in the app). **Tests** (`*.test.*`, `*.spec.*`,
  `__tests__/`, root `__mocks__/`) are read only by `test-fetch-mock`.
- The walk skips `node_modules`, generated native folders, build output, and every folder holding a
  `SKILL.md` (installed skills under `.agents/skills/`, `.claude/skills/`, `skills/`, vendored kits).
- **NOT APPLICABLE** when no app code imports `@tanstack/react-query`, no app code calls the network
  or imports an HTTP client, and there is no `src/api/` folder: an offline app. (Its no-network
  guarantee is privacy-and-store-declarations' `offline-only` profile.)
- **SKIP** only `src/app/_layout.tsx [managers-wired]` while the root layout does not exist and no
  other file mounts the provider (navigation-and-routing creates the layout).
- The query rules run only when app code imports `@tanstack/react-query`; the ApiClient rules run as
  soon as there is network code or a `src/api/` folder.
- Exit 0 pass, 1 problems, 2 bad input (no `package.json`, invalid JSON, unknown option).

## 2. ApiClient rules

| Rule | Flags | Fix |
|---|---|---|
| `network-call` | `fetch()`, `globalThis.fetch`, the `fetch` global passed on as a value, `new XMLHttpRequest`, `new WebSocket`/`EventSource`, `navigator.sendBeacon` outside `src/api/`; an import of an HTTP client (`axios`, `ky`, `got`, `node-fetch`, `cross-fetch`, `expo/fetch`, ...) anywhere | request through the ApiClient; `deviceFetch` in `fetch-api-client.ts` is the one place the global is named |
| `api-client` | `src/api/api-client.ts` without `export type ApiClient`, `src/api/api-failure.ts` without `export type ApiFailure`; no file in `src/api/` calls fetch; a second one does | copy the templates; delete the second transport |
| `transport-boundary` | in the transport, an awaited fetch or body read outside `try { } catch` (or `attemptAsync`/`withTimeout` arguments) | the ApiClient never rejects: catch and return `err(failureFromThrown(...))` |
| `request-timeout` | the transport neither aborts after a `setTimeout` nor uses `AbortSignal.timeout` | one deadline per attempt (Android's OkHttp has no timeout) |
| `validated-response` | the transport runs no `safeParse`/`parse`, or does not `record` an invalid response near it; `.json()`/`JSON.parse` elsewhere in `src/api/`, `.json()` in other app code; parsed JSON cast `as Type`; a `.request({ method, ... })` without `schema` | every body through its schema, in the transport |
| `response-schema` | `v.strictObject` in `src/api/`; `v.picklist`/`v.enum` there outside `v.fallback(...)` | tolerant reading (schemas-and-failures.md) |
| `base-url` | a remote URL literal in `src/api/`; `baseUrl: '<literal>'` anywhere in app code | the base URL comes from `src/config` |
| `cleartext` | `NSAllowsArbitraryLoads: true` or `usesCleartextTraffic: true` in `app.config.ts`/`.js` or `app.json` (comments ignored); an `http://` URL to a host other than localhost, 127.0.0.1, 10.0.2.2 or [::1] in `src/api/` or `src/config/` | HTTPS per environment |
| `test-fetch-mock` | `jest.spyOn(globalThis, 'fetch')`, `global.fetch = ...`, `jest.mock('expo/fetch')` in a test | a fake `FetchLike` or the fake ApiClient |

## 3. TanStack Query rules

| Rule | Flags | Fix |
|---|---|---|
| `query-signal` | a `queryFn` whose body never uses `signal`: destructuring `({ signal })` without handing it to the request does not count (TanStack then aborts while the request runs on); a single context parameter handed on whole counts; a same-file function it names is followed; `skipToken` is fine | `({ signal }) => unwrap(api.request({ ..., signal }))` |
| `query-key-factory` | an inline `queryKey`/`mutationKey` array, or an array literal passed to `setQueryData`, `getQueryData`, `getQueryState`, `getQueriesData`, `ensureQueryData`, `prefetchQuery`, `fetchQuery`, outside `*-keys.ts`; a key factory without an `all` key and `as const` | keys from `<resource>-keys.ts` |
| `query-options` | a `queryFn` or `mutationFn` outside `src/api/`; a `queryFn` in `src/api/` outside `queryOptions(...)`/`infiniteQueryOptions(...)`; an ApiClient `.request({ method, path })` outside `src/api/` | factories in `src/api/<resource>/` |
| `query-hook-home` | TanStack hooks (`useQuery`, `useMutation`, `useQueryClient`, `useInfiniteQuery`, `useQueries`, suspense variants, `useIsFetching`, `useIsMutating`, `useMutationState`, `usePrefetch*`) outside `src/features/**/use-*.ts(x)`, `src/hooks/` and `src/api/` | read server state in the model hook |
| `query-client` | no `new QueryClient` factory in `src/api/`; `new QueryClient` elsewhere in app code; a client created at module level, or in a component or hook body outside a `useState` initializer | create it once in AppRoot's `startApp` (a `useState` initializer) |
| `retry-policy` | `retry: true`, `Infinity` or more than 3; the factory keeps TanStack's default retry (no retry function); a mutation that retries without `idempotencyKey` | `shouldRetryQuery`, `queryRetryDelay`; idempotent writes only |
| `managers-wired` | nothing calls `onlineManager.setEventListener`, or `focusManager.setEventListener`/`setFocused`; no file outside `src/api/` renders `<QueryProvider>` (or `<QueryClientProvider>` and imports the wiring) | `query-managers.ts` + `QueryProvider` in the root providers |
| `connectivity-port` | `src/services/connectivity/connectivity-port.ts` missing; any app file other than `src/services/connectivity/*-adapter.ts` (platform suffixes included) importing `expo-network` or `@react-native-community/netinfo`, the onlineManager wiring and screens alike; a listener passed to `onlineManager.setEventListener(...)` that reads `.reachability()`, `.subscribeReachability()` or `isInternetReachable` | the canonical port and adapter; read `services.connectivity` |
| `mutation-cache` | a mutation options object whose `onSuccess`/`onSettled` invalidates, sets, removes, refetches or resets nothing, without the marker; a function the callback calls or names is followed when it is declared in the same file or imported from a sibling module (`./task-cache`) | a cache effect (inline or in such a helper), or the marker |
| `optimistic-rollback` | an `onMutate` that writes the cache without `cancelQueries` first, without a `getQueryData`/`getQueriesData` snapshot, without an `onError` that restores it, or without an `onSettled` that invalidates (`onError` and `onSettled` helpers are followed like `mutation-cache`'s) | the four steps (mutations-and-optimistic-updates.md) |
| `network-mode` | `networkMode: 'always'` without the marker | keep `'online'` |
| `persist-cache` | a persisted query cache (persist-client packages) whose options lack `buster` or `maxAge`: an inline object, or a same-file `const options = { ... }` named by `persistOptions={options}` (shorthand keys count) | both (online-focus-and-offline.md section 7) |

## 4. Markers

A marker is a line comment inside the options object it excuses, with a reason of at least ten
characters. There are exactly two:

```ts
// no-cache-effect: reporting a crash changes no server state the app shows
// network-mode-always: reads the local outbox, never the network
```

Everything else is fixed in code, not excused: a false positive is a bug in the checker to report.

## 5. Layout keys and monorepos

Paths come from check-lib's `resolveLayout`: the defaults, `tsconfig.json` paths, `package.json`
workspaces, and the optional `rn-skills.config.json` keys `srcDir`, `routesDir`, `featuresDir`,
`apiDir`, `configDir`, `servicesDir`. Options `--src-dir <dir>` and `--api-dir <dir>` override them.

**When multi-package:** run the checker once per app workspace, with that app's folders:
`node <skill>/scripts/check-server-state.mjs . --src-dir apps/mobile/src --api-dir apps/mobile/src/api`.
A shared API package (`packages/api`) holds the port, the transport and the factories; the app keeps
its composition root, `QueryProvider` and model hooks. The rules are the same; only the folders move.

## 6. Known limits

- The source model is lexical (comments and strings blanked, brackets matched), not a type checker:
  a key array built in a variable and passed on, or a client created through an alias, is not seen.
  Code review and the template shapes cover those.
- `query-signal` follows a named function only within the same file.
- `mutation-cache` and `optimistic-rollback` follow a helper one level deep: a function declared in
  the same file, or imported by name from a sibling module of the same folder (`./task-cache`, not
  `@/api/...` or `../`). A helper that calls another helper, a method on an object
  (`taskCache.refresh()`), or a module elsewhere is not followed: inline the cache call in the
  helper the callback names. An `onMutate` that writes the cache only through a helper is not
  checked for the four steps.
- The reachability check of `connectivity-port` reads only the argument list of
  `onlineManager.setEventListener(...)`: a listener built by a named function elsewhere
  (`setEventListener(makeOnlineListener(connectivity))`) is not followed. Keep the listener inline,
  as the template does.
- `persist-cache` reads the options object written inline or a same-file `const`/`let` it names;
  options built elsewhere (imported, spread from another object, returned by a function) fall back to
  reading the 600 characters after `persistOptions`, so keep `buster` and `maxAge` in that object.
- **Enforced by the house ESLint config, not by this checker:** copying query data into `useState`
  or an effect (`useEffect(() => { setCopy(query.data ?? []); }, [query.data])`, rule 7) is
  react-hooks' `set-state-in-effect`; a screen or hook importing `expo-network` or NetInfo (rule 9)
  is also `no-restricted-imports` there (`connectivity-port` catches the import too). Run
  `npm run lint` (typescript-and-lint-rules) next to this checker.
- **URL literals in `src/api/`:** the house lint zone allows URL literals in `src/api/` and
  `src/config/`; `base-url` is stricter and allows remote URLs only in `src/config/` (the base URL
  comes from `EXPO_PUBLIC_API_URL`). When the two disagree, follow this checker.
- `cleartext` reads the app config at the repo root only; in a monorepo, check each app's
  `app.config.ts` by running the checker with that app folder as the repo root as well.
