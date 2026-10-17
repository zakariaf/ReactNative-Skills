# React Native APIs react-native-web lacks

Which React Native exports and members are missing, silent, wrong or different in react-native-web,
and what to use there instead. Verified on 2026-10-14 by comparing react-native 0.86.3 (`index.js` getters and
the `.d.ts` typings) with react-native-web 0.21.3 (`dist/index.js` and `dist/exports/*`), and by calling
them in headless Chrome. Re-verify:
`grep -c "export" node_modules/react-native-web/dist/index.js` and the comparison script in section 8.

## Contents

- 1. Missing exports
- 2. Missing members
- 3. Silent members
- 4. Wrong answers
- 5. Different answers
- 6. What counts as a guard
- 7. What to use instead
- 8. Re-verify

## 1. Missing exports

Imported from `react-native`, these are `undefined` in the browser and the first use throws.
Importing one throws nothing, so `web-rn-api` fails each **use** in the web bundle that no guard
(section 6) keeps off the web, not the import:

`ActionSheetIOS`, `DevMenu`, `DevSettings`, `DeviceInfo`, `DrawerLayoutAndroid`, `DynamicColorIOS`,
`NativeAppEventEmitter`, `NativeComponentRegistry`, `NativeDialogManagerAndroid`, `Networking`,
`PermissionsAndroid`, `PlatformColor`, `ProgressBarAndroid`, `PushNotificationIOS`,
`ReactNativeVersion`, `RootTagContext`, `Settings`, `Systrace`, `ToastAndroid`, `TurboModuleRegistry`,
`UTFSequence`, `VirtualizedSectionList`, `codegenNativeCommands`, `codegenNativeComponent`,
`registerCallableModule`, `requireNativeComponent`, `useAnimatedColor`, `useAnimatedValue`,
`useAnimatedValueXY`, `usePressability` (and the `unstable_*` and `experimental_*` exports).

`useAnimatedValue` is the surprising one: use `useRef(new Animated.Value(0)).current`, or Reanimated.

## 2. Missing members

Typed in react-native 0.86.3, `undefined` in react-native-web 0.21.3; calling one throws `TypeError`
(seen in the browser: `n.default.isBoldTextEnabled is not a function`,
`c.default.setColorScheme is not a function`):

| API | Missing |
|---|---|
| `AccessibilityInfo` | `announceForAccessibilityWithOptions`, `getRecommendedTimeoutMillis`, `isAccessibilityServiceEnabled`, `isBoldTextEnabled`, `isDarkerSystemColorsEnabled`, `isGrayscaleEnabled`, `isHighTextContrastEnabled`, `isInvertColorsEnabled`, `isReduceTransparencyEnabled`, `prefersCrossFadeTransitions`, `sendAccessibilityEvent` |
| `Appearance` | `setColorScheme` |
| `I18nManager` | `swapLeftAndRightInRTL`, `doLeftAndRightSwapInRTL` |
| `Keyboard` | `metrics`, `scheduleLayoutAnimation` |
| `Linking` | `openSettings`, `sendIntent` |
| `Alert` | `prompt` (react-native-web 0.21.3's `Alert` has only `static alert() {}`) |

## 3. Silent members

Present but doing nothing, so a feature disappears without an error. `web-rn-api` fails them too:

| Member | On the web | Instead |
|---|---|---|
| `Alert.alert` | nothing appears; a "Delete task?" confirmation never confirms | the app's own dialog (ui-states-and-feedback) |
| `AccessibilityInfo.announceForAccessibility` | nothing is announced | a `View` with `aria-live="polite"` whose text changes (react-native-web writes it to the DOM; the older `accessibilityLiveRegion` still maps, with a deprecation warning) |
| `AccessibilityInfo.setAccessibilityFocus` | nothing moves | focus the element (`ref.current?.focus()`) |

## 4. Wrong answers

Present, but answering wrongly for every visitor, so code that decides on them takes the wrong
branch. `web-rn-api` fails them like missing members unless a guard (section 6) keeps the read off the
web or a `.web` sibling replaces the file:

| Member | On the web | Instead |
|---|---|---|
| `AccessibilityInfo.isScreenReaderEnabled()` | **always resolves `true`** (react-native-web 0.21.3 source: `resolve(true)`; a browser cannot tell), so every visitor counts as a screen-reader user, and code that then calls `announceForAccessibilityWithOptions` (missing) throws | `Platform.OS === 'web' ? Promise.resolve(false) : AccessibilityInfo.isScreenReaderEnabled()`; on the web, design for screen readers always (live regions, labels) instead of switching on them (accessibility-as-code owns the store) |
| `I18nManager.isRTL` | `undefined`, so the layout direction reads as left to right for every language | `templates/src/i18n/direction.web.ts`: the direction of `<html dir>`, kept across the reload |
| `I18nManager.getConstants().isRTL` | `false` for every language | the same |
| `I18nManager.forceRTL`, `allowRTL` | do nothing: the page mirrors only through the `dir` attribute of `<html>` and logical styles | the same (`forceLayoutDirection` sets `<html dir>`) |

Without `direction.web.ts`, the canonical DirectionGate reloads an Arabic visitor's page, reads left to
right again, gives up (`flip-did-not-take`) on every load, and the page stays left to right; the
browser smoke's `browser-direction` (Chrome started with `--lang=ar`) catches it.

## 5. Different answers

Not failed by the checker; read them as web facts:

| API | On the web |
|---|---|
| `AccessibilityInfo.isReduceMotionEnabled()` | the `prefers-reduced-motion` media query; `true` where there is no `matchMedia` |
| `AccessibilityInfo.addEventListener` | only `reduceMotionChanged` ever fires; the others return a no-op subscription |
| `Vibration.vibrate` | blocked until the person taps the page; Safari has no Vibration API |
| `BackHandler` | no hardware back; the browser's back button walks the history (Expo Router keeps it in step) |
| `StatusBar` | renders nothing; the static setters do nothing |
| `Platform.OS` / `Platform.Version` | `'web'` / `'0.0.0'` |

## 6. What counts as a guard

`web-rn-api` leaves a use alone when it never runs in the web bundle. It reads `Platform.OS`
comparisons as values on the web (`=== 'web'` true, `=== 'ios'` and `=== 'android'` false, `!==` the
opposite) and combines them through `&&`, `||`, `!` and parentheses:

| Shape | Example |
|---|---|
| the body of an `if` whose condition is false on the web | `if (Platform.OS === 'android') ToastAndroid.show(...)`, `if (Platform.OS === 'ios' \|\| Platform.OS === 'android') { ... }`, `if (Platform.OS !== 'web') { ... }` |
| the `else` of an `if` that is true on the web | `if (Platform.OS === 'web') { ... } else Alert.alert(...)` |
| after an early `return` or `throw` true on the web, in the same function | `if (Platform.OS !== 'ios') return;` then `Settings.get(...)` |
| the operand of `&&`, `\|\|` or `? :` that never runs on the web | `Platform.OS === 'ios' && Appearance.setColorScheme('dark')`, `Platform.OS === 'web' ? undefined : Alert.alert('Done')` |
| inside a **function value** of a `Platform.select` key the web never picks: `ios`, `android`, `native`, or `default` when a `web` key exists | `Platform.select({ web: () => undefined, default: () => Alert.alert('Hi') })`, `Platform.select({ android: () => ToastAndroid.show('Saved', ToastAndroid.SHORT), default: () => undefined })` |
| a `typeof` feature test anywhere in the file | `typeof AccessibilityInfo.isBoldTextEnabled === 'function'`, `typeof PlatformColor !== 'undefined'` |

A **plain value** in a `Platform.select` object is never a guard, with or without a `web` key: the
object literal is built, every value evaluated, before `select` picks one (react-native-web 0.21.3:
`'web' in obj ? obj.web : obj.default`). `Platform.select({ ios: PlatformColor('labelColor'), web:
'#111111', default: '#111111' })` throws `PlatformColor is not a function` in the browser when the
module loads, so the checker reports it. Wrap the native value in a function
(`ios: () => PlatformColor('labelColor')`, then call the result) or move it into a `.ios.ts` file.

An `if (Platform.OS === 'ios' || isReady)` is not a guard: `isReady` can be true in a browser. What it
does not read: `switch (Platform.OS)`, a flag computed from `Platform.OS` elsewhere
(`const isNative = Platform.OS !== 'web'`), `Platform` imported under another name
(`import { Platform as P }`), and a destructured member
(`const { isBoldTextEnabled } = AccessibilityInfo`) (testing-web.md section 7).

## 7. What to use instead

- **System accessibility switches** (bold text, grayscale, reduce transparency, the screen reader): no
  browser reports them. The accessibility store's reads go behind `Platform.OS !== 'web'` with the
  default (`false`), or the store gets a `.web.ts` variant that reads the media queries a browser has
  (`prefers-reduced-motion`, `prefers-contrast`, `prefers-reduced-transparency` where supported)
  (accessibility-as-code owns the store).
- **The app's colour scheme** (`Appearance.setColorScheme`): the web has no native UI to recolour. Skip
  the call on the web; the theme provider still picks the palette, and `+html.tsx` paints the ground for
  both schemes.
- **Opening the app's settings** (`Linking.openSettings`): there is no settings page for a website;
  explain in the app how to change the browser's site permissions.
- **Toasts** (`ToastAndroid`): the app's own toast (ui-states-and-feedback).
- **Modals:** react-native-web honours `aria-modal` and `aria-labelledby` on a `View` and ignores
  `accessibilityViewIsModal`, the reverse of React Native, so a web-enabled app keeps `aria-modal` next
  to `accessibilityViewIsModal` on the scrim (accessibility-as-code accepts the pair).
- **Direction:** react-native-web maps the logical style keys to CSS logical properties
  (`marginStart` to `margin-inline-start`, `start` to `inset-inline-start`) and never swaps physical keys
  (rtl-and-direction). Logical keys mirror with the page's `dir`.

## 8. Re-verify

```sh
node -e '
const fs = require("fs");
const web = new Set([...fs.readFileSync("node_modules/react-native-web/dist/index.js", "utf8")
  .matchAll(/export \{ default as (\w+) \}|export \{ (\w+) \}/g)].map((m) => m[1] || m[2]));
const rn = [...fs.readFileSync("node_modules/react-native/index.js", "utf8").matchAll(/^\s+get (\w+)\(\)/gm)].map((m) => m[1]);
console.log(rn.filter((name) => !web.has(name)).join(" "));'
```

For members, list the keys of each `node_modules/react-native-web/dist/exports/<Api>/index.js` object and
compare with `node_modules/react-native/Libraries/**/<Api>.d.ts`. Update `assets/web-support-table.json`
and this file together, with the date.
