# Patterns and recipes

Worked shapes for the common jobs, and the facts behind them: where files go, a screen with its model
hook, a `src/ui` component, hooks without effects, the four allowed effects, store reads, styles,
pressables, lists, window sizes and safe areas on iOS and Android, error boundaries, the tests that go
with each, the React Navigation appendix, monorepos, the checker's configuration and the verified facts.

## Contents

- Where things live
- A screen and its model hook
- A src/ui component
- Hooks without effects
- The four allowed effects
- Reading stores from components
- Styles: makeStyles and tokens
- Pressables: the checklist
- Lists: FlatList, FlashList, a bounded ScrollView, and how to measure
- Window size, safe areas and large text
- Error boundaries
- Testing recipes
- When the app uses React Navigation (static API)
- When multi-package
- Checker configuration
- Verified facts and versions

## Where things live

```
src/
  app/                    Expo Router routes only: _layout.tsx, (app)/index.tsx, task/[taskId].tsx
  features/tasks/         tasks-screen.tsx (pure view) · use-tasks-model.ts (+ test) · task-list.ts (pure,
                          + test) · components/task-row.tsx · use-tasks-actions.ts when the model grows
  ui/                     app-text.tsx · pressable-surface.tsx · screen-frame.tsx ·
                          subtree-error-boundary.tsx · use-hold-to-confirm.ts (ui-component-library) · a11y/
  hooks/                  use-is-app-active.ts · use-window-class.ts (hooks two or more features share)
  theme/                  tokens, palette, ThemeProvider, make-styles.ts, motion.ts
  stores/  services/  data/  api/  i18n/  config/  core/
test/                     render-with-providers.tsx, test-app.tsx
```

Layers point one way: routes → features → shared layers (`ui`, `theme`, `hooks`, `stores`, `services`,
`data`, `api`, `i18n`, `config`) → `core` (architecture-and-boundaries). Imports across folders use the
`@/` alias (`@/ui/screen-frame`); siblings use `./file`; parent-relative imports are banned. A hook used
by one feature stays in that feature; it moves to `src/hooks/` when a second feature needs it. The
day hooks there (`use-today.ts`, `use-next-day-countdown.ts`) belong to dates-streaks-and-statistics:
use them rather than writing another "today" hook.

## A screen and its model hook

```tsx
// src/app/(app)/index.tsx: the route is a leaf, two lines of work
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTasksModel } from '@/features/tasks/use-tasks-model';

export default function TasksRoute(): React.JSX.Element {
  const model = useTasksModel();
  return <TasksScreen model={model} />;
}
```

```tsx
// src/features/tasks/tasks-screen.tsx: a pure view; layout and testIDs only
export type TasksScreenProps = { readonly model: TasksModel };

export function TasksScreen({ model }: TasksScreenProps): ReactNode {
  // A stack header above, no tab bar below (a tab with a header: BETWEEN_HEADER_AND_TAB_BAR_EDGES).
  return (
    <ScreenFrame testID="tasks.screen" edges={BELOW_HEADER_EDGES}>
      <FlatList
        testID="tasks.list"
        data={model.tasks}
        keyExtractor={(task) => task.id}
        renderItem={({ item }) => <TaskRow task={item} onToggle={model.onToggle} />}
      />
    </ScreenFrame>
  );
}
```

- Passing the model whole (`model={model}`) or spreading its fields as props (`summary={model.summary}`)
  are both fine; the view never calls a store, a service, `t()` with data, or a router hook itself.
- `use-tasks-model.ts` reads stores through selectors (primitives, or `useShallow` for objects), reads
  server state through the feature's query hooks (networking-and-server-state), formats numbers and
  dates through the i18n formatters, calls `t()` for sentences that carry data, and builds handlers
  (`onToggle`, `handleDeleteAll`) that dispatch actions or navigate with `useRouter()`.
- Every function stays at 40 lines or fewer (`max-lines-per-function`, 80 in `.tsx`): split a big model
  into parts with one job each: `use-<feature>-actions.ts` for handlers, and a pure
  `<feature>-model-of.ts` that builds the view model from plain values (test it without rendering).
- Derived values (counts, "is today done", the sorted list) come from pure functions next to the store
  or in the feature, unit-tested without React.
- The model hook's test renders it with `renderHookWithProviders` and drives it through the stores and
  fakes the test app provides.

## A src/ui component

`examples/labelled-value.tsx` is the shape to imitate (never copy it into the app):

- a props type `LabelledValueProps` with `readonly` fields; strings already translated or formatted;
- theme-free styles at module level (`StyleSheet.create`), themed ones through `makeStyles`;
- one `testID` prop; parts append a segment (`${testID}.label`, `${testID}.value`);
- a slot (`accessory`) instead of a boolean variant flag;
- no store, feature or service import.

A pressable `src/ui` component composes the press surface (`PressableSurface`, design-system-structure)
or a raw `Pressable` inside `src/ui`, and fills the checklist below.

## Hooks without effects

- **State and derived values** (`examples/use-step-pager.ts`): local state for what only this screen
  needs, everything else derived during render (`isFirst`, `isLast`, a clamped index), functional updates
  in the handlers (two taps before a re-render still move two steps).
- **An OS value** (`templates/src/hooks/use-is-app-active.ts`): `useSyncExternalStore(subscribe,
  getSnapshot, getServerSnapshot)` with a module-level `subscribe` that adds the listener and returns its
  removal, a `getSnapshot` that reads the current value, and a `getServerSnapshot` for static web
  rendering and hydration (React throws "Missing getServerSnapshot" there without it). No `useState`, no
  effect, one subscription per mounted hook. A value many components read lives in a vanilla store fed by one watcher instead
  (`systemA11yStore`, accessibility-as-code).
- **A timer on the UI thread** (the press-and-hold hook `src/ui/use-hold-to-confirm.ts`, which
  ui-component-library ships with its hold button): a shared value driven by a Reanimated `withTiming`
  whose finish callback schedules `onConfirm` on the JS thread (`scheduleOnRN` from react-native-worklets),
  no effect and no JS timer. Both timings pass `reduceMotion: ReduceMotion.Never`, because the hold is a
  safety timer: under Reduce Motion Reanimated would otherwise finish it at once and the hold would
  confirm on touch. Release calls `cancelAnimation` and a short return to 0. Screen readers cannot hold,
  so the control declares `accessibilityActions={[{ name: 'activate' }]}` and its
  `onAccessibilityAction` confirms when `event.nativeEvent.actionName === 'activate'` (a double tap in
  VoiceOver and TalkBack).
- **The window** (`templates/src/hooks/use-window-class.ts`): `useWindowDimensions()` re-renders on every
  window change; the classification is a pure function tested at the window table.

## The four allowed effects

| Kind | Example | Cleanup |
|---|---|---|
| Subscribe to an OS or native event | `AppState` change, `Keyboard` show/hide, Android `BackHandler` `hardwareBackPress`, `Linking` url, any named `add*Listener` (expo-notifications `addNotificationResponseReceivedListener`, expo-network `addNetworkStateListener`, `Appearance.addChangeListener`), `watchSystemA11y()` at the root | return a function that calls `.remove()` |
| Push React state into a native API | the theme provider setting the root view colour (`expo-system-ui`) | none when idempotent |
| Work tied to a focused screen | `useFocusEffect(() => { const id = setInterval(save, 30_000); return () => clearInterval(id); })` | return the stop |
| Measurement | a first-frame mark | cancel the pending frame request |

- A callback the effect calls but must not re-subscribe for (a prop `onForeground`) goes through
  `useEffectEvent`, so the dependency list stays honest without re-adding the listener on every render.
- Android back: return `true` from a `hardwareBackPress` handler only while it handles the press (an open
  sheet), and always remove it. Navigation-level back and predictive back belong to navigation-and-routing.
- Async work started in an effect (a fetch, a read that resolves later, a subscription acquired after an
  `await`) follows async-safety: an `AbortController` or a stale flag per run, latest wins, and a handle
  released wherever it is made. [effect-cleanup] checks only that a subscribing effect returns a
  cleanup; async-safety's checker reads the rest, so an effect with no cleanup trips both.
- With React Compiler on, pass `useFocusEffect` an inline function (the compiler keeps it stable);
  without the compiler, wrap it in `useCallback` as the React Navigation docs say. The checker reads
  both forms.
- Return a **function**, never the subscription itself: `return subscription;` and an expression body
  `useEffect(() => AppState.addEventListener('change', fn), [])` hand React an object it never calls, so
  the listener leaks. Write `return () => { subscription.remove(); };`. Some APIs already return the
  unsubscribe function, and returning it directly is correct: React Navigation's (and Expo Router's)
  `navigation.addListener('focus', fn)`, `NetInfo.addEventListener(fn)` from
  @react-native-community/netinfo, and a Zustand `store.subscribe(fn)`. So
  `const unsubscribe = navigation.addListener('blur', fn); return unsubscribe;` and
  `useEffect(() => NetInfo.addEventListener(fn), [])` are fine. Check the type: a `() => void` result is
  the cleanup, an `EventSubscription` / `{ remove() }` result is not.
- A subscription that exists only in one branch returns its cleanup from that branch:
  `if (isOn) { const sub = Keyboard.addListener(…); return () => { sub.remove(); }; } return undefined;`.
- State that must follow a store outside React (audio volume, haptics) is a store subscription at the
  composition root (`store.subscribe((state, previous) => …)`, returning the unsubscribe), not an effect
  in some screen.
- Three patterns the lint rejects: copying a prop into state inside an effect (compute during render,
  or reset with a `key`), reading `ref.current` during render (read refs in handlers and effects), and
  declaring a component inside another (own file).

## Reading stores from components

```tsx
const filter = useTasksStore((state) => state.filter);                   // primitive: fine
const theme = useSettingsStore(selectThemePreference);                    // named selector
const { tasks, isPremium } = useTasksStore(
  useShallow((state) => ({ tasks: state.tasks, isPremium: state.isPremium })),
);                                                                         // object: useShallow
```

- `useShallow` comes from `zustand/shallow`. An inline `(state) => [a, b]` needs it too, and so does
  any selector that builds a value (`.filter`, `.map`, `Object.keys`, a spread).
- The rule is state-management-zustand's: its `check-stores` ([selector-missing],
  [selector-new-object]) and lint `storeWithoutSelector` check every store read; this skill's checker
  does not repeat them.
- Destructured booleans get an `is…` name; data property names keep theirs.
- Stores are created by factories at the composition root and handed down (state-management-zustand);
  a vanilla store is read with `useStore(store, selector)` under the same rules.

## Styles: makeStyles and tokens

```tsx
const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    card: { backgroundColor: theme.colors.surface, paddingInline: SPACING.lg, borderRadius: RADII.md },
  });
  return styles;
});

export function TaskCard(props: TaskCardProps): ReactNode {
  const styles = useStyles();
  …
}
```

Why this exact shape (three variants were tested in the source app): a factory returning a plain object
loses the typo check on style keys; returning `StyleSheet.create(...)` directly breaks
`react-native/no-unused-styles`; the block body keeps `tsc`, the start/end rule, the colour-literal rule
and `no-unused-styles` all working. Values come from the theme tokens (design-system-structure).

## Pressables: the checklist

| Prop | Value |
|---|---|
| role | `accessibilityRole` `button` (or `checkbox`, `switch`, `radio`, `tab`, `link`, `adjustable` where true) |
| name | `accessibilityLabel`: the translated visible text, or the required `label` of an icon-only button |
| hint | `accessibilityHint` only when the result is not obvious, translated |
| state | `accessibilityState` `{ disabled, busy }`, plus `selected` / `checked`; and `disabled` on the pressable |
| size | its own box at least 44 × 44 pt (`MIN_TOUCH`), never `hitSlop` |
| testID | `<screen>.<element>` in kebab-case, ending in the role (`tasks.add-button`), required |
| feedback | `style={(state) => [styles.base, state.pressed && styles.pressed]}`, or the press surface's own feedback; Android ripple through `android_ripple` on the surface |
| hold | `accessibilityActions={[{ name: 'activate' }]}` with an `onAccessibilityAction` that confirms on `activate` |

A screen test ends with the `findInaccessiblePressables` audit (accessibility-as-code).

## Lists: FlatList, FlashList, a bounded ScrollView, and how to measure

- **Default:** `FlatList` with `keyExtractor={(task) => task.id}` for anything that grows with the user's
  data (tasks, notes, orders, search results). It mounts a window of rows and recycles nothing, so row
  state cannot leak between items.
- **FlashList** (`@shopify/flash-list`, in the SDK 57 module map): only after a profile on a Release build
  shows the FlatList is the bottleneck. Recycled cells keep their state between items: reset per-row state
  with a `key` or derive it from the item.
- **A ScrollView that maps data:** only for a short list that can never grow (onboarding steps, a fixed
  settings section). Put `// bounded-list: <the bound and why>` (or `{/* bounded-list: … */}` in JSX) on one
  of the three lines above it; the checker asks for it. A module-level constant list (`DAYS.map`) is
  bounded by definition.
- **Keys:** the item's id; inside a template the index is still an index; `Array.from({ length }, (_, i))`
  positional series may key by `i`.
- **Sections:** `SectionList` keyed the same way; a grid is `FlatList numColumns` (or FlashList's
  `numColumns`) with the column count from `useWindowClass()`.

**How to measure before switching** (performance-budgets owns the budgets): a Release build on a named
iOS simulator and a named Android emulator, five cold launches each, medians of render to first frame,
render to last row laid out, rows mounted after 1.5 s, and memory footprint. One such measurement from
the source app (iOS 26.5 simulator, Release, 90 tiles in a grid, 2026-09-26; Android not measured):

| Variant | Render to first frame | Render to last tile laid out | Tiles after 1.5 s | Footprint |
|---|---|---|---|---|
| ScrollView (Views) | 16–26 ms | 26 ms | 90 | 49–50 MB |
| FlatList `numColumns` (Views) | 30 ms | 40 ms | 90 | 50 MB |
| FlashList 2.0.2 (Views) | 22 ms | 40 ms | 85 | 51 MB |
| ScrollView (one Skia canvas per tile) | 61 ms | 264–280 ms | 90 | 66 MB |

At 90 fixed items virtualization saved nothing (FlatList's default `windowSize` 21 covered the whole
grid), which is why a short bounded list may stay a ScrollView; at a few hundred items that grow, the
ScrollView mounts every row and the FlatList wins. A canvas per item was the slowest by far.

## Window size, safe areas and large text

`templates/src/hooks/use-window-class.ts` classifies `{ width: 'compact' | 'regular' (≥ 600), isLandscape,
isLargeText (fontScale ≥ 1.25) }`; `useWindowClass()` re-renders on rotation, iPad Split View and Stage
Manager, Android multi-window and freeform windows, a foldable opening, and a system text size change.
600 is Android's compact/medium window-size-class boundary. The narrowest full-screen iPad (iPad mini
portrait, 744 pt) is regular; split and floating iPad windows (Split View, Slide Over, Stage Manager)
can be compact, down to about 320 pt.

| Window | Size (pt / dp) | Why |
|---|---|---|
| narrow split-screen pane, small phone | 320 × 568 | the narrowest window |
| compact Android phone | 360 × 800 | the most common Android width class |
| phone portrait | 402 × 874 | a current iPhone; screenshots |
| phone landscape | 874 × 402 | rotation, resizable windows |
| iPad mini portrait | 744 × 1133 | the smallest regular iOS width |
| Android tablet portrait | 800 × 1280 | a medium Android window |
| 13-inch iPad landscape | 1376 × 1032 | the widest; the column caps at `CONTENT_MAX_WIDTH` |
| any of the above at `fontScale` 2 | | the 200 % text pass |

**Safe areas.** `ScreenFrame` (`templates/src/ui/screen-frame.tsx`) owns the insets and the ground colour
and centres a column of at most `CONTENT_MAX_WIDTH`; it has no padding of its own. Its `edges` prop is
required, so every screen states what sits around it.

- react-native-safe-area-context's `SafeAreaView` applies the insets of its nearest provider, not the part
  of the screen it overlaps (read from `ios/Fabric/RNCSafeAreaViewComponentView.mm` and
  `android/.../SafeAreaView.kt`, 5.7.0). Expo Router mounts the provider at its root, and its navigators
  reuse the root provider's insets (`SafeAreaProviderCompat` adds no provider when one exists). A
  navigator header pads the status bar itself, and the JS tab bar pads the home indicator or the Android
  navigation bar itself, so an edge the screen shares with either is added twice:

| Above the screen | Below the screen | `edges` | What goes wrong with `ALL_EDGES` |
|---|---|---|---|
| nothing (`headerShown: false`, `presentation: 'fullScreenModal'`) | nothing | `ALL_EDGES` | — |
| a stack header | nothing | `BELOW_HEADER_EDGES` (right, bottom, left) | an empty status-bar band (62 pt) under the header |
| nothing (`headerShown: false` in `Tabs`) | the JS tab bar (`Tabs` from `expo-router`) | `ABOVE_TAB_BAR_EDGES` (top, right, left) | an empty band above the tab bar: 34 pt on a home-indicator iPhone, the gesture or three-button bar height on Android |
| a tab header (the `Tabs` default) | the JS tab bar | `BETWEEN_HEADER_AND_TAB_BAR_EDGES` (right, left) | both bands |
| a stack header | nothing, and the content scrolls on under the home indicator (it pads the bottom inset itself: screen-contracts' `usePageBottomPadding`) | `BELOW_HEADER_SCROLLING_EDGES` (right, left) | the status-bar band, and the bottom inset added twice |

- **List-detail screens are the one exception to ScreenFrame.** adaptive-layout's `ListDetailLayout`
  needs about 721 pt for two panes, wider than ScreenFrame's `CONTENT_MAX_WIDTH` (640) column, and
  caps its own detail column. Such a screen renders it in react-native-safe-area-context's
  `SafeAreaView` with one of the edge sets above (for example `BELOW_HEADER_EDGES`); the checker
  allows it.

- Left and right stay on in every row: a landscape iPhone's notch and an Android display cutout sit at
  the side of the screen, not of the bars.
- **How far this is verified:** the rows by reading expo-router 57.0.24's sources (`BottomTabView`
  renders the tab bar as a sibling below the screens and `BottomTabBar` pads `insets.bottom`; the screens
  get the root insets), not on a device. Re-verify on a named iOS simulator and Android emulator when the
  navigator changes.
- **Native tabs** (`NativeTabs` from `expo-router/unstable-native-tabs`) were read in source and not
  verified on a device, and they differ per platform. iOS: each tab's content gets its own
  `SafeAreaProvider` measured from the tab's native view, so its bottom inset already includes the tab
  bar, and scroll views get automatic content insets. Android: the content is wrapped in
  react-native-screens' `SafeAreaView` with the bottom edge (unless `disableAutomaticContentInsets`), and
  no new provider is added. Start from `ABOVE_TAB_BAR_EDGES` on both and check the bottom of a
  non-scrolling screen on a named simulator and emulator before shipping.
- An iOS sheet (`presentation: 'modal'`, `'formSheet'` or `'pageSheet'`) starts below the status bar,
  but the root provider still reports the status-bar inset, so a headerless sheet on iOS gets an empty
  band at the top with `ALL_EDGES`; on Android `modal` is a full-screen fragment and keeps the top edge.
  Read from source, not run: the native stack gives its own header no top inset for iOS sheets, and
  react-native-screens adapts an Android `modal` into the same fragment as a push.
- Expo apps (SDK 54 and later) draw edge to edge on every Android version, and Android 16 removes the
  OS opt-out: the status bar and the gesture bar or three-button bar always sit over the app, so the
  bottom edge matters on an Android 13 emulator as much as the home indicator does on iOS.
- A list that should scroll under the home indicator keeps the bottom edge off the frame and pads its
  content instead: `contentContainerStyle={{ paddingBottom: insets.bottom }}` with
  `useSafeAreaInsets()` (physical keys: rule 36). On a JS tab screen the list already ends above
  the tab bar and needs no bottom padding.
- Insets never become `marginStart`/`paddingEnd`: the notch, the camera cutout and the gesture bar stay
  where they are in RTL.
- `SafeAreaView` from react-native is deprecated and iOS-only; the checker bans it.
- The keyboard is forms-and-input's (react-native-keyboard-controller).

**Large text.** With `isLargeText`, rows stack (two-button rows become full-width buttons, values drop
under their labels, multi-column stat grids become one column), and tiles grow in height. The threshold
is accessibility-as-code's: between iOS Extra Extra Large (1.235) and Extra Extra Extra Large (1.353),
below Android's 1.3 step, which JavaScript receives as 1.2999999523162842.

## Error boundaries

- **A route** exports `ErrorBoundary` built by error-handling-typed-results' `createRouteErrorBoundary`:
  Expo Router wraps that route (a layout included) in its own class boundary, which records nothing, so
  the export records and renders the fallback with one way out. The root layout's export is the last
  net for render errors.
- **A part of a screen that can fail on its own** (a Skia surface, a chart, a WebView, a third-party
  widget) sits in `SubtreeErrorBoundary` (`templates/src/ui/subtree-error-boundary.tsx`): `onError`
  records (must not throw), `renderFallback(reset)` draws a small fallback in place whose one button calls
  `reset`. The rest of the screen keeps working.
- **Never retry by itself:** no `reset()` from an effect or a timer; a render error that happens every
  time becomes a crash loop. **Errors no boundary sees** (handlers, promises, worklets, frame callbacks)
  are caught and recorded where they happen; an async handler starts `task().catch(reportError)`.

## Testing recipes

- Render through `renderWithProviders(ui, options)` and hooks through `renderHookWithProviders(() =>
  useX(), options)` from `@test/render-with-providers` (unit-and-component-tests); both return promises
  (RNTL 14): `await` them. A unit that reads no context renders with RNTL's `render` / `renderHook` and
  says why in a `// no-providers: <why>` line in its header.
- Query by role and name first (`screen.getByRole('button', { name: 'Add task' })`), by testID for layout
  parts.
- State changes from outside React: `await act(() => { stores.tasks.getState().toggle('task-1'); })`.
- Safe areas: wrap in `<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 62, left: 0, right: 0, bottom: 34 } }}>`; without metrics it renders nothing in Jest.
- Window size: mock `react-native/Libraries/Utilities/useWindowDimensions` with a mutable object (Jest's
  own default `fontScale` is 2, so set 1 for the default text size).
- Reanimated timers: `jest.useFakeTimers()`, then `act(() => { jest.advanceTimersByTime(ms); })` (the
  canonical `jest.setup.ts` calls Reanimated's `setUpTests()`); read shared values with `.get()`.
- An OS event: spy on the module's `addEventListener`, capture the listener, set the new current value,
  call the listener inside `act`.
- A re-render guard: wrap the component in `<Profiler id onRender={onRender}>`, change an unrelated store
  inside `act`, and expect the render count unchanged (`examples/hide-for-premium.test.tsx`). Jest runs
  the code uncompiled, so this proves the subscription boundary, not memoization.
- Skia does not load in the unit project; the canonical setup mocks it, and pixel goldens run in the
  golden project (golden-and-snapshot-tests).
- Test titles start with a third-person verb (`derives …`, `removes …`) or `can` (naming-conventions).

## When the app uses React Navigation (static API)

- A screen in the `screens` config is a small component that does what a route file does: `const model =
  useTasksModel(); return <TasksScreen model={model} />`. It lives in `src/features/<feature>/` next to
  the model hook, never in a navigator file.
- `useFocusEffect` comes from `@react-navigation/native`; the four-kinds table is the same.
- Conditional screens use static `if` hooks (`if: useIsSignedIn`) kept in a `*-guards.ts` file, which the
  checker's hook-file rule accepts.
- There is no route `ErrorBoundary` export: wrap the `NavigationContainer` in one recording class boundary
  (error-handling-typed-results) and parts that fail alone in `SubtreeErrorBoundary`. The checker accepts
  both (each declares `getDerivedStateFromError`).
- `SafeAreaProvider` is not mounted for you: put it at the root, outside the `NavigationContainer`.
  The bottom-tab and native-stack navigators are the same code Expo Router wraps, so the edges table in
  "Safe areas" applies unchanged.

## When multi-package

- With npm workspaces (`apps/*`, `packages/*`), the checker scans every workspace's source folder (its
  `srcDir`, default `<workspace>/src`) and skips each workspace's generated `ios/`, `android/` and build
  output; `--src <dir>` narrows or widens the scan.
- Defaults per workspace: the pressable folder is that workspace's `src/ui`, the text primitive its
  `src/ui/app-text.tsx`, the direction module its `src/i18n/direction.ts`; `reactRules` keys
  (repo-relative) apply to every workspace.
- React Compiler counts as on when any app config in the repo turns it on, and the memo rules then apply
  to shared packages too: Metro compiles workspace packages it resolves outside `node_modules` (observed
  in the source monorepo on 2026-09-26; re-verify by exporting a bundle and finding a package component
  that imports `react/compiler-runtime`).
- Shared packages export components that follow every rule here; an app-only concern (navigation, the
  composition root) never moves into a package.

## Checker configuration

`node ${CLAUDE_SKILL_DIR}/scripts/check-react-rules.mjs [repo-root] [--src <dir>]... [--json]`

- **Scope:** the layout's `srcDir` (default `src/`, from `rn-skills.config.json` `srcDir`, or every
  workspace's), through the shared repo walk: agent skill folders (`.agents/`, `.claude/`, `skills/`, …),
  any folder holding a `SKILL.md`, `node_modules`, generated `ios/` and `android/` and build output are
  never scanned. Tests (`*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`) and `*.d.ts` are left out.
- **React Compiler:** on when an app config (`app.config.ts`/`.js`/`.mjs`/`.cjs` or `app.json`, at the
  root or in a workspace) has `reactCompiler: true`, or when no app config exists. When configs exist and
  none turns it on, the checker prints `note: React Compiler is off (…): no-memo-apis and use-no-memo are
  not applied`.
- **`rn-skills.config.json` keys** (optional; repo-relative paths):

```json
{
  "reactRules": {
    "textPrimitive": "src/ui/app-text.tsx",
    "directionModules": ["src/i18n/direction.ts"],
    "pressableDirs": ["src/ui"],
    "reactCompiler": true
  }
}
```

  `textPrimitive` is the one file that may import `Text` from react-native; `directionModules` the files
  that may read `isRTL`; `pressableDirs` the folders that may import `Pressable`, the Touchables and
  react-native-gesture-handler's buttons (and whose components must take a required `testID`);
  `reactCompiler` overrides the app-config detection. A malformed value is exit 2.
- **Exit codes:** 0 pass, 1 problems, 2 bad input (no source folder, a missing `--src`, a malformed key).
- **Not checked here:** store reads (state-management-zustand's `check-stores`), roles, names, touch size
  and reduce motion (accessibility-as-code), thin routes (architecture-and-boundaries).
- **Limits (heuristic, by design; review these by hand):**
  - `shared-value-get-set` knows a shared value by its declaration or a `SharedValue<…>` /
    `DerivedValue<…>` type in the same file, or by sitting inside a worklet hook's callback; an untyped
    shared value from another file used outside those callbacks is not seen.
  - `scrollview-list` reads the JSX between a ScrollView's tags; rows built into a variable first and
    rendered as `{rows}` are not seen.
  - `props-readonly` reads `type …Props =` aliases (object literals and `&` intersections of them);
    `interface …Props` and members of a referenced type are not read. `testid-required` is not judged
    when the props type joins a referenced type (`BaseProps & { … }`), because the testID may live there.
  - `effect-cleanup` reads effects written inline as `() => { … }` or `function name() { … }` (also
    inside `useCallback`) and expression-bodied `() => AppState.addEventListener(…)`; an effect passed a
    function declared elsewhere (`useEffect(listen, [])`) is not read. A `return subscription;` counts as
    the leak it is only when `subscription` is assigned from the subscribe or timer call in the same
    effect; a handle passed through a helper (`return track(sub)`) is not followed.
  - `effect-cleanup` knows the APIs whose `add*Listener` returns the unsubscribe function by the receiver
    name: anything ending in `navigation` or `navigationRef` (any case) and `NetInfo`. Returning their
    result is accepted as the cleanup. A navigation object under another name (`const nav =
    useNavigation()`) is still read as a subscription, so `return nav.addListener(…)` is a false alarm:
    name it `navigation`. A library that returns a subscription object from a receiver named like those
    would be missed; check the return type by hand.
  - `banned-import` reads named imports; `import * as RN from 'react-native'` is not seen (lint bans it
    by name too).

## Verified facts and versions

Verified on 2026-10-04 against the reference app's installed packages (Expo SDK 57, expo 57.0.26, React
Native 0.86.3, React 19.2.3, TypeScript 6.0.3, Reanimated 4.5.1 with react-native-worklets 0.10.1,
react-native-safe-area-context 5.7.0, react-native-screens 4.26.2, expo-router 57.0.24, Zustand 5.0.15,
Jest 29.7 with jest-expo 57.0.5 and RNTL 14.0.1), by reading the sources:

- **The compiler switch** is the app config: `@expo/metro-config` passes `experiments.reactCompiler` as a
  transform option, and `babel-preset-expo` adds `babel-plugin-react-compiler` (1.0.0, installed with the
  preset; never add it to `package.json`) only when its caller asks. Re-verify:
  `grep -n reactCompiler node_modules/@expo/metro-config/build/rewriteRequestUrl.js` and
  `grep -n supportsReactCompiler node_modules/babel-preset-expo/build/common.js`.
- **Jest runs uncompiled code:** jest-expo's Babel caller (`{ name: 'metro', bundler: 'metro', platform }`)
  never sets `supportsReactCompiler`. Re-verify: `grep -n caller node_modules/jest-expo/src/resolveBabelOptions.js`.
- **`AppState.currentState` is current inside a change listener:** React Native registers its own
  listener in the `AppState` constructor, before any app listener. Re-verify:
  `grep -n "currentState\|addListener" node_modules/react-native/Libraries/AppState/AppState.js`.
- **`SafeAreaView` uses its provider's insets** on both platforms (`findNearestProvider` and
  `_providerView.safeAreaInsets` in `ios/Fabric/RNCSafeAreaViewComponentView.mm`,
  `getSafeAreaInsets(providerView)` in `android/.../SafeAreaView.kt`), and Expo Router's root mounts a
  `SafeAreaProvider` (`node_modules/expo-router/build/ExpoRoot.js`).
- **Navigators reuse the root insets; the JS tab bar pads its own.** `SafeAreaProviderCompat` returns a
  plain `View` when `SafeAreaInsetsContext` already has insets; `BottomTabView` renders the tab bar after
  the screens container in a column, and `BottomTabBar` adds `insets.bottom` to its padding. Re-verify:
  `grep -n "If we already have insets" node_modules/expo-router/build/react-navigation/elements/SafeAreaProviderCompat.js`
  and `grep -n "insets.bottom" node_modules/expo-router/build/react-navigation/bottom-tabs/views/BottomTabBar.js`.
- **Native tabs differ per platform** (read, not run): iOS wraps each tab in a new `SafeAreaProvider`,
  Android wraps the content in react-native-screens' `SafeAreaView` with `edges: { bottom: true }`.
  Re-verify: `grep -n "SafeArea" node_modules/expo-router/build/native-tabs/NativeTabsView.ios.js
  node_modules/expo-router/build/native-tabs/NativeTabsView.android.js`.
- **React needs a server snapshot for static rendering:** react-dom 19.2.3 throws "Missing
  getServerSnapshot, which is required for server-rendered content" in its server and hydration builds,
  and the Expo template sets `web.output: 'static'`. Re-verify:
  `grep -c "Missing getServerSnapshot" node_modules/react-dom/cjs/react-dom-server.node.development.js`.
- The lint side: eslint-config-expo 57.0.2 brings eslint-plugin-react-hooks 7.1.1, whose compiler rules
  (`set-state-in-effect`, `refs`, `purity`, `static-components`, `set-state-in-render`) report as errors
  under the canonical config. Re-verify: `npm ls eslint-plugin-react-hooks`.

Observed in the source app (iOS, 2026-09-26, not re-run here): the compiler compiled a pressable icon
button (an 8-slot cache) and the hold-to-confirm hook and skipped the factory-returned `useStyles`;
`props.items.push()` is not flagged by lint (hence read-only props); a `<Profiler>` guard failed as
expected when a component also subscribed to the whole settings object.

The templates in this skill passed `tsc` for both programs, the canonical ESLint config with
`--max-warnings 0`, Prettier and their own Jest tests inside the library's reference Expo app on
2026-10-10.
