# The React rules, explained

Every rule for components, screens, hooks, effects, the compiler, store reads, styles, text,
direction, pressables, lists, icons, layout, motion and errors in an Expo app, with the reason and what
enforces it. "lint" is the canonical ESLint flat config with `--max-warnings 0` (typescript-and-lint-rules
owns it); "checker" is this skill's `scripts/check-react-rules.mjs` with the rule id in brackets; "test"
is a Jest test the rule asks for; a skill name means that skill states and checks the rule, and this
catalogue only points at it so a reader sees the whole picture in one place.

## Contents

- Components (1-8)
- Hooks and effects (9-14)
- React Compiler (15-20)
- Stores in components (21-24)
- Theme and styles (25-28)
- Text (29-32)
- Right-to-left layout and insets (33-37)
- Pressables (38-43)
- Lists (44-46)
- Icons and canvases (47)
- Layout, dark mode, motion, lifecycle and errors (48-55)

## Components (1-8)

1. **Function components only; the one class is an error boundary.** `SubtreeErrorBoundary`
   (`src/ui/subtree-error-boundary.tsx`) is a class because React 19 has no hook that catches a render
   error; Expo Router's route boundary is a class inside the router. React Compiler optimizes only
   functions. Enforced: checker [class-component] (a class without `static getDerivedStateFromError`).
2. **One component per file, a kebab-case file, a named PascalCase export of the same name, an
   explicit return type, no default export** (route files are the exception: Expo Router reads their
   default export). `labelled-value.tsx` exports `LabelledValue`. An agent finds a component from its
   name alone. Enforced: lint (`react/no-multi-comp`, `check-file`, `import/no-default-export`,
   `explicit-module-boundary-types`), naming-conventions (`export-name`).
3. **Props are `type <Component>Props = { readonly … }`.** Arrays are `readonly T[]`, callbacks are
   properties (`readonly onPress: () => void`, never a method signature), callback props are `onX`,
   local handlers `handleX`, and every interactive `src/ui/` component takes a required
   `readonly testID: string` (`<screen>.<element>`, `tasks.task-row.<id>`) and derives its parts from it
   (`${testID}.label`). A read-only type makes prop mutation a `tsc` error; the hooks lint does not catch
   `props.items.push()`. An intersection (`BaseProps & { readonly … }`) follows the same rule in every
   object literal it joins. Enforced: checker [props-readonly] (every object literal of a `*Props`
   type alias, intersections included), [testid-required]; naming-conventions (`handler-name`,
   `testid-format`); lint `testIdFormat`.
4. **Components display strings but never build them.** A prop that ends up on screen arrives
   translated (`t()` in the model hook or the view for fixed copy), and every sentence is one message so
   translators see it whole. Enforced: lint (`formatjs/no-literal-string-in-jsx`, `react/jsx-no-literals`),
   i18n-strings-and-catalogs.
5. **No business logic in components.** Rules and derived values live in pure functions (reducers,
   selectors, `<feature>-layout.ts`, `task-list.ts`), side effects in services behind ports, and the
   model hook wires them. `src/ui` stays presentational: no stores, features or services other than a
   `*-port.ts` type. Enforced: architecture-and-boundaries (`ui-presentational`, `layer-direction`), lint
   zones.
6. **Compose with `children` or slot props, not variant flags.** At most one boolean prop that changes
   layout: every flag doubles the states to design and test.
7. **Render is pure.** No `Date.now()`, `new Date()`, `Math.random()` or `performance.now()` during
   render, no ref read, no component declared inside a component, no state set during render. The
   compiler caches on the assumption that the same props give the same output; converting an instant
   (`new Date(dueAtMs)`) is fine. Enforced: lint (`react-hooks/purity`, `refs`, `static-components`,
   `set-state-in-render`, `no-restricted-properties`), checker [render-impure].
8. **A screen is a thin route, a pure view and one model hook.** The route file in `src/app/` renders a
   screen from `src/features/<feature>/` and calls only router hooks and the feature's model hook; the
   view (`<feature>-screen.tsx`) renders its props; `use-<feature>-model.ts` is the only code that reads
   stores, services, server state, the clock and navigation. Enforced: architecture-and-boundaries
   (`route-thin`, `route-leaf`), test (the model hook's `renderHook` test).

## Hooks and effects (9-14)

9. **Each hook in `use-<name>.ts`, exported as `useName`,** returning one value or an object with named
   fields, at most 3 parameters (an options object beyond), never JSX. A store file exports its
   `useXStore`, a context file its `useX`, and a React Navigation static-config guard file
   (`*-guards.ts`) its `if` hooks. The hooks and compiler lint recognise hooks by the `use` prefix.
   Enforced: checker [hook-file] (an exported hook in any other file), naming-conventions (`export-name`:
   the file's main export; check-file-names `hook-file`: a `use-x.ts` exports a second hook only when
   the file itself calls it, as `useTextStyle` calls `useFontScale`), lint `max-params`.
10. **An effect only synchronises with a system outside React:** (a) subscribe to an OS or native event
    and return the unsubscribe (`AppState`, `Keyboard`, Android's `BackHandler`, `Linking`), (b) push
    React state into a native API (`SystemUI.setBackgroundColorAsync`, `Appearance.setColorScheme`),
    (c) start and stop work tied to a focused screen (`useFocusEffect`), (d) record a measurement.
    Compute everything else during render or in the event handler that caused it.
11. **Never call a state setter synchronously in an effect body** (from a subscription callback or a
    promise continuation is fine). Enforced: lint `react-hooks/set-state-in-effect`.
12. **Every subscribing effect returns its cleanup and lists every dependency.** A callback the effect
    reads but must not re-subscribe for goes through `useEffectEvent` (React 19.2). A leaked listener
    keeps firing after unmount and after Fast Refresh; on Android a leaked `hardwareBackPress` handler
    that returns `true` swallows every later back press. A subscription made only in one branch
    returns its cleanup from that branch (`if (isOn) { …; return () => sub.remove(); } return
    undefined;`). Enforced: lint `exhaustive-deps` (error), checker [effect-cleanup] (`useEffect`,
    `useLayoutEffect`, `useFocusEffect` and `useFocusEffect(useCallback(…))` that add a listener
    (any `add*Listener` call: `addEventListener`, `addListener` and the named Expo / React Native
    forms such as expo-notifications `addNotificationResponseReceivedListener`, expo-network
    `addNetworkStateListener` and `Appearance.addChangeListener`, the same family async-safety reads),
    subscribe, call `watch*()`, or start a timeout, interval or animation frame; a `return` inside
    if/else, try or switch counts as the cleanup, one inside a nested listener does not; effects
    written as `function name() { … }` and expression-bodied effects are read too). Returning the
    subscription object or timer id itself (`return sub;`, or an expression body that is the subscribe
    call) is a leak; APIs that return an unsubscribe function (`navigation.addListener`,
    `NetInfo.addEventListener`, `store.subscribe`) may be returned directly.
13. **OS state comes from `useSyncExternalStore` or an OS-mirror store, never `useState` plus an
    effect.** A value one hook reads (foreground or not: `useIsAppActive()`) subscribes through
    `useSyncExternalStore`; a value many parts read (screen reader, reduce motion, Bold Text) lives in
    one vanilla store fed by one watcher (`systemA11yStore`, accessibility-as-code). No effect sets state,
    and one subscription serves every reader. Pass the third argument, a server snapshot: static web
    rendering (`web.output: 'static'`, the Expo template default) and hydration throw "Missing
    getServerSnapshot" without it (verified in react-dom 19.2.3's server and client builds).
14. **Reset state on an identity change with a `key`, not an effect.** `<TaskEditor key={task.id} />`
    starts fresh for another task; an effect that copies the new id into state renders twice and
    flashes the old value.

## React Compiler (15-20)

15. **No `useMemo`, `useCallback` or `memo` while the compiler is on.** The compiler memoizes JSX,
    handlers and derived values when the app config sets `experiments.reactCompiler: true` (the SDK 57
    template default). A measured need gets `// memo-exemption: <measurement>` in the file header and a
    reviewed file-scoped lint exemption in `eslint.config.mjs` (inline disables are off). With the
    compiler off the checker prints a note and leaves the memo APIs alone. Enforced: lint ban, checker
    [no-memo-apis].
16. **`'use no memo'` is a temporary escape hatch.** First a failing test that shows the compiler-caused
    bug, then the directive with `// use-no-memo-test: <that test's title>`; remove both together once
    the compiler is fixed. The directive switches optimization off silently. Enforced: checker
    [use-no-memo] (a missing marker, or a title no test file contains).
17. **Reanimated shared values use `.get()` and `.set()`, never `.value`.** The compiler cannot see a
    `.value` read or write and may cache past it. Enforced: checker [shared-value-get-set] (all app code;
    skia-canvas-rendering states the same rule for canvas code): names declared with `useSharedValue` or
    `useDerivedValue`, names typed `SharedValue<…>` or `DerivedValue<…>` (props, parameters), and any
    `x.value` inside a `useAnimatedStyle`, `useAnimatedProps`, `useDerivedValue`, `useAnimatedReaction`,
    `useAnimatedScrollHandler` or `useFrameCallback` callback. Not seen (review it): `.value` on a
    shared value that arrived untyped from another file and is used outside those callbacks, for
    example a destructured hook result written in a gesture handler.
18. **Factory-built hooks are not compiled.** The compiler compiles top-level components and hooks only,
    so the `useStyles` returned by `makeStyles` is not; `makeStyles` therefore caches its styles per
    `Theme` object in a `WeakMap` (design-system-structure owns it).
19. **Every `react-hooks/*` rule at error, `--max-warnings 0`.** When code breaks a Rule of React the
    compiler skips that function without a word; the lint error is the only signal.
    typescript-and-lint-rules owns the config (eslint-config-expo brings the rules).
20. **Jest runs the code uncompiled.** jest-expo's Babel caller does not ask for the compiler, so a test
    proves behaviour and subscription boundaries (a `<Profiler>` render count after an unrelated store
    change), never memoization. A memoization claim is proven on a device build (performance-budgets).

## Stores in components (21-24)

Rules 21-23 belong to state-management-zustand, which states and checks them; they are listed here so a
component author sees them, and this skill's checker does not repeat them.

21. **Always pass a selector.** `useTasksStore()` or `useStore(sessionStore)` without one re-renders on
    every change. Enforced: lint `storeWithoutSelector`; state-management-zustand `check-stores`
    [selector-missing].
22. **A selector returns a primitive or an existing reference;** one that builds an object or an array
    (a literal, `.filter`, `.map`, `.slice`, a spread, `Object.keys`, `new Set`) is wrapped in
    `useShallow` from `zustand/shallow`. In Zustand 5 a new value per call causes "Maximum update depth
    exceeded". Enforced: state-management-zustand `check-stores` [selector-new-object].
23. **Computing selectors live next to their reducer as pure functions** and are unit-tested;
    components call store actions only from handlers, never during render (state-management-zustand).
24. **Pin a hot component's re-render boundary with a `<Profiler>` test** that fails when it subscribes
    to an unrelated store (`examples/hide-for-premium.test.tsx`).

## Theme and styles (25-28)

25. **Every colour from `theme.colors.<token>`.** Light and dark (and a colour-blind set when the
    palette has one) switch without code changes. Enforced: lint `react-native/no-color-literals`,
    design-system-structure (`no-color-literal`).
26. **Themed styles: `const useStyles = makeStyles((theme) => { const styles = StyleSheet.create({…});
    return styles; });`** and `const styles = useStyles();` in the component; module-level
    `StyleSheet.create` for theme-free styles. This exact shape keeps `tsc` rejecting mistyped style keys,
    the start/end and colour-literal lints matching `StyleSheet.create`, and `react-native/no-unused-styles`
    matching the `styles` name.
27. **Themes are built once at startup** and handed to the theme provider; never create a `Theme` during
    render (design-system-structure).
28. **Spacing, radii, strokes, elevation, touch size, content width, durations and type sizes come from
    the theme tokens** (`src/theme/tokens.ts`, `src/theme/motion.ts`). Enforced: design-system-structure
    (`check-raw-values`).

## Text (29-32)

29. **Text only through the text primitive** (`AppText`). `Text` from react-native is imported only in
    `src/ui/app-text.tsx` (or the file `reactRules.textPrimitive` names). Enforced: lint, checker
    [banned-import].
30. **The text primitive sets `textAlign` and `writingDirection` from the text's language**, never
    `'auto'`: Latin text in an RTL UI stays left-aligned and Arabic text in an LTR UI right-aligned
    (design-system-structure, rtl-and-direction).
31. **Type roles, never raw font sizes;** never `fontWeight` with a custom family where the family is the
    weight (design-system-structure).
32. **Text grows to at least 200 %;** headings set the header role, text in another language sets
    `accessibilityLanguage` (accessibility-as-code).

## Right-to-left layout and insets (33-37)

33. **Only logical style keys:** `marginStart/End`, `paddingStart/End`, `paddingInline`, `start/end`,
    `borderStart*`. Enforced: lint `physicalStyleKeys`, rtl-and-direction.
34. **Rows are `flexDirection: 'row'` and mirror by themselves;** never `row-reverse` to fake RTL; never
    read `I18nManager.isRTL` outside the direction module (`src/i18n/direction.ts`); components read the
    direction context. Enforced: lint, checker [no-isrtl].
35. **Directional icons (back, chevron, forward, undo) flip inside the Icon primitive;** clocks, media
    controls and pictures never flip (rtl-and-direction, icons-app-icon-and-splash).
36. **Safe-area insets keep their physical side.** Take both sides symmetrically,
    `paddingInline: Math.max(gutter, insets.left, insets.right)`, or let `SafeAreaView` edges apply
    them; never `paddingStart: insets.left`: the notch, the camera cutout and Android's gesture bar do
    not move when the layout mirrors. `paddingLeft: insets.left` is no escape: React Native swaps
    `paddingLeft` to `paddingStart` in a right-to-left layout (rtl-and-direction's
    `physical-style-key` fails it). Enforced: checker [inset-direction].
37. **A custom canvas (a chart, a drawing surface, a game board) keeps `direction: 'ltr'`** unless its
    content is meant to mirror; its accessible element sits inside the same wrapper
    (skia-canvas-rendering).

## Pressables (38-43)

38. **`Pressable` and the Touchables only inside `src/ui/**`** (or `reactRules.pressableDirs`). Screens
    compose the shared buttons and rows, so accessibility and touch size are solved once. Enforced: lint
    (`Pressable` from react-native), checker [banned-import] (`Pressable`, `TouchableOpacity`,
    `TouchableHighlight`, `TouchableWithoutFeedback`, `TouchableNativeFeedback` from react-native, and
    the same names plus `RectButton`, `BorderlessButton` and `BaseButton` from
    react-native-gesture-handler; `GestureDetector` stays allowed).
39. **Every pressable has a role and a name made by `t()`;** icon-only buttons take a required `label`.
    VoiceOver, TalkBack and RNTL `getByRole` need both (accessibility-as-code: `pressable-role`,
    `pressable-name`).
40. **Each pressable's own box is at least 44 × 44 pt; never `hitSlop`.** Slop is invisible in layout
    and overlaps neighbours (accessibility-as-code: `touch-target`, `hit-slop`).
41. **State via `accessibilityState` and `disabled`; pressed feedback as a style function**
    `style={(state) => [styles.base, state.pressed && styles.pressed]}`. Destructuring `({ pressed })`
    breaks the boolean-name rule (a destructured boolean must read as a question). Enforced: checker
    [pressed-destructure].
42. **Never a pressable inside a canvas's `GestureDetector`;** the canvas is the detector's only child
    and the controls are siblings, or the gesture and the press fight for the touch
    (canvas-gestures-and-hit-testing).
43. **Every hold or long press has a screen-reader alternative** (`accessibilityActions`, or a
    confirmation dialog); a hold timer passes `reduceMotion: ReduceMotion.Never`, or reduce motion would
    finish a safety hold instantly (ui-component-library's `src/ui/use-hold-to-confirm.ts`;
    accessibility-as-code: `hold-alternative`).

## Lists (44-46)

44. **Data that grows with the user is a `FlatList` with `keyExtractor`;** FlashList when a profile
    shows the FlatList is the bottleneck; a `ScrollView` that maps data only for a short list that can
    never grow (onboarding steps, a settings section), with `// bounded-list: <the bound and why>` on one
    of the three lines above it. A ScrollView mounts every row at once; a FlatList mounts a window.
    Enforced: checker [scrollview-list] (any `.map`, `?.map` or `.flatMap` whose callback returns JSX
    between a ScrollView's tags, also behind `&&`, a ternary empty state or `[...list].sort(…)`, without
    the comment; a module-level UPPER_CASE constant list and an `Array.from` series are bounded by
    definition). Not seen: rows built into a variable above the JSX and rendered as `{rows}`.
45. **Keys are stable ids, never the index.** A list of data (`items.map((item, index) => …)`) keys by
    the item's id, also inside templates (`` `tag-${index}` `` is still an index key), and a
    `keyExtractor` never returns the index. A positional series generated with
    `Array.from({ length }, (_, i) => …)` (pager dots, filler cells) has no identity but its place and may
    key by it; so may a constant list whose values are the keys. Index keys remount the wrong rows when a
    filter or sort changes. Enforced: checker [list-key-index]; naming-conventions (`testid-index`) for
    testIDs.
46. **Measure before changing the list component.** The method and one measured example are in the
    patterns reference; the budgets belong to performance-budgets.

## Icons and canvases (47)

47. **Icons render through the app's Icon primitive** (icons-app-icon-and-splash owns the pipeline); a
    Skia `<Canvas>` is for multi-colour or animated art and custom surfaces, never one per list item
    (each canvas costs memory and a first-frame delay). How many canvases a screen may hold is a measured
    budget (performance-budgets); where canvas code lives is skia-canvas-rendering's.

## Layout, dark mode, motion, lifecycle and errors (48-55)

48. **Never `Dimensions`; never assume portrait or a phone.** Size from `useWindowDimensions()`,
    `useWindowClass()` or `onLayout`; layout maths in pure functions tested at the window table's sizes
    and at `fontScale` 2. iPad Split View and Stage Manager, Android multi-window, freeform windows and
    foldables resize the app at any time. Enforced: lint, checker [banned-import].
49. **Every screen sits in `ScreenFrame` with the edges that match what sits around it:**
    react-native-safe-area-context's `SafeAreaView` with physical `edges` (a required prop), the ground
    colour behind the system bars, a centred column at most `CONTENT_MAX_WIDTH` wide. The frame applies
    its provider's insets, and Expo Router's navigators reuse the root provider's, so an edge the screen
    shares with a bar that pads its own inset is added twice:

    | Above the screen | Below the screen | `edges` |
    |---|---|---|
    | nothing (`headerShown: false`, a full-screen modal) | nothing | `ALL_EDGES` |
    | a navigator header | nothing | `BELOW_HEADER_EDGES` (right, bottom, left) |
    | nothing (`headerShown: false` in `Tabs`) | the JS tab bar (`Tabs`) | `ABOVE_TAB_BAR_EDGES` (top, right, left) |
    | a header (the `Tabs` default) | the JS tab bar | `BETWEEN_HEADER_AND_TAB_BAR_EDGES` (right, left) |
    | a navigator header | nothing; the content pads the bottom inset as it scrolls under the home indicator | `BELOW_HEADER_SCROLLING_EDGES` (right, left) |

    A list-detail screen is the one exception: adaptive-layout's `ListDetailLayout` sits in
    react-native-safe-area-context's `SafeAreaView` with one of these edge sets, because ScreenFrame's
    `CONTENT_MAX_WIDTH` column is narrower than the two panes.

    The rows were verified by reading expo-router 57.0.24's sources (the tab bar pads `insets.bottom`
    itself and `SafeAreaProviderCompat` adds no provider when one exists), not on a device. Native tabs
    (`expo-router/unstable-native-tabs`) differ per platform and were not verified: the patterns
    reference ("Safe areas") says what the sources show. Android draws edge to edge, so a screen without
    its bottom inset and no tab bar sits under the gesture bar or the three-button bar. Enforced: type
    (`edges` is required), test (`screen-frame.test.tsx`, one case per row), review;
    `SafeAreaView` from react-native is a checker [banned-import] (deprecated, iOS only).
50. **When the text is large, rows stack.** `useWindowClass().isLargeText` (`fontScale >= 1.25`, iOS
    Extra Extra Extra Large and Android 1.3 upwards) turns horizontal rows vertical and drops values
    under their labels (accessibility-as-code owns the threshold).
51. **`userInterfaceStyle: 'automatic'`;** the theme provider resolves System, Light and Dark and keeps
    the native root colour in step (design-system-structure).
52. **Reduce motion only through `useReduceMotion()` and `<MotionConfig>`;** never Reanimated's
    `useReducedMotion()` (a module-load constant) (accessibility-as-code: `reduce-motion`; the motion
    moments belong to motion-and-animation).
53. **A route fails into Expo Router's `ErrorBoundary` export, a part that can fail on its own into
    `SubtreeErrorBoundary`.** The fallback offers exactly one way out and never retries from an effect or
    a timer; the boundary records through the error net or the error log port. The root `ErrorBoundary`
    and the error net are error-handling-typed-results'; a React Navigation app wraps its
    `NavigationContainer` in one recording class boundary instead.
54. **Catch what boundaries cannot see** (event handlers, promises, worklets, frame callbacks) where it
    happens and record it; async handlers start `task().catch(reportError)` and stay synchronous.
    Enforced: lint `asyncHandler`, `handlerBody`; error-handling-typed-results.
55. **Work stops while the app is in the background.** A canvas frame clock, a sound, a poll or a timer
    reads `useIsAppActive()` (iOS `inactive` and `background`, Android `background`) and pauses; the
    composition root's own listeners (a WAL checkpoint) subscribe once at the root. Enforced: test
    (`use-is-app-active.test.ts`); skia-canvas-rendering, audio-and-haptics-feedback and
    motion-and-animation (`useMotionLoop`) consume the hook, so its path and export name stay stable.
