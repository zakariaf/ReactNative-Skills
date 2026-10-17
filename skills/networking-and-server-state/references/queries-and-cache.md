# Queries, keys and the cache (TanStack Query 5.104)

How reads are defined, keyed, kept fresh, retried and shown, in a React Native app where screens stay
mounted in stacks and there is no browser window. `@tanstack/react-query` 5.104.0 (the house pin),
verified on 2026-10-04 by reading `node_modules/@tanstack/query-core/build/modern/` in an installed
Expo SDK 57 app; re-verify with `npm view @tanstack/react-query version` and the greps in section 10.

## Contents

1. Defaults worth knowing
2. Query options are defined once, in src/api
3. Key factories
4. The retry policy
5. Freshness: staleTime, gcTime, refetch triggers
6. Screens that stay mounted: subscribed and focus refetch
7. Reading query state in the model hook
8. Dependent, conditional, paged and prefetched queries
9. What not to do with server state
10. Verified facts and how to re-verify them

## 1. Defaults worth knowing

| Option | Default (client side) | This skill's default |
|---|---|---|
| `staleTime` | 0 (every mount and focus refetches) | 30 s (`DEFAULT_STALE_TIME_MS`), per query when it differs |
| `gcTime` | 5 min after the last observer leaves | kept |
| `retry` (queries) | 3, for every error | `shouldRetryQuery`: retryable ApiFailures only, at most 3 |
| `retryDelay` | `min(1000 * 2^n, 30000)` ms | `queryRetryDelay`: the same, or `Retry-After` for a 429 (capped at 60 s) |
| `retry` (mutations) | 0 | `false` (writes retry only with an idempotency key) |
| `networkMode` | `'online'`: no fetch while offline, the query is `paused` | kept |
| `refetchOnWindowFocus`, `refetchOnReconnect` | true, but driven by window events React Native does not have | wired to AppState and the ConnectivityPort (online-focus-and-offline.md) |

Retries also wait while the app is unfocused or offline (the retryer's `canContinue`), so a request
that failed in a tunnel resumes when the network returns instead of burning its attempts.

## 2. Query options are defined once, in src/api

```ts
// src/api/tasks/task-queries.ts
export const taskQueries = {
  list: (api: ApiClient, filter: TaskListFilter): ApiQueryOptions<TaskList, ReturnType<typeof taskKeys.list>> =>
    queryOptions({
      queryKey: taskKeys.list(filter),
      queryFn: ({ signal }) => unwrap(api.request({ method: 'GET', path: '/tasks', query: { filter }, schema: taskListSchema, signal })),
    }),
};
```

- `queryOptions` ties the key to the data type (a `DataTag` on the key), so
  `queryClient.getQueryData(taskKeys.list('all'))`, `setQueryData` and `useQuery(taskQueries.list(...))`
  all agree without casts. The checker requires every `queryFn` in `src/api/` to sit inside
  `queryOptions(...)` or `infiniteQueryOptions(...)` (`query-options`).
- Factories take the `ApiClient` as their first argument; the model hook passes `useServices().api`.
  No React in `src/api/<resource>/`: the factories run in plain Jest against a fake client.
- Exported factories name their return type (lint: explicit module boundary types); `ApiQueryOptions`,
  `ApiInfiniteQueryOptions` and `ApiMutationOptions` in `src/api/api-query-options.ts` spell them.
- A model hook may spread options to add view concerns: `useQuery({ ...taskQueries.list(api, 'all'),
  select, subscribed })`. The `queryFn` and key stay in `src/api/`; a `queryFn` written in a feature is
  a finding.
- Imperative reads use the same options: `queryClient.query(taskQueries.detail(api, id))` (5.104
  deprecates `fetchQuery`, `prefetchQuery` and `ensureQueryData` in favour of `query` and
  `infiniteQuery`; `ensureQueryData` becomes `query({ ...options, staleTime: 'static' })`).

## 3. Key factories

```ts
const ALL = ['tasks'] as const;
export const taskKeys = {
  all: ALL,
  lists: () => [...ALL, 'list'] as const,
  list: (filter: TaskListFilter) => [...ALL, 'list', { filter }] as const,
  pages: () => [...ALL, 'pages'] as const,
  details: () => [...ALL, 'detail'] as const,
  detail: (id: string) => [...ALL, 'detail', id] as const,
};
```

- **Hierarchical, general to specific.** Invalidation and cancellation match by prefix:
  `taskKeys.all` reaches every task query, `taskKeys.lists()` every list, `taskKeys.detail(id)` one task.
  The template test proves the hierarchy in a real cache.
- **Same shape under one prefix.** An updater written for `readonly ApiTask[]` must never reach data
  of another shape: the paged list (InfiniteData) is `['tasks', 'pages']`, outside `lists()`, so an
  optimistic `setQueriesData({ queryKey: taskKeys.lists() }, ...)` cannot corrupt it.
- **Everything the server answer depends on is in the key** (filter, search text, page size, the
  signed-in account when lists are per account). Objects in keys are hashed with sorted keys, so
  `{ filter, sort }` and `{ sort, filter }` are one query.
- **Inline keys are findings** (`query-key-factory`): `queryKey: ['task']` in a hook is one typo away
  from an invalidation that misses `['tasks']`. Mutation keys come from the factory too.

## 4. The retry policy

`createQueryClient` retries a query only for failures a later attempt may cure, at most 3 times:

| Failure | Retried | Why |
|---|---|---|
| `network-unavailable`, `timed-out` | yes | the next attempt may have a connection |
| `server-unavailable` (408, 5xx) | yes | the server may recover |
| `rate-limited` (429) | yes, after `Retry-After` (capped) | the server asked for it |
| any other 4xx, `invalid-response` | no | the same request gets the same answer; TanStack's default would spin ~7 s (1 + 2 + 4 s) before showing a 404 |
| `cancelled`, a bug (not an ApiError) | no | |

Mutations never retry by default: a retried POST without an idempotency key can create two tasks. A
write that sends `idempotencyKey` may set `retry: shouldRetryQuery`; the checker flags a retrying
mutation without one (`retry-policy`). `retry: true`, `Infinity` or more than 3 are findings anywhere.

The backoff has no jitter: randomness in app code goes through an injected source (the lint bans
`Math.random`), and for one user's device jitter matters little. A fleet-wide reconnect storm is the
server's rate limiter's job (it answers 429 with `Retry-After`, which the policy honours).

## 5. Freshness: staleTime, gcTime, refetch triggers

- `staleTime` says how long data counts as current: fresh data is served from the cache with no
  request when another screen mounts the same key. 30 s suits lists that change through this app;
  `Infinity` suits data that changes only through this app's own mutations (which invalidate it);
  0 suits data other people change often. Set it per query in its options, next to the key.
- `gcTime` (5 min) is how long an unobserved query's data stays for a quick return. Keep it; a
  persisted cache needs `gcTime` at least its `maxAge` (online-focus-and-offline.md).
- Stale data refetches on mount, on focus (AppState `active`) and on reconnect, once those managers
  are wired. `refetchInterval` (polling) pauses while unfocused by default
  (`refetchIntervalInBackground: false`); keep it that way on mobile, where background JS is suspended
  anyway.

## 6. Screens that stay mounted: subscribed and focus refetch

Expo Router stacks keep the previous screens mounted. Their queries stay observed, so they re-render
on every cache change and refetch on focus and reconnect while nobody sees them.

```ts
const isFocused = useIsFocused();                       // from expo-router (57.0.24 exports it)
const query = useQuery({ ...taskQueries.list(api, 'all'), subscribed: isFocused });
```

`subscribed: false` unsubscribes the observer: no re-renders, no fetches for that screen; it catches
up when the screen is shown again (TanStack's React Native guide recommends this pattern). For "refresh
when I come back to this screen", `useFocusEffect` (expo-router) can `refetchQueries({ queryKey,
stale: true, type: 'active' })` on every focus but the first. Both belong in the model hook.

## 7. Reading query state in the model hook

v5 splits two questions: `status` says whether there is data (`pending` = none yet, `success`,
`error`), `fetchStatus` says whether a request runs (`fetching`), waits for the network (`paused`) or
rests (`idle`).

| status | fetchStatus | data | The screen shows |
|---|---|---|---|
| pending | fetching | none | first load (a delayed skeleton, ui-states-and-feedback) |
| pending | paused | none | offline with nothing cached: "we'll load when you're back online", not an error |
| pending | idle | none | not started (a disabled query): its prerequisite |
| error | idle | none | the failure's message and a retry |
| success | fetching | yes | the list, with a quiet refreshing indicator |
| success / error | paused / idle | yes | the list, with an "offline" or "couldn't refresh" notice: never replace cached data with an error |

`examples/task-list-state.ts` turns this table into a pure function with a test per row. Show the
error that matters (`apiFailureOf(query.error)` mapped through the message table), never
`error.message`.

## 8. Dependent, conditional, paged and prefetched queries

- **Conditional:** `queryFn: id === null ? skipToken : ({ signal }) => ...` keeps the query typed and
  disabled until the input exists (the checker accepts `skipToken`). Prefer it to `enabled: false`
  with a non-null assertion inside the `queryFn`.
- **Dependent:** query B's options take query A's data as an argument and use `skipToken` until it is
  there; never chain requests inside one `queryFn` (one key would then cache two server answers).
- **Paged:** `infiniteQueryOptions` with `initialPageParam`, `getNextPageParam` and `maxPages`
  (examples/task-pages.ts). A refetch of an infinite query refetches every cached page in order from
  the first, so bound the pages; pass `signal` like any queryFn.
- **Prefetch:** `queryClient.query(options).catch(...)` before navigating, when the next screen is
  certain (opening a task from the list). Not on every row render.
- **Placeholder from the list:** a detail can start from the list's copy with
  `placeholderData: () => queryClient.getQueryData(taskKeys.list('all'))?.find(...)` while the real
  detail loads.

## 9. What not to do with server state

- **Copy it into a store or `useState`.** Two copies drift on every refetch (state-management-zustand
  owns the store side: its checker's `server-state-in-store` and `query-data-copied` rules flag query
  data, `src/api` values or fetch calls in `src/stores`; the ConnectivityPort and the outbox stay out of stores too). Derive in `select` or in the model hook.
- **Set state from a query in an effect.** Compute during render; an effect that copies data renders
  twice and lags a frame (react-components-and-hooks rule 3).
- **Hand-written `useMemo` around query results.** React Compiler memoizes; `select` runs only when
  the data changes.
- **Call `useQuery` in a screen, a row or a `src/ui` component.** The model hook reads server state
  and hands the view props (`query-hook-home`).

## 10. Verified facts and how to re-verify them

| Fact | Re-verify (query-core 5.104 build) |
|---|---|
| Default retry 3 and delay `min(1000*2^n, 30000)`; retries pause while unfocused or offline | `sed -n 1,140p node_modules/@tanstack/query-core/build/modern/retryer.js` |
| Mutations default `retry: 0` | `grep -n "retry" node_modules/@tanstack/query-core/build/modern/mutation.js` |
| An in-flight fetch is cancelled on last unsubscribe only when the signal was read | `grep -n "abortSignalConsumed" node_modules/@tanstack/query-core/build/modern/query.js` |
| `fetchQuery`, `prefetchQuery`, `ensureQueryData` deprecated for `query` | `grep -n "@deprecated" -A2 node_modules/@tanstack/query-core/build/modern/hydration-*.d.ts` |
| Mutation callbacks receive `{ client, meta, mutationKey }` as their last argument | `grep -n "type MutationFunctionContext" -A5 node_modules/@tanstack/query-core/build/modern/hydration-*.d.ts` |
| `subscribed` option on useQuery | `grep -n "subscribed" node_modules/@tanstack/react-query/build/modern/types.d.ts` |
| expo-router exports `useIsFocused` and `useFocusEffect` | `grep -n "useIsFocused\|useFocusEffect" node_modules/expo-router/build/exports.d.ts` |

Mutation callbacks have up to five positional parameters, more than the house limit of three, so the
mutation factories take the `QueryClient` as an argument and close over it instead of reading
`context.client`.
