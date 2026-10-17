# List-detail with Expo Router: the selection is the route

How a list and its selected item share one screen on wide windows and two routes on narrow ones,
without navigating in effects, losing the selection on rotation, or breaking links. Read from
expo-router 57.0.24's sources and designed for both platforms; the flows below were not run on a
device in this library (check them on a named iPad simulator and Android tablet emulator); the
route flow of sections 3 and 4 passes in Jest with Expo Router's in-memory router.

## Contents

1. The model
2. Files
3. Selecting an item
4. Crossing the two-pane width
5. Back, predictive back and links
6. What not to do
7. Tests

## 1. The model

- Two routes: the list route `src/app/(app)/tasks/index.tsx` (`/tasks`, optional search param
  `selected`) and the detail route `src/app/(app)/tasks/[id].tsx` (`/tasks/t1`).
- Both render the **same** screen, `TasksScreen`, a pure view of one model. The route only says which
  pane it stands for when one pane fits: `onePane: 'list'` or `'detail'`.
- The model hook reads the selection from the route (`useLocalSearchParams()`: `id` on the detail
  route, `selected` on the list route; each route reads only the param it owns) and the panes from
  `useListDetailLayout()`.
- `ListDetailLayout` renders one pane or two from the model and reports its own width back to the
  hook (`panes.onLayout`), so the pane count follows the box the panes get; it never navigates.

Every state of the screen is a URL, so a rotation, a window resize, a process restart that restores
the route, a deep link and a test all land on the same item. Component state (`useState`) would reset
the selection whenever the subtree remounts and the two layouts would disagree about it; the checker's
`list-detail-selection` rule fails it.

## 2. Files

| File | Role |
|---|---|
| `src/app/(app)/tasks/index.tsx` | thin route: `useTasksModel('list')` -> `<TasksScreen model={model} />` |
| `src/app/(app)/tasks/[id].tsx` | thin route: `useTasksModel('detail')` -> `<TasksScreen model={model} />` |
| `src/features/tasks/use-tasks-model.ts` | the selection from the route, the pane layout, `onSelect` |
| `src/features/tasks/tasks-screen.tsx` | `<ListDetailLayout>` with the list, the detail and the empty hint |
| `src/ui/adaptive/*` | the pane kit (this skill's templates) |
| `contracts/adaptive-layout.json` | `listDetailScreens: ["src/features/tasks/tasks-screen.tsx"]` |

The full shapes are in `examples/tasks-list-detail.md`.

## 3. Selecting an item

```ts
function handleSelect(id: string): void {
  if (panes.layout.kind === 'one-pane') router.push(`/tasks/${id}`); // one pane: the detail route
  else if (onePane === 'detail') router.setParams({ id });           // /tasks/t1 becomes /tasks/t3
  else router.setParams({ selected: id });                           // stays on /tasks, the detail follows
}
```

- On two panes, `router.setParams` replaces the current route's params: no new stack entry, so back
  leaves the list instead of walking through every item that was tapped.
- **Set the param the current route owns.** Two panes also happen on the detail route: a link to
  `/tasks/t1` on a tablet, or a phone push that is then rotated or unfolded. There
  `setParams({ selected })` would give `/tasks/t1?selected=t3`, the route's own `id` still names
  `t1`, and the detail pane never changes. So the detail route changes `id` (Expo Router rewrites the
  path to `/tasks/t3`), and the model reads `id` on the detail route and `selected` on the list
  route, never `id ?? selected`.
- On one pane, `router.push` opens the detail route; back returns to the list.
- Highlight the selected row from the same value (`model.selected?.id === task.id`), and announce
  nothing extra: the detail pane's heading changes and screen readers read it when focused.

## 4. Crossing the two-pane width

| Where | What happens to the window | What the person sees | Why it works |
|---|---|---|---|
| `/tasks?selected=t1`, two panes | shrinks to one pane (rotation, Split View) | the list, `t1` highlighted | the list route's one pane is the list; the param stays |
| `/tasks/t1`, one pane | grows to two panes | the list beside `t1` | the detail route renders the same two-pane screen with `id` selected |
| `/tasks/t1`, two panes, tap `t3` | — | `/tasks/t3`, the list beside `t3`, no new stack entry | the detail route sets its own `id` |
| `/tasks/t1` (pushed from the list), two panes, back | — | `/tasks` with its own selection | the stack is unchanged by the resize |
| `/tasks/t1` (cold deep link), two panes, back | — | leaves the stack: nothing lies below | unless the stack layout sets `unstable_settings.initialRouteName` (navigation-and-routing) |
| `/tasks?selected=t1`, two panes | a side tab bar appears, or the screen opens in a form sheet | the list, `t1` highlighted | the panes measure their own box (664 pt beside an 80 pt rail on an iPad mini is one pane) |
| `/tasks`, two panes, nothing selected | — | the list and the empty hint | `detail` is null, `emptyDetail` fills the pane |

Nothing navigates in an effect when the window changes: each route already knows how to render
either way. `ListDetailLayout` keeps both panes keyed, so the list keeps its scroll position and state
across the crossing (its test proves it).

## 5. Back, predictive back and links

- iOS swipe-back and Android back (and Android 16's predictive back animation, which Expo apps enable
  with `android.predictiveBackGestureEnabled`) pop the detail route on one pane as usual. On two panes
  there is no detail route to pop unless the person arrived through a link or pushed on one pane.
- A link to `/tasks/t1` opens the detail on a phone and the two-pane screen on a tablet, with no
  special code.
- Typed routes: with `experiments.typedRoutes`, `router.push` takes `` `/tasks/${id}` `` as an
  `Href`; navigation-and-routing owns route typing and params validation (parse `id` before use).

## 6. What not to do

- **Navigate when the window changes** (`useEffect(() => { if (two) router.replace(...) }, [two])`):
  it fights the back stack and runs on every rotation. Let both routes render both ways.
- **Keep the selection in `useState` or a store**: it drifts from the URL, and links cannot set it.
  A store can cache the selected item's data; the id stays in the route.
- **Render two panes in a compact window with a horizontal ScrollView**: cramped and unreadable.
- **Nest a second navigator inside the detail pane** for one detail: the URL stops describing the
  screen. A detail with its own sub-pages pushes them on the root stack.
- **Use `expo-router/unstable-split-view` as the cross-platform answer**: it is iOS-only (a `Slot`
  elsewhere) and unstable; see window-classes-and-panes.md section 9.

## 7. Tests

- The pane decision: `pane-layout.test.ts` at the window table, at `fontScale` 1 and 2.
- The hook: `use-list-detail-layout.test.tsx` mocks `useWindowDimensions`, wraps a
  `SafeAreaProvider` with `initialMetrics` and fires layout events (portrait phone, iPad mini, large
  text, a 664 pt box in a 744 pt window, a landscape notch before the first layout).
- The layout: `list-detail-layout.test.tsx` (one pane per route, two panes, the empty hint, the
  readable column, the list kept across the crossing).
- The routes: unit-and-component-tests' `renderRouterWithProviders` (`@test/render-router-with-providers`,
  Expo Router's in-memory router inside the app's providers) with both route files, the window mocked
  and a `SafeAreaProvider` with metrics plus the app's `I18nProvider` in a `_layout` stand-in that
  renders `<Slot />`: open `/tasks`, `await` a press on a row, and assert `getPathname()` is
  `/tasks/t1` on a phone window and `getSearchParams()['selected']` is `t1` on an iPad window; open
  `/tasks/t2` on a wide window, press `t3`, and assert `/tasks/t3` with the `t3` detail shown; fire a
  664 pt layout on the panes in a 744 pt window and assert a press pushes (verified 2026-10-10 in the
  reference app; the full test is in `examples/tasks-list-detail.md`). Use the helper, not
  `renderRouter`'s own matchers: with expo-router 57.0.24 and RNTL 14 they throw.
- The screen: one render per pane state, queried by testID (`tasks.panes.list`,
  `tasks.panes.detail`).
- On devices: screenshots at the window table on named simulators and emulators (ios-simulator-build,
  e2e-maestro); include a portrait-shaped iPad Split View.
