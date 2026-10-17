# Layout and platform lessons

The traps that passed every unit test and broke on a device, each now a rule with a check. Jest has
no layout engine and no screen reader, so these are caught by reading the code, which is what
`check-components.mjs` does. Each says what happens on iOS and on Android.

## Contents

1. [flex: 1 in a cell of a row (pair-cell-flex)](#flex-1-in-a-cell-of-a-row-pair-cell-flex)
2. [A wrapping row centres only with alignContent](#a-wrapping-row-centres-only-with-aligncontent)
3. [A child's alignSelf beats its parent's alignItems](#a-childs-alignself-beats-its-parents-alignitems)
4. [Percentages on an absolute child (hold-fill-track)](#percentages-on-an-absolute-child-hold-fill-track)
5. [Underlines are drawn (drawn-underline)](#underlines-are-drawn-drawn-underline)
6. [A scatter placed by start mirrors (scatter-ltr)](#a-scatter-placed-by-start-mirrors-scatter-ltr)
7. [Fixed heights clip at large text (fixed-text-height)](#fixed-heights-clip-at-large-text-fixed-text-height)
8. [The modal root and Android back (modal-root, modal-back)](#the-modal-root-and-android-back-modal-root-modal-back)
9. [The testID on the measured box (testid-on-inner-text)](#the-testid-on-the-measured-box-testid-on-inner-text)
10. [Directions: what mirrors and what does not](#directions-what-mirrors-and-what-does-not)
11. [Press looks per platform](#press-looks-per-platform)

## flex: 1 in a cell of a row (pair-cell-flex)

A component that sits in a cell of a row or grid (a column View that shares the row) must keep its
content height there. React Native's `flex: 1` is `flexGrow: 1, flexShrink: 1, flexBasis: 0`, and
on the cell's vertical axis a zero basis collapses it: a row of toggle keys measured 0 pt on the
device and the keys were drawn over the button below. Yoga does the same on iOS and Android. The
component's layout style is `{ flexGrow: 1 }`: it grows to the row's tallest item and keeps its own
height when the screen stacks the grid at large text. `flex: 1` along a row's own axis (equal
segment widths) is fine, because that axis has a definite size. The catalogue marks such components
`inPairCell`; their tests pin `flexGrow: 1` and the absence of `flex: 1`.

## A wrapping row centres only with alignContent

A row with `flexWrap: 'wrap'` (a ListRow with a `below` line) aligns its lines by `alignContent`,
whose Yoga default is `flex-start`, while CSS centres a single-line flex row. A one-line row taller
than its parts then shows them at the top. Set `alignContent: 'center'` next to
`alignItems: 'center'`.

## A child's alignSelf beats its parent's alignItems

Badges and chips hug their text with `alignSelf: 'flex-start'` on themselves, so a parent's
`alignItems: 'center'` leaves them at the start edge. Centre one in a row wrapper with
`justifyContent: 'center'`, or (inside a component) wrap it in a View with `alignSelf: 'center'`, as
OptionCard does for its badge. The components take no alignment prop: the screen places them.

## Percentages on an absolute child (hold-fill-track)

Yoga resolved the percentage width of an absolutely positioned child inside its parent's padding
(where CSS uses the padding box), so a hold fill placed straight in a padded face covered its share
of the inner width and stopped short of the edge when full (16 pt on a 310 pt key, measured on the
iOS simulator). The
fill lives in a track pinned to the face edges (`position: 'absolute'`, `top`, `bottom`, `start` and
`end` 0, `flexDirection: 'row'`, `pointerEvents="none"`) and takes its percentage there with
`alignSelf: 'stretch'`. Same on both platforms (Yoga).

## Underlines are drawn (drawn-underline)

`textDecorationLine: 'underline'` draws the platform's line: on iOS a thin line at the font's own
depth, on Android the `UnderlineSpan` from the font's metrics. Neither thickness nor offset can be
set from React Native. When a design specifies them, draw a bar of the label's colour under the
text (`textButton.underlineThickness`, `underlineOffset`), hidden inside the button's accessible
element. The catalogue marks such components `drawnUnderline`.

## A scatter placed by start mirrors (scatter-ltr)

Decorative pieces placed with `start: x` (confetti) move to the other side in a right-to-left
layout, while a design scatters them the same way in every language. Physical `left` is banned in
styles (lint and rtl-and-direction), so the band sets `direction: 'ltr'`, where `start` is the left
edge. The catalogue marks such components `scatter`.

## Fixed heights clip at large text (fixed-text-height)

A face with `height` and a label inside clips the label when the text grows (accessibility-as-code
requires text to reach 200 %). Faces take `minHeight` from the specs and grow; `fixed-text-height`
fails a style with a fixed `height` used by an element that holds an AppText. A track, a bar or a
thumb without text may keep a fixed height.

## The modal root and Android back (modal-root, modal-back)

- **iOS:** `accessibilityViewIsModal` keeps VoiceOver inside a layer, and it hides the identifiers
  of the element's ancestors from the accessibility tree. On a dialog card it hid the scrim's testID
  and the screen under it, and every E2E capture of the dialog failed "screen not reached". The flag
  sits on the modal root (the Scrim) only.
- **Android:** `accessibilityViewIsModal` does nothing for TalkBack; React Native's `Modal` is a
  separate window, so TalkBack stays inside it. That is why the Scrim renders in `Modal`.
- **Visual parity captures:** the same flag hides everything outside the layer from the tree Maestro
  reads, the parity launch marker included. An app that adopts design-visual-parity renders its
  `<ParityLaunchMarker />` as the first child of the Scrim's `accessibilityViewIsModal` View (never
  beside it, as the first child of `Modal`); that skill's check-harness enforces it. The template
  stays parity-free, and dialogs that compose the Scrim inherit the marker.
- **Back:** `Modal`'s `onRequestClose` receives the hardware back button and the predictive back
  gesture (React Native 0.86.3 registers an `OnBackPressedCallback` on the dialog; verified on
  2026-10-03 by reading its source, not run on a device here; re-verify with
  `grep -n OnBackPressedCallback node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt`).
  A layer drawn in the tree instead subscribes to `BackHandler` `hardwareBackPress` while open and
  returns `true`. `modal-back` fails a modal root with neither.
- **iOS has no dismiss gesture on the Scrim.** A `transparent` Modal presents `overFullScreen`;
  swipe-to-dismiss (`allowSwipeDismissal`, which then calls `onRequestClose`) belongs to the
  `pageSheet` and `formSheet` presentations. The dialog's buttons are its only way out on iOS
  (verified on 2026-10-03 in React Native 0.86.3's source; re-verify with
  `grep -n -A3 allowSwipeDismissal node_modules/react-native/Libraries/Modal/Modal.js`).
- **Edge to edge:** an app that targets SDK 35 or higher (Expo SDK 57 apps do) runs edge to edge
  on Android 16, and on Android 15 unless its theme opts out; React Native 0.86 then turns on its
  edge-to-edge flag, and the Modal's `statusBarTranslucent` and `navigationBarTranslucent` read
  true whatever the props say, so the scrim already covers the system bars there. The two props
  make Android 14 and older match (no lit bands above and below the scrim) and are always set
  together: `navigationBarTranslucent` without `statusBarTranslucent` is unsupported, and React
  Native warns "Modal with translucent navigation bar and without translucent status bar is not
  supported." in development (verified on 2026-10-10 in React Native 0.86.3's source; re-verify
  with `grep -n 'isEdgeToEdgeFeatureFlagOn' node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt`,
  `grep -n -A20 'fun updateEdgeToEdgeFeatureFlag' node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/views/view/WindowUtil.kt`
  and `grep -n -A4 'navigationBarTranslucent === true' node_modules/react-native/Libraries/Modal/Modal.js`).

## The testID on the measured box (testid-on-inner-text)

On iOS an `accessible` View becomes one element and its children's testIDs disappear from the
tree E2E tools read. A chip or header with its testID on the inner text was reported with the
text's bounds or not at all. The id, `accessible`, the role and the label go on the box the design
measures. Observed on the iOS simulator; Android keeps child resource ids in its hierarchy, so the
same component works there too.

## Directions: what mirrors and what does not

| Mirrors with the layout | Stays the same in every language |
|---|---|
| rows, the order of buttons in a row, padding and margins (logical keys), fills that grow from the start edge, a slider's value, the toggle knob's travel, the chevron | a check mark (its frame is `direction: 'ltr'`), a decorative tilt, a scatter (`direction: 'ltr'`), numbers inside a chart's bars |

rtl-and-direction owns direction switching and bidi isolation; the library uses logical keys
(`start`, `end`, `paddingInline`) and reads the direction from `useTextLocale()` only where a
drawing must turn (the chevron, the slider's value from a touch's x).

## Press looks per platform

The press look is design-system-structure's `PRESS`: by default a dim on iOS and the Material
ripple on Android (`PRESS.androidRipple`), a slight shrink with `scale`, or the opt-in `sink` key.
A component never adds its own (`own-press-look`), so every control on a platform answers the same
way, and a scale look becomes a dim under reduce motion (a size change is motion).
