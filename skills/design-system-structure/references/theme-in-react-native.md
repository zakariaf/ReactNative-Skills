# The theme in React Native

The file map, how the theme reaches components and the navigator, dark mode on both platforms,
makeStyles, static shadows, the press surface and right-to-left layouts. Verified on 2026-10-03
against Expo SDK 57 (expo-router 57.0.24, expo-system-ui 57.0.4, the `default@sdk-57` template
57.0.28), React Native 0.86.3 (New Architecture) and Reanimated 4.5.1; re-verify with
`npx expo install --check`, `npm view expo-template-default@57 version` and the React Native
`boxShadow` and shadow-props docs.

## Contents

- File map
- Mounting: the root layout and the navigation theme
- Dark mode on iOS and Android, and the root view
- makeStyles recipes
- Static shadows, rings and focus
- The press surface
- Right-to-left layouts
- What is verified and what is not

## File map

| File (app repo) | Holds |
|---|---|
| `design/tokens.json` | the token file (two tiers) |
| `contracts/design-system.json` (+ `.schema.json`) | the facts the checkers read |
| `src/theme/theme-types.ts` | `ColorTokens`, `Palette`, `Theme`, `ThemePreference` |
| `src/theme/tokens.ts`, `type-styles.ts`, `motion.ts` | token data copied from the token file |
| `src/theme/palette.ts` (+ `palette.test.ts`) | the palette, written by write-palette.mjs, and its core-pair test |
| `contracts/contrast.json` | the pairs the UI paints (accessibility-as-code owns it; write-palette and the checker read it) |
| `src/theme/contrast.ts` | WCAG maths |
| `src/theme/theme-set.ts`, `theme-context.ts`, `use-theme.ts`, `theme-provider.tsx` | themes built once, the context, the hook, `AppThemeProvider` |
| `src/theme/navigation-theme.tsx` (+ test) | `NavigationThemeProvider` and `toNavigationTheme`: the navigation theme mapped from the app theme |
| `src/theme/make-styles.ts` | the style factory, cached per theme |
| `src/theme/fonts.ts`, `text-locale.tsx`, `use-text-locale.ts`, `use-text-style.ts` | script fonts and metrics, the language seam (`TextLocaleProvider`) and its hook, the text style hook |
| `src/theme/shadow-styles.ts` | `shadow()`, `ring()`, `focusRing()` |
| `src/ui/app-text.tsx`, `use-balanced-wrap.ts` | the only text component and its balance search |
| `src/ui/pressable-surface.tsx`, `press-feedback-context.tsx` | the one press implementation and its feedback seam |

Everything in `src/theme` except the provider, navigation-theme and hook files is pure TypeScript (no
React Native at module level), so the checkers can import the data and `src/core` rules can never
reach it.

## Mounting: the root layout and the navigation theme

With Expo Router the root layout (`src/app/_layout.tsx`) mounts the providers once, around the root
`Stack` (`examples/root-layout.tsx`):

```tsx
<AppThemeProvider preference={themePreference} onError={recordThemeError}>
  <TextLocaleProvider value={{ language, direction }}>
    <PressFeedbackProvider onPress={playTap} playsSound>
      <NavigationThemeProvider>
        <Stack />
      </NavigationThemeProvider>
    </PressFeedbackProvider>
  </TextLocaleProvider>
</AppThemeProvider>
```

- `preference` comes from the saved settings (settings-and-preferences owns the store and its
  restore-before-first-paint); `AppThemeProvider` never reads a store itself, so it stays testable.
- `language` and `direction` come from the i18n root (i18n-strings-and-catalogs, rtl-and-direction).
- `playTap` comes from the audio and haptics ports (audio-and-haptics-feedback), and only when the
  app opts into a tap sound; without one, leave `PressFeedbackProvider` out (presses stay silent).
  When `onPress` plays a sound, write `<PressFeedbackProvider onPress={playTap} playsSound>`: the
  press surface then passes `android_disableSound`, or Android plays its system click (the Touch
  sounds setting) and the app's tap together. Haptics only: leave `playsSound` out.
- `onError` receives a failed root-view paint (below); the root layout passes the error log's
  `record` (error-handling-typed-results), since `src/theme` never imports `src/services`.

**Two theme providers, on purpose.** The SDK 57 template's root layout already renders
`<ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>` from `expo-router`: that
is React Navigation's theme (expo-router 57 re-exports `ThemeProvider`, `DarkTheme`, `DefaultTheme`
and the `Theme` type), and Stack and Tabs paint their headers, the tab bar and the screen container
from it. It does not provide the app's theme, and the app's theme does not reach it. So keep both:
`AppThemeProvider` outside (named so it never collides with the navigation one), and inside it
`NavigationThemeProvider` (`templates/src/theme/navigation-theme.tsx`), a small component that reads
`useTheme()` and passes the mapped colours to the navigation provider:

| Navigation colour | Role | Painted on |
|---|---|---|
| `primary` | `primary` | active tab, header buttons |
| `background` | `background` | the screen container behind every route |
| `card` | `surface` | headers and the tab bar |
| `text` | `text` | header titles, tab labels |
| `border` | `separator` | the hairline under headers and above the tab bar |
| `notification` | `danger` | tab badges |

`dark` comes from `DarkTheme`/`DefaultTheme` by `theme.scheme`, and `fonts` stay the platform's
unless the app maps them to its bundled families. Replacing the template's navigation provider with
the app's (and mapping nothing) leaves light headers and light screen backgrounds in dark mode,
which is worse than the template. navigation-and-routing owns the navigator code and may keep the
mapping with it; the colours above are what this palette needs.

`theme-provider-mounted` counts a mount only when a runtime file renders a value it imports from
`src/theme/theme-provider` (through `@/` or a relative path), so the template's navigation provider
alone fails it. `text-locale-provided` works the same way for `src/theme/text-locale`.
`navigation-theme-mapped` (when `expo-router` or `@react-navigation/native` is a dependency) fails a
navigation `ThemeProvider`, `NavigationContainer` or static `<Navigation>` whose theme is missing, a
bare `DarkTheme`/`DefaultTheme`, a ternary of them (also through a same-file const), or built in a
file that imports nothing from `src/theme`; it also fails when no mapped navigation theme is rendered
(the copied `navigation-theme.tsx` alone does not count, nor a component that renders it which
nothing the routes render reaches) and when `NavigationThemeProvider` renders outside
`AppThemeProvider` (it would read the context's light default). Outside means by JSX nesting, not by
text order, followed through helper components of the same file and through component files the
layout renders. The mount target is `src/app/_layout.tsx` with Expo Router; the rules SKIP only until
it exists.

**When the root layout's providers reach the lint's JSX depth.** The canonical ESLint config caps JSX
nesting at 5 (`react/jsx-max-depth`) and allows one component per file (`react/no-multi-comp`), and a
real root layout (services, data, i18n, theme, text locale, press feedback, navigation theme, Stack)
passes that quickly. Move the innermost part, the navigation theme and the root Stack, into a
component of its own file outside `src/app` (routes are leaves; for example
`src/features/root-navigator/root-stack.tsx` exporting `RootStack`, which renders
`<NavigationThemeProvider><Stack /></NavigationThemeProvider>`), and render `<RootStack />` inside
`AppThemeProvider`. Mark that file `// device-only: covered by the app launch on a device` like the
layout, since it only composes tested parts. The checker follows the component, so a `<RootStack />`
outside `AppThemeProvider`, or one nothing renders, still fails `navigation-theme-mapped`. The theme
context defaults to the app's light theme so a component test renders without a wrapper; the checks
are what keep the real app from running on that default.

**React Navigation 7 (static API) instead of Expo Router:** mount the same providers in `App.tsx`
around `<Navigation theme={toNavigationTheme(theme)} />` (the navigator's `theme` prop takes the same
mapped object; import `DarkTheme`, `DefaultTheme` and `ThemeProvider` in `navigation-theme.tsx` from
`@react-navigation/native` instead of `expo-router`). Without expo-router in `package.json` the mount
target is `App.tsx` (at the root or in `src/`), else the package.json `main` file: the checker reads
them as runtime files, fails a missing mount there, and SKIPs only while none of them exists.

## Dark mode on iOS and Android, and the root view

Three things must all hold, or the dark palette never shows (`color-scheme-config` checks the first
two):

1. `userInterfaceStyle: 'automatic'` in the app config (the Expo template default). With `'light'`,
   iOS reports light to `useColorScheme()` forever.
2. `expo-system-ui` installed: without it Android ignores `userInterfaceStyle` in development and
   release builds (Expo color-themes guide, verified for SDK 57).
3. `AppThemeProvider` resolves the saved preference (`system`, `light`, `dark`) against the phone and
   mirrors it with `Appearance.setColorScheme('light' | 'dark' | 'unspecified')`, so native UI
   (alerts, pickers, the keyboard, the date picker, the system bars) follows the in-app choice, not
   only the phone's.

**The root view.** Behind every screen sits the native root view, seen behind an iOS sheet as it
slides, during a navigation transition, and behind Android's transparent system bars where no
screen paints (Android draws edge to edge: enforced for apps targeting Android 15; SDK 57 targets
Android 16, where the opt-out is gone). Its colour is set at build time by the app config's
`backgroundColor` and at runtime by `expo-system-ui`'s `SystemUI.setBackgroundColorAsync`.
`AppThemeProvider` calls it in an effect with `theme.colors.background` whenever the ground changes,
so a dark theme never flashes a white root; the call is cosmetic, so a failure leaves the build-time
colour and goes to the `onError` prop (an effect event, so a new callback never repaints). The navigation theme paints the screen container itself (`background` above). The bar icons
follow the scheme through `expo-status-bar` (`style="auto"` reads the mirrored Appearance); a screen
that paints a different colour at its top sets the status bar style itself.

## makeStyles recipes

```ts
const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    card: {
      gap: SPACING.sm,
      paddingBlock: SPACING.md,
      paddingInline: SPACING.lg,
      borderRadius: RADII.md,
      borderWidth: STROKE.hair,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    overlay: { backgroundColor: theme.colors.scrim },
    dialog: { ...shadow(ELEVATION.overlay, theme.colors.shadow, 16) },
  });
  return styles;
});
// in the component: const styles = useStyles();
```

- The factory body is `const styles = StyleSheet.create({...}); return styles;`
  (`make-styles-factory`): React Native's excess-property check catches a typo in tsc, and the lint
  rules that match `StyleSheet.create` (`no-unused-styles`, `no-color-literals`, the start/end keys)
  keep working. A factory returning a plain object loses all three.
- Styles are cached per `Theme` object; the themes are built once at module load, so a theme switch
  costs one build per theme and style identities are stable.
- Logical keys only (`paddingInline`, `marginStart`, `start`/`end`); the lint bans left/right keys.

## Static shadows, rings and focus

React Native's New Architecture draws CSS-like `boxShadow` and `outline*` props on both platforms,
which the legacy props never did: `shadowOffset`, `shadowOpacity` and `shadowRadius` draw on iOS
only; `elevation` draws Android's own material shadow, whose offset and blur the token cannot
control; and `shadowColor` tints that Android shadow only on Android 9 (API 28) and later, while
on iOS it colours the legacy shadow (React Native shadow-props docs, verified 2026-10-03). One
token therefore renders differently on each platform (`no-legacy-shadow`). `shadow-styles.ts`
wraps the props that do not:

- `shadow(offset, color, blur = 0)`: `box-shadow: 0 <offset>px <blur>px <color>`, for parts that
  never move (a dialog, a menu).
- `ring(width, color)`: `box-shadow: 0 0 0 <width>px <color>`, a ring that takes no layout space.
- `focusRing(color)`: `outline: 3px solid; outline-offset: 2px`, following the border radius.

**Platform limits** (React Native docs, verified 2026-10-03): `boxShadow` needs the New Architecture
(the only one in SDK 57); outset shadows draw on Android 9 (API 28) and later, inset shadows on
Android 10 and later. The app's minimum is Android 7 (minSdk 24), so on Android 7 and 8 a static
shadow is simply not drawn: a control must still read as a control without it (its border or fill),
which is why the press surface draws its shadow as a View instead.

## The press surface

`PressableSurface` is the one press implementation; buttons, rows, segments and keys compose it with
their content (ui-component-library builds them). What it always owns, whatever it looks like:

- **One feedback seam:** every press runs `usePressFeedback()` before `onPress`, except a switch,
  whose handler plays its own toggle feedback with the state change. `android_disableSound` follows
  `usePressFeedbackPlaysSound()`: on only while the provider says its feedback plays a sound
  (React Native 0.86's `Pressability` plays the system click unless it is set). `press-feedback-context.tsx`
  imports only React, so `src/ui` stays presentational (the lint forbids `src/ui` importing
  `src/services`); without a provider it is silent, so component tests need no audio fake.
- **Accessibility state:** `accessibilityLabel` from the translated label, `accessibilityState`
  (`disabled`, `busy`, `selected`, `checked`), `accessibilityActions` for hold gestures (`activate`
  replaces the double tap on both screen readers). Disabled and busy controls ignore presses.
- **A disabled style from tokens:** the `sunken` fill and the `border` edge; `PRESS.disabledEdge:
  'dashed'` adds a dashed `textMuted` edge, a shape cue on top of the muted paint.
- **Reduce motion:** `isReducedMotion` comes from the app's reduce-motion hook (accessibility-as-code)
  through the screen model; the root `ReducedMotionConfig` makes the timings instant
  (motion-tokens.md).
- **Rows of buttons:** `isStretched` makes a control and its face fill the height its row gives it
  (two dialog buttons equally tall when one label wraps). Only a control in such a row sets it.

**The look is a token choice** (`PRESS` in `tokens.ts`, `press` in the token file), one for the whole
app; a control that must feel different (a keypad's keys) passes `pressKind`:

| `PRESS.kind` | iOS | Android (`androidRipple: true`) | Under reduce motion |
|---|---|---|---|
| `opacity` (default) | the face dims to `PRESS.opacity` | the platform ripple, `colors.separator` (or `rippleColor`), clipped to the radius | unchanged (a dim is not motion) |
| `scale` | the face shrinks to `PRESS.scale`, springs back with `SPRINGS.release` | the ripple | a dim instead of the shrink |
| `sink` (opt-in) | the key sinks into a hard shadow and squashes, springs back | the same sink (no ripple) | the sink without the squash |

The press in is `withTiming(1, { duration: MOTION_MS.pressIn, easing: Easing.bezier(...EASING.decelerate) })`;
the release is a spring for `scale` and `sink`, a `MOTION_MS.fast` fade for `opacity`.

**The sink look** (a toy-key or keypad design):

- **Shadow inside the key's box:** an absolutely positioned View painted `theme.colors.shadow`,
  offset `elevation` below the face. It hangs outside the layout box like a CSS box-shadow, so the
  layout leaves the gap (never margin for it) and no parent clips it with `overflow: 'hidden'`. A
  View draws on every Android version and moves with the press.
- **Pushed-in states move by layout:** a selected segment, a disabled or busy key sits at the pressed
  offset with `top: elevation` on the Pressable, never a transform (`pressed-by-layout`, checked when
  `PRESS.kind` is `sink` or the surface supports it). VoiceOver, TalkBack and Maestro report the
  layout frame and ignore transforms, so a transform-sunk key is announced and tapped `elevation`
  above where it is drawn. In the other looks a selected or disabled control keeps its place and
  shows its state with fill and edge, so no transform ever moves a persistent state either.

## Right-to-left layouts

- Layout mirrors, shadows do not: rows use `flexDirection: 'row'` and start/end keys; a shadow
  offset points down in both directions, and the squash is symmetric.
- Text sets `textAlign` explicitly (`TEXT_ALIGN.start` is `'left'`, which React Native swaps in a
  right-to-left layout); `'auto'` alignment follows the text's own script and puts an English word in
  an Arabic row at the wrong edge.
- `writingDirection` (from the text locale, or AppText's `direction`) is read by iOS only; Android
  takes each paragraph's direction from its first strong character, so AppText starts a text with an
  explicit `direction` with a direction mark there (text-and-fonts.md, "AppText"). A text in the
  layout's own direction that starts with a word of the other script still follows that word on
  Android: rtl-and-direction owns that case.
- Direction itself (forcing RTL, reloading, live switching), digits and bidi isolation belong to
  rtl-and-direction.

## What is verified and what is not

Verified in the reference Expo SDK 57 app (TypeScript 6.0.3 strict, ESLint 9.39.5 with the canonical
config and `--max-warnings 0`, Prettier, Jest 29.7 with jest-expo 57 and React Native Testing Library
14, the `unit` and `android` projects): every template compiles, lints and passes its tests; the
navigation mapping is rendered under `AppThemeProvider` and read back through expo-router's
`useTheme` (`navigation-theme.test.tsx`); `npx expo config` resolves the `expo-font` entry. Measured on an iPhone: the pixel-grid
rounding, the tall-script overflow, the balance-search pitfalls, the layout-vs-transform frames.
Read from source, not device-measured: Android's half-leading line boxes, the Android side of the
overflow guard, the font-scale multiplication of line heights on both platforms, the ripple
clipping. Not verified on a device: the cost of many `boxShadow` views, `outline` around rotated or
dashed views, and the root view colour behind an iOS sheet; check them in the first development
build on both platforms and report what you saw.
