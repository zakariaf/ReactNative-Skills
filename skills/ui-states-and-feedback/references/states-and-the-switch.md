# States and the one switch

What a data screen shows when it is not showing its content, how that is decided, and how the
contract keeps the decision honest.

## Contents

1. The six states
2. Deciding the state (listScreenStateOf)
3. From TanStack Query
4. From a local repository
5. Empty versus filtered-empty
6. Failed versus offline
7. Refresh and stale content
8. Retry that keeps the person's place
9. Partial failures are row states
10. Copy for each state
11. The screen states contract
12. Testing every state
13. Verified facts

## 1. The six states

| Kind | When | What it shows | Its one next step |
|---|---|---|---|
| `loading` | nothing loaded yet, a request runs | nothing for 300 ms, then a placeholder shaped like the content | none (it ends by itself) |
| `offline` | nothing loaded yet, the request waits for a network | "You're offline. Your tasks load by themselves when you're back online." | none: it resumes on reconnect |
| `failed` | nothing loaded yet, the load failed | the failure's own message (from its kind) | Try again |
| `empty` | loaded, there is nothing at all | "No tasks yet" + what to do | the primary action (Add a task) |
| `filtered-empty` | loaded, items exist, none matches the filter or search | "Nothing matches" | clear the filter (Show all tasks) |
| `ready` | loaded, items to show | the content, with `isRefreshing` and an optional notice | the content's own actions |

`ListScreenState<TItem>` in `templates/src/ui/feedback/screen-state.ts` is this table as a
discriminated union. A screen that is not a list (a detail screen) drops `empty` and
`filtered-empty` from its own union and its contract entry; the rest stays.

**Why one union and not flags.** `isLoading`, `error` and `items` as three fields can say "loading
and failed" or "empty while loading", and every combination that can be written eventually renders
(a spinner over an error message, "No tasks yet" during the first load). A union makes those states
impossible to write down, and `switch (state.kind)` with `switch-exhaustiveness-check` (the house
ESLint config) makes a new kind a compile error in every view until it is rendered. The checker's
`state-flags` rule catches the flag pair in one file.

## 2. Deciding the state (listScreenStateOf)

One pure function, called once in the model hook, decides. The view never re-derives it.

```ts
const state = listScreenStateOf<Task>({
  items: query.data,                       // undefined until the first success — never `?? []`
  isFetching: query.fetchStatus === 'fetching',
  isPaused: query.fetchStatus === 'paused',
  failureKey: query.status === 'error' ? failureKeyOf(query.error) : null,
  // Filtered only when unfiltered items exist (section 5).
  isFiltered: filter !== 'all' && (all.data === undefined || all.data.length > 0),
});
```

The order inside is the whole design:

1. **No items yet** (`items === undefined`): a failure wins (`failed`), else a paused request is
   `offline`, else `loading`. A failure is checked first because TanStack keeps `fetchStatus`
   `'paused'` on a retry that waits for the network after an error.
2. **Items loaded but none**: `filtered-empty` when a filter narrows the list, else `empty`.
   Filtered-empty is decided before empty because the model knows whether a filter is active and
   the view must never guess why the list is short.
3. **Items**: `ready`, with `isRefreshing` (a request runs behind the content) and a `notice` when
   what is shown may be out of date (paused: offline; the last refresh failed: its message).

`items ?? []` before this call is the most common bug of the whole topic: the first load and a
failed load both turn into "No tasks yet", which tells the person their data is gone
(`empty-default` flags it inside the state call, in a const handed to it as `items`, and anywhere in
a file that reads TanStack Query without deriving a state).

## 3. From TanStack Query (v5, verified on 5.104.0)

TanStack's result carries two independent axes:

| Field | Values | Meaning |
|---|---|---|
| `status` | `pending` · `error` · `success` | is there data? (`pending` = none yet) |
| `fetchStatus` | `fetching` · `paused` · `idle` | is a request running, waiting for a network, or resting? |
| `isLoading` | `isPending && isFetching` | the first load only |
| `isRefetching` | `isFetching && !isPending` | a refresh behind data |
| `isLoadingError` / `isRefetchError` | `isError && !hasData` / `isError && hasData` | failed with nothing / failed behind data |

- A failed **refetch keeps the old data** with `status: 'error'`: the list stays and the notice says
  it may be out of date. Never replace it with the failed state.
- **Switching a filter or a page** changes the query key; the new key has no data, so the screen
  would drop to `loading`. Keep the previous list while the new one loads with
  `useQuery({ ...taskQueries.list(api, filter), placeholderData: keepPreviousData })` (from
  `@tanstack/react-query`): the state stays `ready` with `isRefreshing`, and `isPlaceholderData`
  is true until the answer arrives (`examples/use-tasks-model.ts`).
- `networkMode: 'online'` (the default, kept by networking-and-server-state) pauses a request
  offline instead of failing it: that is what makes `offline` a state of its own. It needs
  TanStack's `onlineManager` wired to the `ConnectivityPort`: React Native has no browser
  online/offline events, so without that wiring (networking-and-server-state sets it up) TanStack
  thinks the device is always online, requests fail as `network-unavailable` instead of pausing, and
  the offline state and the offline list notice never appear. Prove it in a model test: with the
  fake connectivity offline, the query's `fetchStatus` is `'paused'`.
- The failure message comes from the failure's kind through its message table
  (`API_FAILURE_MESSAGES` in networking-and-server-state; error-handling-typed-results owns the
  pattern). A `cancelled` failure is never shown: the screen that asked is gone.
- Suspense (`useSuspenseQuery`) moves `loading` into a `<Suspense>` fallback and `failed` into an
  error boundary: the union then has only `empty`, `filtered-empty` and `ready`. React shows a
  fresh fallback **at once**: its 300 ms `FALLBACK_THROTTLE_MS` keeps a fallback that is already
  on screen up for about 300 ms before it reveals the content (close to `minVisibleMs`), and never
  delays showing one. So the fallback still needs the delay:
  `<Suspense fallback={<DelayedPlaceholder isLoading placeholder={<TaskRowsSkeleton />} label={copy.loadingLabel} testID="tasks.state.loading">{null}</DelayedPlaceholder>}>`,
  or start the load in a transition (`startTransition`), which keeps the old screen instead of
  showing the fallback. This library's default is the plain `useQuery` with the union, because the
  boundary hides which failure happened.

## 4. From a local repository

A screen that reads SQLite through a repository (persistence-and-migrations) has no `offline`, and
usually no visible `loading` (a local read finishes in milliseconds, so the 300 ms delay keeps the
placeholder away entirely). It still has `failed`: a read can fail (a corrupt row, a full disk), and
`empty`/`filtered-empty` as any list. Feed `listScreenStateOf` with `isPaused: false` and keep the
contract entry's `readsServer` false.

## 5. Empty versus filtered-empty

They answer different questions. Empty: "you have not added anything yet", with the primary action
that fills the screen (and a short hint of what the screen is for). Filtered-empty: "nothing matches
this filter", with the action that clears the filter or search, and never the "Add" action alone
(adding does not help someone who filtered their tasks away). A search box that shows "No tasks yet"
for a search with no hits makes people think the search deleted their data.

Filtered-empty also needs to know that **unfiltered items exist**: someone with no tasks at all who
picks "Open" should see the empty state with "Add a task", not "Nothing matches" with a "Show all"
that leads to another empty screen. When the app filters in memory, that is the unfiltered array's
length. When the server filters, an empty answer cannot tell; read the unfiltered list from the
cache without fetching it (`useQuery({ ...taskQueries.list(api, 'all'), enabled: false })`, loaded
because the screen opens on "All"), or ask the server for a count. Treat "unknown" as "items exist":
"Show all" then shows the real answer.

## 6. Failed versus offline

`offline` is a request **waiting**: it resumes on reconnect by itself, so it offers no button (a
Try again that cannot work is a lie) and says so: "Your tasks load by themselves when you're back
online." `failed` is a request that **ended**: it shows its kind's message and Try again. A device
that is online but whose server is down is `failed` (`network-unavailable` or `server-unavailable`
from the ApiClient), not `offline`: the ConnectivityPort only knows whether the device is on a
network.

## 7. Refresh and stale content

- A refresh never blanks the screen. Placeholders come only from "nothing loaded yet"
  (`items === undefined`); `isFetching` never chooses a placeholder (`refresh-blanks` flags an early
  return on `isFetching`/`isRefetching`).
- Two kinds of refresh, two indicators. `ready.isRefreshing` is true for **every** request behind
  the content: refetch on focus and on reconnect, and the invalidation after each write (the toggle,
  the soft delete). Show it at most as a quiet header line ("Updating…"). The pull-to-refresh
  spinner (`RefreshControl`) turns only for the person's own pull: the model keeps a
  refresh-by-user flag (`useBusyAction` around `query.refetch()`, loading-and-busy.md section 7).
  The rows stay where they are, and so does the scroll position.
- A list that may be out of date says so above itself (`ready.notice`): offline, or the last refresh
  failed with its message. It is a line in the screen, not a notice that times out, because it stays
  true until the next successful load.

## 8. Retry that keeps the person's place

Try again calls `query.refetch()` (or `queryClient.invalidateQueries` for a family). The filter, the
search text, typed input and the scroll position live outside the query (component state, the
store, the list), so they survive. Never remount the screen or reset its state to retry: the person
loses what they typed. `refetch()` returns a promise: catch it into the error log (async-safety).

## 9. Partial failures are row states

One task that failed to sync, one image that failed to load, one row whose write was refused: these
are **row states** (an inline mark and a retry on that row), never a screen state. One failed row
must not replace the other forty-nine with an error screen. Model it on the item
(`{ ...task, syncState: 'failed' }`) and render it in the row component.

## 10. Copy for each state

Each state has its own title, a body that says what happened and what the person can do, and the
action's verb. The model translates once (`tasksStateCopyOf(state, t)` in
`templates/src/features/tasks/tasks-state-copy.ts`); views receive strings. Rules for the words:

- Name the thing: "Couldn't load your tasks", not "Error". The body is the failure's message.
- Say what happens next: "They load by themselves when you're back online."
- The action is a verb: "Try again", "Add a task", "Show all tasks".
- Never an exception text, a status code or a class name (error-handling-typed-results'
  `ui-error-message` rule).
- Every key exists in every locale (i18n-strings-and-catalogs); examples ship `en` and `ar`.

## 11. The screen states contract

`contracts/screen-states.json` (template plus schema) lists every screen that loads, lists or
filters data. The checker proves each entry against the code, so deleting a state's message or
test fails in CI rather than in front of a person. A new feature folder whose code calls a query
hook (`useQuery`, `useSuspenseQuery`, `useInfiniteQuery`, a `use…Query` wrapper) and has no screen
in the contract fails `screen-undeclared`. The check is per feature folder: a second data screen
added to a folder that already has one declared is not noticed, so declare it when you add it
(checker-rules.md section 6).

```json
{
  "screens": [
    {
      "id": "tasks",
      "view": "src/features/tasks/components/tasks-state-switch.tsx",
      "test": "src/features/tasks/components/tasks-state-switch.test.tsx",
      "stateType": { "file": "src/ui/feedback/screen-state.ts", "name": "ListScreenState" },
      "states": ["loading", "offline", "failed", "empty", "filtered-empty"],
      "isList": true,
      "hasFilter": true,
      "readsServer": true
    }
  ],
  "confirmations": [{ "testID": "tasks.clear-done-dialog", "whyNotUndo": "..." }]
}
```

| Key | Meaning | Rule |
|---|---|---|
| `id` | kebab-case testID prefix; each state's element is `<id>.state.<state>` | `state-testid` |
| `view` | the file with the switch; its state elements carry literal testIDs and `action=` | `state-testid`, `state-action`, `loading-delayed` |
| `test` | the test that renders every declared state | `state-tested` |
| `model` | optional model hook; importing `@tanstack/react-query` there implies `readsServer` | `states-required` |
| `stateType` | optional union whose `kind` literals must equal `states` + `ready` | `state-kinds` |
| `isList` · `hasFilter` · `readsServer` | require `empty` · `filtered-empty` · `offline` | `states-required` |
| `actionProp` (top level) | the prop that carries a state's next step (default `action`) | `state-action` |
| `confirmations` | every `confirm()` testID with why Undo cannot replace it | `confirm-undeclared` |

`loading` and `failed` are always required: every screen that loads can be slow and can fail. The
contract is the app's own file: the checker stays strict and the facts belong to the app.

When the app also keeps screen-contracts' `contracts/screens.json`, nothing makes the two agree by
itself: its state ids and element testIDs are free-form. Align them by hand: use this skill's state
names there (`failed`, not `error`; `filtered-empty`, not `no-results`), and list each state's element
as `<id>.state.<state>` (plus its `.title`, `.body` and `.action` parts when the screen names them).
This file stays the one the non-happy paths are checked against (required states, next steps,
delayed loading, tested states); screens.json keeps the screen's layout contract.

## 12. Testing every state

- **The decision**: unit-test `listScreenStateOf` for every combination (templates'
  `screen-state.test.ts`): no data + fetching, no data + paused, no data + error, error + paused,
  empty with and without a filter, data + fetching, data + paused, data + error.
- **The view**: render the switch once per state (`tasks-state-switch.test.tsx`) and assert the
  state's testID, its text and that its action calls the right intent; the loading case advances
  fake timers past 300 ms. End each render block with accessibility-as-code's
  `findInaccessiblePressables` audit.
- **The model**: with the fake ApiClient (networking-and-server-state's `test/api/`), script a
  failure and assert the model's state is `failed` with the kind's key; script a paused query by
  setting the fake connectivity offline.
- **E2E**: a Maestro flow asserts `tasks.state.empty` on a fresh install and
  `tasks.state.offline` with the network off (e2e-maestro names the devices and the network
  switch).

## 13. Verified facts

Verified on 2026-10-10 against the reference app's installed packages.

| Fact | Re-verify |
|---|---|
| TanStack 5.104.0: `isLoading = isPending && isFetching`, `isRefetching = isFetching && !isPending`, `isRefetchError = isError && hasData` | `grep -n "isLoading\|isRefetching\|isRefetchError" node_modules/@tanstack/query-core/build/modern/queryObserver.js` |
| React Native 0.86's renderer sets `FALLBACK_THROTTLE_MS = 300` and measures it from `globalMostRecentFallbackTime`, which is set when a fallback commits: it holds back revealing content for up to 300 ms after a fallback appeared and never delays the fallback itself (read in the source, not measured on a device) | `grep -n "FALLBACK_THROTTLE_MS\|globalMostRecentFallbackTime" node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-dev.js` |
| `keepPreviousData` is exported by `@tanstack/react-query` 5 | `grep -n "keepPreviousData" node_modules/@tanstack/query-core/build/modern/index.d.ts` |
