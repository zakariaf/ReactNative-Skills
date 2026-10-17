# Response schemas and the ApiFailure family

What a response must pass before the app sees it, how schemas survive a server that keeps changing,
and how failures travel from the transport to the screen. valibot 1.5.0 (the house validator),
verified on 2026-10-04 (`node -p "require('valibot/package.json').version"` in an installed app).

## Contents

1. One schema per response, in `src/api/<resource>/<resource>-schemas.ts`
2. Tolerant reading: unknown keys, new enum values, nulls
3. Transforms: unwrap envelopes, keep wire names out of the app
4. Recording an invalid response without the user's data
5. The failure family and who handles which kind
6. From a Result to TanStack's error channel and back

## 1. One schema per response

```ts
export const taskSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  title: v.string(),
  isDone: v.boolean(),
  priority: v.fallback(v.picklist(TASK_PRIORITIES), 'normal'),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
});
export type ApiTask = v.InferOutput<typeof taskSchema>;
```

- One definition gives the TypeScript type and the run-time check, so the type cannot drift from what
  is checked. Never `response.json() as Task`: a cast checks nothing, and the checker flags it
  (`validated-response`).
- Every request names its schema; the transport runs `v.safeParse(request.schema, json)` on every 2xx
  body. A `.request({ method, path })` without `schema` is a finding.
- Instants stay ISO strings in the schema (`v.isoTimestamp()`); converting to a `Date` and formatting
  happen at the edge (dates-streaks-and-statistics, `src/i18n` formatters), so the cached value stays
  plain JSON that TanStack can compare structurally and a persisted cache can store.
- A date-only field (`'2026-10-10'`, a due day) is a calendar day, not an instant: check it with
  `v.pipe(v.string(), v.check(isDateKey))` (`src/core/dates/date-key.ts`) and keep it a string. Never pass
  it through `new Date(...)`, which reads it as UTC midnight and shows the previous day west of UTC
  (dates-streaks-and-statistics' `date-only-parse` rule reports that).
- Money and units arrive as integers in minor units (value-objects-money-and-units); a float price in
  a schema is a bug report waiting.

## 2. Tolerant reading

The server ships on its own schedule; installed apps stay on old versions for months. A response
schema decides whether a harmless server change breaks every one of them.

| Server change | Strict reading | Tolerant reading (the default here) |
|---|---|---|
| Adds a field | `v.strictObject` fails the whole response | `v.object` drops it from the output (verified: `v.parse(v.object({ id: v.string() }), { id: 'a', extra: 1 })` is `{ id: 'a' }`) |
| Adds an enum value | `v.picklist(VALUES)` fails the whole list | `v.fallback(v.picklist(VALUES), 'normal')` reads it as a known value |
| Removes a field the app needs | fails (correct: the contract broke) | fails too: tolerance is for additions, not removals |
| Sends `null` where the app expected a value | fails | decide per field: `v.nullable(...)` when null is meaningful, otherwise fail |

- **No `v.strictObject` and no bare `v.picklist`/`v.enum` in `src/api/`** (`response-schema`). Strict
  schemas belong to local storage and user input (persistence-and-migrations, forms-and-input), where
  the app owns both sides.
- `v.looseObject` keeps unknown keys in the output: it does not break, but the extra keys then flow
  into the cache and a persisted cache; prefer `v.object`.
- A list where one bad item should not fail the rest: validate items one by one
  (`v.array(v.unknown())` then `safeParse` each, keep the valid ones, record the count of dropped
  ones). Do it only for feeds where a partial answer is better than none; a task list that silently
  hides a task is worse than an error.

## 3. Transforms

```ts
export const taskListSchema = v.pipe(
  v.object({ items: v.array(taskSchema) }),
  v.transform((page) => page.items),
);
```

- Unwrap envelopes (`{ items }`, `{ data }`) in the schema, so query data is the thing the screen
  shows and keys stay one level.
- Rename wire names (`is_done` to `isDone`) in a transform at the boundary, never in a model hook.
- Keep transforms total and pure: one that throws is a bug (the transport would record it as an
  unexpected error, not as `invalid-response`).
- **Money and instants on the wire** (value-objects-money-and-units): money is decimal text plus a
  currency code, or an integer in minor units plus the code, never a JSON float. A money-named field
  that is a bare `v.number()` fails its `check-value-code` (`float-money`): use
  `v.pipe(v.number(), v.safeInteger())` or a decimal-string regex, then `parseCurrencyCode` and
  `parseMoney` at the boundary. Instants are ISO 8601 with `Z` or an offset, read with
  `parseIsoInstant` (its `examples/order-response.ts`).

## 4. Recording an invalid response

An invalid 2xx body means client and server disagree: an unexpected failure that the team must hear
about (error-handling-typed-results rule 6). The transport records it **once, at the boundary**, with
the request's method and path and each issue's dot path and expected type:

```
invalid response to GET /tasks/t1: title expected string
```

It never records the body or valibot's issue messages: `issue.message` and `issue.received` repeat the
received value, which can be the user's data (a task title, an email). The model hook gets
`{ kind: 'invalid-response', path }` and shows the generic "something went wrong on our side" key.
Expected failures (offline, 404, 422) are not recorded: they are the user's situation, not a defect.

## 5. The failure family

| Kind | Typical UI (message key from the failure table) | Retried by the query policy | Handled elsewhere |
|---|---|---|---|
| `network-unavailable` | offline notice, cached data stays | yes | ui-states-and-feedback (offline state) |
| `timed-out` | "taking too long, try again" | yes | |
| `cancelled` | nothing | no | |
| `unauthorized` | sign in again | no | auth-and-secure-storage (refresh once, then sign out) |
| `forbidden` | no access | no | |
| `not-found` | deleted or moved; leave the detail screen | no | navigation-and-routing |
| `conflict` | changed elsewhere; refetch, then let the user decide | no | |
| `rate-limited` | wait and try again | yes, after `Retry-After` | |
| `server-unavailable` | server trouble, try soon | yes | |
| `rejected` | the server refused the input; map `code` to a field message | no | forms-and-input |
| `invalid-response` | generic error | no (recorded at the boundary) | |

The message table is `Record<ApiFailureKind, MessageKey | null>` (examples/api-failure-message.ts),
so a new kind is a compile error until it has a message, and every key exists in every catalog
(error-handling-typed-results rule 8, i18n-strings-and-catalogs).

## 6. From a Result to TanStack's error channel and back

TanStack Query needs a rejection to put a query into its error state and to retry it; the ApiClient
returns Results. `unwrap` bridges the two inside `queryFn`/`mutationFn` only:

```ts
queryFn: ({ signal }) => unwrap(api.request({ method: 'GET', path: '/tasks', schema, signal })),
```

`unwrap` rejects with an `ApiError` that carries the typed failure (its message names the kind, never
user text). The model hook reads it back with `apiFailureOf(query.error)` and switches on `kind`; any
other error (a bug in a `select`) is `null` there, shows the generic message and is recorded once by
the QueryCache's `onError` in `createQueryClient`. Outside `queryFn`/`mutationFn` (a repository that
syncs, a background task) code keeps the Result and never throws for an expected failure.

Do not register a global `defaultError: ApiError` type for TanStack: a bug in a select would still
arrive as a `TypeError` and the type would lie. `apiFailureOf` narrows honestly.
