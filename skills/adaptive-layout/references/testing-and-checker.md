# Testing adaptive layouts, and the checker

How to prove a layout at every window it can get (Jest first, devices second), and what
`check-adaptive-layout.mjs` reads, how to configure it, and where its heuristics stop.

## Contents

1. What to test, and where
2. Jest recipes
3. Device runs at the window table
4. The checker: rules and scope
5. The contract (`contracts/adaptive-layout.json`)
6. When multi-package
7. Limits (review these by hand)

## 1. What to test, and where

| Layer | Test | Proves |
|---|---|---|
| Pure maths (`pane-layout.ts`, a screen's own layout function) | table tests at the window table, at `fontScale` 1 and 2 | the decision at every size, including the boundaries |
| Hooks (`useListDetailLayout`, `useMeasuredWidth`) | `renderHook` with a mocked window, a `SafeAreaProvider` and fired layout events | the hook feeds the right numbers (the measured box, insets before the first layout, font scale) |
| Components (`ListDetailLayout`, a grid) | RNTL renders per layout state | which panes exist, the readable cap, state kept across a crossing |
| Routes (list-detail) | the router render helper | select pushes on one pane, sets the current route's own param on two (from either route), and follows a measured box narrower than the window |
| Devices | screenshots on named simulators and emulators | real insets, real resizing, real foldables |

Jest lays nothing out: `onLayout` never fires by itself and `useWindowDimensions` returns Jest's
default window unless mocked. So layout decisions live in pure functions that take numbers, and
tests feed those numbers.

## 2. Jest recipes

**Mock the window** (the canonical `use-window-class.test.ts` does the same; Jest's own default
`fontScale` is 2, so always set it):

```ts
const mockWindow = { width: 402, height: 874, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));
// in a test: Object.assign(mockWindow, { width: 744, height: 1133 }); then render or rerender
```

**Give the safe area metrics.** `SafeAreaProvider` renders nothing in Jest until it has metrics, and
`useSafeAreaInsets()` throws without a provider:

```tsx
<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 874, height: 402 }, insets: { top: 0, right: 62, bottom: 21, left: 62 } }}>
  {children}
</SafeAreaProvider>
```

**Fire a layout** for `useMeasuredWidth` or any `onLayout` consumer:

```ts
await act(() => { result.current.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 744, height: 600 } } } as LayoutChangeEvent); });
// or on a host element: fireEvent(screen.getByTestId('tasks.board'), 'layout', { nativeEvent: { layout: { ... } } });
```

**Prove a pane survives a crossing:** render, `rerender` with the other `PaneLayout`, rerender back,
and assert a child's mount callback ran once (`list-detail-layout.test.tsx`).

**Large text:** run every table at `fontScale` 2; `classifyWindow(width, height, 2).isLargeText` is
true, and the list pane widens to `LIST_PANE_WIDTH_LARGE_TEXT`.

**RTL:** Jest proves only that the code reads the direction (`renderWithProviders(ui, { direction:
'rtl' })`); that the list pane sits on the right in Arabic is a device or screenshot check.

## 3. Device runs at the window table

Never a booted or shared device: create named ones (`<project>-<purpose>`) and pass their ids
(ios-simulator-build and e2e-maestro own the commands).

- **iOS:** an iPhone (portrait and landscape), an iPad mini (portrait: two panes; at the largest
  accessibility text size: one pane) and a 13-inch iPad in landscape and in a half-width Split View
  (one pane, regular). Rotate with the simulator's own menu or Maestro's orientation command on the
  named device.
- **Android:** a phone AVD, a tablet AVD (`<project>-tablet`, API 36: the portrait lock is ignored,
  so landscape must look right), and the resizable or foldable emulator profile (fold and unfold
  while a detail is selected; the selection must stay). Pass `adb -s <serial>` to every adb call.
- Take screenshots at each row of the window table, with `fontScale` 2 on the iPad mini and the
  tablet, and with an RTL locale on one regular window.

## 4. The checker: rules and scope

`node ${CLAUDE_SKILL_DIR}/scripts/check-adaptive-layout.mjs [repo-root] [--app-dir <dir>] [--contract <file>] [--json]`

- **Scans** the layout's `srcDir` and routes folder (default `src/`, `src/app/`; moved by
  `rn-skills.config.json` `srcDir`), every `.ts/.tsx/.js/.jsx`, minus tests (`*.test.*`, `*.spec.*`,
  `__tests__/`, `__mocks__/`, `test/`) and `*.d.ts`, through the shared repo walk: agent skill folders
  (`.agents/`, `.claude/`, `skills/`, ...) and any folder holding a `SKILL.md` are never read. The
  config rules read `app.config.ts|js|mjs|cjs` or `app.json` and the `plugins/` folder.
- **Layout rules read UI code only.** `device-branch`, `device-orientation`, `raw-breakpoint`,
  `fixed-width`, `readable-width-token` and `grid-columns-*` read the files in the contract's
  `layoutGlobs`: by default the routes folder, `src/features/**`, `src/ui/**`, `src/hooks/**` and
  `src/theme/**`. Services, core, data and api code lays nothing out, so a hardware-capability read
  there is fine: a haptics adapter that checks `Platform.isPad` (iPads have no haptic engine), an
  image resize to `{ width: 1080 }`, a `result.width > 2000` size check, a capture service that reads
  the device orientation to rotate a photo. An app that keeps UI elsewhere (`src/components/`,
  `src/games/<id>/`, `src/canvas/`) adds those folders to `layoutGlobs`. The other rules
  (`window-class-fork`, `orientation-lock`, `orientation-unlock`, the list-detail and config rules)
  read every scanned file: a second classifier or a lock is a problem wherever it sits.
- **Rules** (each problem line names file:line, the rule and the fix): `device-branch`,
  `raw-breakpoint`, `window-class-fork`, `readable-width`, `readable-width-token`, `fixed-width`,
  `grid-columns-key`, `grid-columns-source`, `orientation-lock`, `orientation-unlock`,
  `device-orientation`, `config-orientation`, `full-screen-opt-out`, `tablet-support`,
  `list-detail-selection`, `list-detail-screens`. `--help` describes each.
- **Exempt from the width rules:** the breakpoint modules (default `src/hooks/use-window-class.ts` and
  `src/ui/adaptive/**`) for `raw-breakpoint`, `fixed-width` and `readable-width-token`; the theme folder
  for the width rules (tokens are values by design).
- **Accepted on purpose:** `requireFullScreen: true` or `UIRequiresFullScreen` in a config that also
  sets `UIRequiresFullScreenIgnoredStartingWithVersion` to 27 or lower (Apple TN3192's path for
  keeping full screen on older iOS versions only: the app resizes from that version on; a higher
  value fails and says why). A key set to its resizable value (`UIRequiresFullScreen: false`,
  `resizeableActivity` `'true'`) still fails, with the message "redundant: … remove it", because
  TN3192 asks apps not to include the key and the default already resizes;
  `orientation: 'portrait'` (a phone-only lock in practice); a route option `orientation: 'default'`
  or `'all'` (neither locks); expo-screen-orientation's `initialOrientation` when its family
  (`PORTRAIT*`, `LANDSCAPE*`) matches the contract's `appOrientation`, or when it is `DEFAULT`/`ALL`.
- **NOT APPLICABLE** when `package.json` does not depend on `react-native`.
- **SKIP lines** a passing run may print: `SKIP src/hooks/use-window-class.ts [window-class-fork] not
  yet created (react-components-and-hooks creates it)` and `SKIP app.config.ts [config-orientation]
  not yet created (expo-project-bootstrap creates it)`.
- **Exit codes:** 0 pass (SKIP and NOT APPLICABLE included), 1 problems, 2 bad input (no
  `package.json`, no source file, a missing `--contract` file, a malformed contract).

## 5. The contract (`contracts/adaptive-layout.json`)

Optional; copy `templates/contracts/adaptive-layout.json` (and its schema) when the app has a
list-detail screen, a full-bleed screen, an orientation lock or a deliberate profile. Every
exception carries its reason, so a reviewer reads why the rule does not apply.

| Key | Default | Meaning |
|---|---|---|
| `appOrientation` | `default` or `portrait` accepted | the orientation the app config must set (`landscape` only here) |
| `tablets` / `tabletsReason` | `true` | `false` with a reason: the app ships no iPad layout yet |
| `listDetailScreens` | `[]` | screens that must render `ListDetailLayout` (and need the kit) |
| `fullBleedScreens` | `[]` | `{ file, reason }`: screens that fill the window on purpose |
| `orientationLocks` | `[]` | `{ file, reason }`: files that may lock (and must unlock) the orientation, or read the device orientation |
| `breakpointModules` | the window-class hook, `src/ui/adaptive/**` | globs where width numbers may live |
| `screenGlobs` | `src/features/**/*-screen.tsx` | the files `readable-width` reads |
| `layoutGlobs` | the routes folder, `src/features/**`, `src/ui/**`, `src/hooks/**`, `src/theme/**` | the UI code the layout rules read (section 4) |
| `readableComponents` | `ScreenFrame`, `ListDetailLayout` | components that cap the width for the screen |
| `maxFixedWidth` | `288` | the widest fixed width a style may set |

## 6. When multi-package

Pass the app folder: `node ${CLAUDE_SKILL_DIR}/scripts/check-adaptive-layout.mjs . --app-dir apps/mobile`.
Paths in the output stay repo-relative (`apps/mobile/src/...`); the contract and the app config are
read inside the app folder; the layout (srcDir, routes, aliases) comes from that folder's
`tsconfig.json` and `rn-skills.config.json`.

## 7. Limits (review these by hand)

The checker is a set of source heuristics, not a type checker. Where a regex would grow fragile, the
limit is listed here instead; a reviewer reads new code for these shapes.

- `raw-breakpoint` reads a comparison whose other side names a width or height (`width`,
  `window.height`, `layout.width`, `shortestSide`, `Math.min(...)`) with a literal of 300 or more, or
  with a **file-local** numeric constant of 300 or more (`const TABLET_BREAKPOINT = 768; width >=
  TABLET_BREAKPOINT`). A constant imported from another file, or a computed threshold, is not seen:
  review new constants named like breakpoints.
- `device-branch` knows the common device APIs and helper names; a hand-rolled check through another
  name (`isBigDevice`) is not seen.
- `readable-width` accepts a screen that uses `CONTENT_MAX_WIDTH` anywhere in its code or renders
  one of the readable components as a JSX tag (`<ScreenFrame`) anywhere in the file; an import
  alone does not count. It does not prove the cap wraps the content.
- `fixed-width` reads a numeric literal, a file-local numeric constant, either branch of a one-line
  ternary (`width: isWide ? 500 : '100%'`) and JSX `width={n}`; a width from an import, a calculation,
  a multi-line ternary or a spread style is not seen. Media code inside a layout folder (a resize to
  `{ width: 1080 }` in a feature hook) is read as a style: move it into `src/services/`.
- `grid-columns-*` read `FlatList`, `FlashList` and `Animated.FlatList` tags in `.tsx`/`.jsx` files.
- `list-detail-selection` reads `const [x, setX] = useState(...)` in the feature folder of a file that
  renders `ListDetailLayout` when `x` is named `selected*`, `selection*` or
  `active/current/focused/open/chosen...Id|Key|Item`; another name (`const [pick, setPick]`), a
  `useReducer` or a store is not seen. It accepts the route reading when the feature folder calls
  `useLocalSearchParams`/`useGlobalSearchParams`, or a route file that imports from that folder does;
  it does not prove the value read is the one the panes show, or that two panes set the param the
  current route owns (the route test in `examples/tasks-list-detail.md` proves that).
- `useListDetailLayout` decides from the measured box; the checker cannot see a screen that wraps
  `ListDetailLayout` in a box that is not the panes' own (a fixed-width parent), so read the screen.
- The config rules read literal values in the app config (`orientation: 'portrait'`,
  `supportsTablet: true`); a value computed at run time is not read, and `tablet-support` then fails
  until the literal is there.
