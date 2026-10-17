# Layout and input on the web

How the same components lay out and take input in a browser: windows, styles, pointer, keyboard,
focus, text, scrolling and navigation. Facts read in react-native-web 0.21.3's sources on 2026-10-14
(file named per fact) and seen in a Chrome export of a canonical Tasks app. Re-verify by reading the
named files under `node_modules/react-native-web/dist/`.

## Contents

- 1. The window
- 2. Styles that change meaning
- 3. Pointer and hover
- 4. Keyboard and focus
- 5. Text and forms
- 6. Scrolling
- 7. Navigation, links and the back button
- 8. Images, fonts and assets
- 9. Feedback that does not exist

## 1. The window

- `useWindowDimensions()` is the browser window, which people resize freely and which can be 320 or
  2,560 points wide. adaptive-layout's window classes, pane rule and measured grids apply unchanged;
  never branch on `Platform.OS` for layout.
- `fontScale` is always 1 in react-native-web (`exports/Dimensions/index.js`): browser zoom scales the
  whole page instead, and people with large text use it. Test at 200 % browser zoom as the large-text case.
- Safe-area insets come from `env(safe-area-inset-*)` and are zero unless the page has
  `viewport-fit=cover` (the `+html.tsx` template sets it; `NativeSafeAreaProvider.web.js`).
- The page has no status bar and no home indicator; `StatusBar` renders nothing.

## 2. Styles that change meaning

react-native-web turns `StyleSheet` styles into atomic CSS classes (`css-*`, `r-*` in the exported HTML),
so the same style objects work, with these differences (`exports/StyleSheet/preprocess.js`):

| Style | On the web |
|---|---|
| `elevation`, `overlayColor`, `tintColor`, `resizeMode` (as a style) | ignored |
| `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius` | converted to one `box-shadow` |
| `marginStart`, `paddingEnd`, `start`, `end`, `borderStartColor`, ... | CSS logical properties (`margin-inline-start`, `inset-inline-start`): they mirror with the page's `dir`, and physical keys are never swapped (rtl-and-direction) |
| `marginHorizontal`, `paddingVertical` | `margin-inline`, `padding-block` |

So a shadow that relies on Android's `elevation` disappears on the web; design-system-structure's shadow
helper sets both. Hairlines (`StyleSheet.hairlineWidth`) are one CSS pixel.

## 3. Pointer and hover

- A mouse hovers: `Pressable` takes `onHoverIn` and `onHoverOut` (typed in React Native, and they fire for
  an iPad pointer and an Android mouse too). react-native-web also passes `hovered` and `focused` to the
  `style` and `children` functions (`exports/Pressable/index.js`), but React Native's
  `PressableStateCallbackType` types only `pressed`; keep hover state from `onHoverIn`/`onHoverOut` in
  the component, as `examples/task-row-web.tsx` does.
- Hover is a hint, never the only way to reveal an action: touch screens and keyboards have no hover.
- `cursor: 'pointer'` on a pressable tells a mouse user it is clickable.
- Gesture Handler gestures run on pointer events; a long press is a mouse hold. Right-click
  (`onContextMenu`) is web-only; offer the same action elsewhere.
- Reanimated runs on the JS thread on the web: heavy animation work competes with rendering
  (performance-budgets).

## 4. Keyboard and focus

- Every pressable is a tab stop (`tabindex="0"` in the export). `Enter` presses any pressable; `Space`
  presses only an element whose role is `button` (`modules/usePressEvents/PressResponder.js`,
  `isValidKeyPress`). A row with `role: 'checkbox'` or `'switch'` toggles with `Enter` but not `Space` on
  the web; keyboard users expect `Space` there, so test it.
- Focus order is document order: keep the visual order and the JSX order the same.
- Never remove the browser's focus ring without drawing one: track focus with `onFocus`/`onBlur` and
  draw the ring from the theme.
- `autoFocus` steals focus on every visit to the page; use it only in a form the person opened.
- Keyboard shortcuts belong to the browser first (`Ctrl+F`, `Ctrl+R`, `Cmd+W`); never bind them.

## 5. Text and forms

- `TextInput` maps `autoComplete`, `inputMode` and `enterKeyHint` to the HTML attributes
  (`exports/TextInput/index.js`), so password managers and the on-screen keyboard behave; set them
  (forms-and-input owns the fields).
- `Enter` (without Shift) in a single-line field calls `onSubmitEditing` and is not passed on
  (`exports/TextInput/index.js`); wire it to the form's submit, which people expect on the web.
- `Text` is selectable on the web by default (the browser's `user-select`), unlike a phone; `selectable={false}`
  maps to `user-select: none` (`exports/Text/index.js`). Set it on labels inside buttons and rows so a
  double-click does not select them.
- There is no software keyboard to avoid on a desktop; keyboard avoidance code (forms-and-input) must be a
  no-op there, not a layout shift.

## 6. Scrolling

- With `ScrollViewStyleReset` in `+html.tsx` the body does not scroll; the root `ScrollView` or `FlatList`
  does, so pull-to-refresh-like patterns and sticky headers behave as on a phone.
- A mouse wheel and a trackpad scroll a `ScrollView`; `RefreshControl` has no pull gesture on a desktop:
  give refreshing a button too.
- Lists still virtualize (`FlatList`, FlashList); a list rendered in full is as slow in a browser as on a
  phone.

## 7. Navigation, links and the back button

- Every route is a URL; people bookmark, share and reload them. Screen state that matters lives in the
  route (adaptive-layout's selection rule, navigation-and-routing's params).
- The browser's back button walks the history; there is no `BackHandler` event.
- `<Link>` renders an `<a href>`: middle-click and `Cmd`-click open a new tab. Use it for navigation instead
  of a pressable that calls `router.push`, so links behave like links.
- `Linking.openURL` opens **every** URL in a new tab, same origin included (react-native-web 0.21.3:
  `window.open(url, target ?? '_blank', 'noopener')`) unless a target is passed; use router navigation
  or `<Link>` for in-app URLs. `expo-web-browser` opens a popup.
- Deep links and universal links are just URLs on the web; when the web build serves a link host, copy
  that host's `apple-app-site-association` and `assetlinks.json` (one folder per host from
  deep-links-and-universal-links' generator, which owns their content) into `public/.well-known/`.
  They must be served over HTTPS with no redirect, as `application/json`, reachable from any IP and
  user agent; check with `curl -sI https://<host>/.well-known/assetlinks.json`. `+native-intent` runs
  only on iOS and Android: on the web the URL is the route, so an old path gets an Expo Router
  redirect route or a host redirect.

## 8. Images, fonts and assets

- Assets are served from `/assets/...` with hashed names; files in `public/` are served at their path
  (`/logo.png`). Never put files at `public/assets/` (a Metro reserved path).
- `expo-font` fonts loaded synchronously at the top of a component are preloaded into the static HTML
  (Expo's static rendering guide); a font loaded in an effect is not.
- `expo-image` renders an `img`; give every image an `accessibilityLabel` or mark it decorative, as on a
  phone.

## 9. Feedback that does not exist

| Native feedback | On the web | Do |
|---|---|---|
| Haptics | `navigator.vibrate`, blocked before the first tap, absent in Safari | never the only cue |
| `Alert.alert` | nothing | the app's own dialog |
| Screen-reader announcements | nothing | an `aria-live` region |
| Native share sheet | Web Share API, needs a press | fall back to copying a link |
| Splash screen | none | the `+html.tsx` ground colour |
| Local notifications | none | hide reminders on the web |
