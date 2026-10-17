# Layout and shape tokens

How the spacing, frame, width, radius, stroke, elevation and touch-target tokens are structured and
used. The values are the app's design (the templates ship neutral demo values); the structure is
what keeps screens consistent. Verified on 2026-10-03 against the Expo SDK 57 safe-areas and
system-bars guides, expo-router 57.0.24 (`ExpoRoot` mounts `SafeAreaProvider`) and the Android 15
and 16 behaviour changes; re-verify with `grep -l SafeAreaProvider node_modules/expo-router/build/ExpoRoot.js`
and the "Edge-to-edge" sections of developer.android.com/about/versions/16/behavior-changes-16.

## Contents

- Spacing and layout steps
- The screen frame
- Wide windows
- Radii
- Strokes
- Elevation
- Touch targets
- Component measurements
- Adding a token group

## Spacing and layout steps

- `SPACING` is the scale (the demo's 4-point steps, `xxs` 2 to `xxl` 32). Gaps and paddings inside
  components pick a step by name.
- A design always has a few values off the scale: a 20 pt screen gutter, a 14 pt gap between
  blocks, a body that ends 34 pt above the bottom. Name each once as a **layout step**, a `LAYOUT`
  object in `tokens.ts` (`{ screenGutter: 20, blockGap: 14, bodyEnd: 34 }`) copied from a `layout`
  group of the token file, and log it as **Chosen**. Name a step by what it spaces, never by its size
  (`blockGap`, not `gap14`), so a redesign changes one value.
- No checker bans a raw padding (spacing numbers are too common in valid code to flag): reviews and
  design-visual-parity catch them. The habit that holds: a screen file contains no spacing number.

## The screen frame

- **The ground fills the whole screen,** behind the status bar and Android's navigation bar. Android
  draws edge to edge for apps that target Android 15 (API 35), and an app that targets Android 16
  (API 36, what SDK 57 targets) can no longer opt out on Android 16 devices. The navigation theme's
  `background` paints the screen container and `AppThemeProvider` paints the root view behind it
  (theme-in-react-native.md), so no strip of build-time colour shows at the edges.
- **Insets come from the device, never from a mockup.** A mockup's 54 pt status bar and 34 pt home
  indicator are one phone's numbers; read `useSafeAreaInsets()` from react-native-safe-area-context
  (Expo Router already mounts its provider). On Android the bottom inset is the gesture bar or the
  three-button bar, and both change with the person's navigation setting.
- **A fixed bar over a scrolling body:** the top bar sits outside the `ScrollView` and takes
  `paddingTop: insets.top`; only the body scrolls, and its `contentContainerStyle` ends with
  `LAYOUT.bodyEnd + insets.bottom`, so the last row scrolls clear of the home indicator. A native
  Stack header handles its own top inset.
- **Sides:** `paddingInline: Math.max(LAYOUT.screenGutter, insets.left, insets.right)` keeps content
  clear of a landscape notch or a camera cutout. Insets are physical sides while the style keys are
  logical (start/end), so take the larger one symmetrically.

## Wide windows

On tablets, unfolded foldables, landscape phones and split screen, lines grow too long to read and
rows too wide to scan. The body is a centred column of at most `CONTENT_MAX_WIDTH`
(`{ width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' }`) while the ground still fills
the window. The window changes size while the app runs (fold and unfold, split view, iPad Stage
Manager): read `useWindowDimensions()` in render, never `Dimensions.get()` once at module load.
Full-bleed images and backgrounds are meant to bleed and stay outside the column.

## Radii

`RADII` holds a few steps; a component picks one. Nested corners look parallel when the inner radius
is the outer radius minus the inset between them (a card of radius 16 with 8 pt padding holds an
image of radius 8); below the smallest step use 0. A pill or circle (radius = height / 2) is a design
choice, and a brand that forbids it turns on `rawValues.policy.maxRadius` (`no-pill`).

## Strokes

- `STROKE` holds the border widths: `hair` (separators), `regular` (a control's edge), `bold`
  (emphasis). An edge is a control's boundary when its fill alone stands less than 3:1 off the ground,
  so it uses `border`, never the decorative `separator` (palettes-and-contrast.md).
- **A dashed edge is a state cue,** never decoration: disabled (`PRESS.disabledEdge: 'dashed'`),
  locked, empty. It carries the state without colour. Check a dashed edge with a radius on both
  platforms in the first development build (not measured here).
- `StyleSheet.hairlineWidth` is one device pixel, while a 1 pt token is 3 px at 3x: pick one on
  purpose per role.
- **A stroke token holds the width as rendered.** Keep border widths on whole points or on the
  device pixel grid. A fractional token (2.5 from a mockup) is drawn differently by each target: a
  browser baseline floors CSS border widths (2.5 renders as 2), and iOS and Android snap borders to
  device pixels (2.5 pt is 7.5 px at 3x, rounded by the platform's own rule). So when the design
  baseline is a web page or a design-tool export, take `STROKE` from the baseline as it renders (2,
  not 2.5) and log the choice as **Derived** in the decision log; design-visual-parity proves the
  match. The rounding rules come from the CSS spec and the platforms' pixel snapping, not from a
  device measurement here.
- **Icon strokes are not borders.** An icon's stroke follows its icon grid (for example 2 units on a
  24-unit grid) and scales with the icon's size; a `ring()` box-shadow is not a border either and takes
  no layout space. Neither belongs in `STROKE`.

## Elevation

`ELEVATION` names a level by meaning: `flat` (in the page: rows, panels), `raised` (a lifted control),
`control` (a pressable key; with `PRESS.kind: 'sink'` it is also the key's travel), `overlay`
(dialogs, menus). One level per meaning, never one per component. Static shadows use
`shadow(ELEVATION.overlay, theme.colors.shadow, blur)`. On a dark ground a shadow barely shows, so
dark surfaces separate by lightness (`surface` one step lighter than `background`): the palette's job.

## Touch targets

`MIN_TOUCH` is the smallest target: 44 pt for Apple's guidance; raise it to 48 for a Material design.
Never reach the size with `hitSlop`: the target looks smaller than it is, and screen-reader focus
frames show the drawn size. accessibility-as-code owns touch targets and their check.

## Component measurements

A number only one component uses (a switch's knob, an avatar's size, a chip's padding) is a named
constant in that component's file (`const KNOB_SIZE = 26`), or a component group in the token file
(`components.chip`) mapped through the contract when the design documents it. The theme modules hold
only what several components share; ui-component-library builds the components. The demo token file
already carries that skill's `components` group (the measurements its templates were built from,
projected into its `component-specs.json`); check-design-system resolves its aliases but compares
only the groups the contract maps, so an app without the component library may delete the group.

## Adding a token group

Add the group to `design/tokens.json` first, export it from `tokens.ts` with the same shape, and add
`{ "file": "src/theme/tokens.ts", "name": "LAYOUT", "token": "layout" }` to the contract's `exports`
so `theme-mismatch` compares it value by value.
