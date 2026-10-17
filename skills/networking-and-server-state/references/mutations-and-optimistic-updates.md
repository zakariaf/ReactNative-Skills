# Mutations, cache effects and optimistic updates

How writes are defined, what each one does to the cache, when to update optimistically and how to roll
back, and how retries stay safe. `@tanstack/react-query` 5.104.0, verified on 2026-10-04 against the
installed type declarations (`node_modules/@tanstack/query-core/build/modern/hydration-*.d.ts`).

## Contents

1. Mutations are defined once, with mutationOptions
2. Every write says what it does to the cache
3. Choosing the cache effect
4. Optimistic updates through the cache
5. Optimistic UI without touching the cache
6. Concurrent writes and late refetches
7. Retries, idempotency and double taps
8. Conflicts (409/412) and server validation (422)
9. Calling a mutation from the model hook
10. The callback signatures in 5.104

## 1. Mutations are defined once, with mutationOptions

```ts
// src/api/tasks/task-mutations.ts
export const taskMutations = {
  create: (api: ApiClient, queryClient: QueryClient): ApiMutationOptions<ApiTask, NewTaskRequest> =>
    mutationOptions<ApiTask, Error, NewTaskRequest>({
      mutationFn: (input) =>
        unwrap(api.request({ method: 'POST', path: '/tasks', body: { title: input.title },
          idempotencyKey: input.requestId, schema: taskSchema })),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
    }),
};
```

- A `mutationFn` outside `src/api/` is a finding (`query-options`): the write, its schema and its cache
  effects belong together, next to the resource's keys and queries, testable in plain Jest.
- The factory takes the `QueryClient` as an argument and closes over it. TanStack also passes
  `context.client` as the last callback argument, but that is the fourth or fifth positional
  parameter, past the house limit of three (typescript-and-lint-rules).
- Mutation keys, when used (`mutationKey` for `useMutationState` filters or `setMutationDefaults`), come
  from the key factory like query keys (`query-key-factory`).
- **A request that carries or returns credentials is never a mutation** (a sign-in exchange, a password
  change, a token refresh): TanStack keeps a mutation's variables and data in its MutationCache until
  `gcTime`, devtools read it, and a persisted client dehydrates paused mutations. Write it as a plain
  `src/api/` function over the ApiClient that returns the Result (auth-and-secure-storage's
  `exchangeAppleCredential(api, credential)`), and call it from the model hook.

## 2. Every write says what it does to the cache

A mutation whose `onSuccess` or `onSettled` neither invalidates nor sets anything leaves every list and
detail it changed showing the old data until something refetches by chance. The checker fails it
(`mutation-cache`) unless the options object carries a reasoned marker:

```ts
mutationOptions({
  // no-cache-effect: reporting a crash changes no server state the app shows
  mutationFn: (report) => unwrap(api.request({ method: 'POST', path: '/reports', body: report, schema: NO_CONTENT })),
});
```

## 3. Choosing the cache effect

| Effect | When | Code |
|---|---|---|
| Invalidate | the default; the server may change more than the client knows (sort order, counters, derived fields) | `onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.lists() })` |
| Set from the response | the response is the full new entity and the detail query has the same shape | `onSuccess: (task) => queryClient.setQueryData(taskKeys.detail(task.id), task)`, then invalidate the lists |
| Remove | the entity is gone | `queryClient.removeQueries({ queryKey: taskKeys.detail(id) })` after invalidating the lists, so a detail screen does not refetch a 404 |
| Optimistic | the user expects the change to show at once (toggles, reorder, delete with undo) and the server almost always accepts it | section 4 |

- Return the invalidation promise from `onSuccess`/`onSettled` (an arrow without braces does): the
  mutation stays `pending` until the refetch lands, so a button spinner does not stop on stale data.
- Invalidate by prefix: `taskKeys.lists()` reaches every filter, `taskKeys.all` the whole resource.
  Invalidation marks queries stale and refetches only the active ones; inactive ones refetch when used.

## 4. Optimistic updates through the cache

The toggle in `templates/src/api/tasks/task-mutations.ts` is the reference shape. Four steps, each
required by the checker (`optimistic-rollback`) whenever `onMutate` writes the cache:

```ts
onMutate: async (input) => {
  await queryClient.cancelQueries({ queryKey: taskKeys.all });        // 1. stop in-flight refetches
  const lists = queryClient.getQueriesData<readonly ApiTask[]>({ queryKey: taskKeys.lists() }); // 2. snapshot
  queryClient.setQueriesData<readonly ApiTask[]>({ queryKey: taskKeys.lists() }, (tasks) => withDone(tasks, input));
  return { lists };                                                    // what onError receives
},
onError: (_error, _input, snapshot) => {                               // 3. roll back
  for (const [key, tasks] of snapshot?.lists ?? []) queryClient.setQueryData(key, tasks);
},
onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),   // 4. the server's answer wins
```

1. **Cancel first.** A refetch that started before the write would land after the optimistic value
   and overwrite it with pre-write data: the checkbox flips back for a moment, then forward again.
   Cancelling reverts that fetch to its previous state (TanStack `revert`), no error shown.
2. **Snapshot what you change.** `getQueriesData` for every list under a prefix (each filter is its own
   query), `getQueryData` for one key. The snapshot is the `onMutate` return value; type it
   (`TaskListsSnapshot`), it is the mutation's fourth generic.
3. **Restore on error.** A refused write that stays on screen tells the user it happened. The failure
   message (from `apiFailureOf(error)`) still shows; the rollback is not a substitute for it.
4. **Refetch when settled**, success or not: the cache then holds the server's answer, not the
   client's guess (a server may clamp, reorder or reject part of a change).

Updaters must accept `undefined` (a list not cached yet) and must only reach data of the shape they
expect: keep differently shaped data (the paged list's `InfiniteData`) under another prefix, as
`taskKeys.pages()` sits outside `taskKeys.lists()`.

## 5. Optimistic UI without touching the cache

When only the screen that started the write shows it (an "adding..." row in one list), skip the cache
writes and render the pending variables instead:

```ts
const create = useMutation(taskMutations.create(api, queryClient));
const pendingTitle = create.isPending ? create.variables.title : null;   // render it greyed out
```

Nothing to roll back: on error the row disappears and the error shows; on success the invalidation
brings the real row. Other screens can read pending writes with
`useMutationState({ filters: { mutationKey: taskKeys.all, status: 'pending' }, select: (m) => m.state.variables })`.

## 6. Concurrent writes and late refetches

Two quick toggles: the first one's `onSettled` invalidation refetches while the second is still in
flight, and the refetch briefly shows the second toggle undone. When that matters, invalidate only when
the last related write settles:

```ts
onSettled: () =>
  queryClient.isMutating({ mutationKey: taskKeys.all }) === 1
    ? queryClient.invalidateQueries({ queryKey: taskKeys.all })
    : undefined,
```

(`isMutating` still counts the settling mutation, hence `=== 1`; the mutation needs that `mutationKey`.)
Writes that must apply in order (rename then delete) share a `scope: { id: 'task-' + id }` so TanStack
runs them one after another.

## 7. Retries, idempotency and double taps

- Mutations do not retry by default (TanStack's default is 0; `createQueryClient` sets `retry: false`
  explicitly). A retried POST after a timeout may have been applied the first time: two tasks.
- A write may retry only with an idempotency key: the client makes a request id when the user starts
  the action (the draft's id, from the app's id source), sends it as `Idempotency-Key`
  (`idempotencyKey` on the request), and the server applies a repeated key once. Then
  `retry: shouldRetryQuery` is safe. The checker fails a retrying mutation without `idempotencyKey`
  in its options (`retry-policy`).
- Paused mutations (offline) resume once on reconnect; that is a first attempt, not a retry, but it
  can still duplicate a write that reached the server just before the connection dropped. The
  idempotency key covers that too.
- Double taps: disable the button while `isPending`, or make the action idempotent; do not debounce in
  the mutation.

## 8. Conflicts (409/412) and server validation (422)

- `conflict` (409, or 412 with `If-Match`): someone else changed the entity. Roll back (the optimistic
  path does), invalidate, and tell the user the latest version is shown; a merge UI is the feature's
  decision.
- `rejected` with a `code` (422 `{ "code": "title-too-long" }`): map the code to a field message in the
  form (forms-and-input); unknown codes fall back to the generic `rejected` message. forms-and-input
  maps codes with a typed `Record<Code, { field, key }>` and a valibot picklist, then
  `setError(field, { type: 'server', message: key }, { shouldFocus: true })` with a message key, never
  prose (its `examples/server-field-errors.ts`). An availability probe while typing (is this name
  taken?) is a plain port call from the form, not a `useQuery`.
- Never retry either: the same request gets the same answer.

## 9. Calling a mutation from the model hook

```ts
const toggle = useMutation(taskMutations.toggle(api, queryClient));
onToggle: (id) => toggle.mutate({ id, isDone: !task.isDone }),
```

- Prefer `mutate` (fire and forget, errors land in the mutation's state and the MutationCache's
  `onError`) over `mutateAsync`, which rejects: an un-awaited `mutateAsync` is an unhandled rejection
  (error-handling-typed-results, async-safety). Use `mutateAsync` only where the caller awaits it inside
  a try/catch (a form submit that navigates on success).
- Per-call callbacks (`mutate(input, { onSuccess })`) run only while the component is mounted; cache
  effects belong in the factory's callbacks, which always run.
- `useMutation` and `useQueryClient` live in model hooks (`query-hook-home`); the view receives
  `onToggle` and `isSaving`, never the mutation object.

## 10. The callback signatures in 5.104

| Callback | Parameters |
|---|---|
| `mutationFn` | `(variables, context)` |
| `onMutate` | `(variables, context)` returns the snapshot (`onMutateResult`) |
| `onSuccess` | `(data, variables, onMutateResult, context)` |
| `onError` | `(error, variables, onMutateResult \| undefined, context)` |
| `onSettled` | `(data \| undefined, error \| null, variables, onMutateResult \| undefined, context)` |

`context` is `{ client, meta, mutationKey }`. Re-verify:
`grep -n "onMutate?:\|onSuccess?:\|onError?:\|onSettled?:" node_modules/@tanstack/query-core/build/modern/hydration-*.d.ts`
and `grep -n "type MutationFunctionContext" -A5` in the same file.
