# Window classes, panes, readable widths and grids

How the app decides its layout from the window it has: the one classifier, the window table every
layout is proven at, the list-detail pane rule, readable widths, grids, and fixed widths. Verified on
2026-10-10 against Expo SDK 57 (React Native 0.86.3, react-native-safe-area-context 5.7.0,
expo-router 57.0.24) by reading the installed sources; re-verify commands are at the end.

## Contents

1. Window, not device
2. The one classifier (`useWindowClass`)
3. The window table
4. List-detail: when two panes fit
5. Readable widths
6. Grids: columns from the container
7. Fixed widths and the narrowest window
8. Large text inside adaptive layouts
9. Navigation chrome on wide windows
10. Decisions and their reasons
11. Verified facts and re-verify commands

## 1. Window, not device

The app never asks what it runs on. It asks how much space it has now. Every one of these gives the
same device a different window, at any time, without a restart:

| Situation | Platform | What the app sees |
|---|---|---|
| Rotation | both | width and height swap; the notch or cutout moves to a side (side insets appear) |
| Split View, Slide Over, Stage Manager, iPadOS 26 windows | iPad | any width from about 320 pt; a portrait-shaped window on a landscape iPad |
| Multi-window, freeform and desktop windows | Android | any size; on displays 600 dp and wider the app also ignores its orientation lock (API 36) |
| A foldable opening or closing | Android | compact cover screen to a near-square regular window, live |
| The system text size changes | both | `fontScale` changes; rows must stack (`isLargeText`) |

`Platform.isPad`, expo-device's `DeviceType`, `react-native-device-info`'s `isTablet()` and
`Platform.OS` answer none of these. An iPad in a third-of-the-screen Split View is a compact window,
and a phone in landscape is a regular one. The checker's `device-branch` rule fails a device check
that decides layout. `Platform.OS` stays fine for platform behaviour (a haptic, a share sheet), never
for how many panes to draw.

`Dimensions` is banned outright (react-components-and-hooks' `banned-import`): a module-level read
never updates, and `Dimensions.get('screen')` is the physical screen, not the app's window.

The same rules hold on Expo web (web-support owns the target): `useWindowDimensions` is the browser
window, which the person resizes freely, so the classifier, the pane rule and the measured grids work
unchanged, and a device check there is meaningless.

## 2. The one classifier (`useWindowClass`)

`src/hooks/use-window-class.ts` is canonical and owned by react-components-and-hooks; this skill
syncs a copy into its templates and never forks it (`window-class-fork`):

```ts
classifyWindow(width, height, fontScale) -> {
  width: 'compact' | 'regular',   // regular from REGULAR_WIDTH_MIN = 600 (Android's compact/medium boundary)
  isLandscape: width > height,    // the window's shape, not the device's orientation
  isLargeText: fontScale >= 1.25, // between iOS xxLarge (1.235) and xxxLarge (1.353), below Android 1.3
}
```

- **Compact** (< 600): every phone in portrait, a narrow Split View or Slide Over pane, a folded
  cover screen. One column, bottom tabs, one pane.
- **Regular** (>= 600): a phone in landscape, every full-screen iPad (the iPad mini portrait is 744
  pt), a half-width iPad Split View, an Android tablet, an open foldable. Wider margins, a capped
  column, and two panes **when they fit** (section 4).

Need a third class (Material's expanded at 840) or a height class? Do not add a comparison in a
screen: ask react-components-and-hooks to extend `classifyWindow` so every consumer stays
compatible, or derive a pane or grid rule in `src/ui/adaptive/pane-layout.ts` from what the content
needs (that is what the pane rule below does). Every other width comparison against a number of 300
or more is a `raw-breakpoint` failure.

## 3. The window table

Every adaptive layout function is tested at these sizes, and screenshots are taken at them:

| Window | Size (pt / dp) | Side insets | Class | List-detail panes (text 1 / 2) |
|---|---|---|---|---|
| narrow split-screen pane, small phone | 320 × 568 | 0 | compact | 1 / 1 |
| compact Android phone | 360 × 800 | 0 | compact | 1 / 1 |
| phone portrait | 402 × 874 | 0 | compact | 1 / 1 |
| phone landscape | 874 × 402 | 62 + 62 | regular | 2 / 1 |
| half-width iPad Split View (13-inch) | 678 × 1032 | 0 | regular | 1 / 1 |
| iPad mini portrait | 744 × 1133 | 0 | regular | 2 / 1 |
| Android tablet portrait | 800 × 1280 | 0 | regular | 2 / 1 |
| 13-inch iPad landscape | 1376 × 1032 | 0 | regular | 2 / 2 |

The 62 pt side insets are a current iPhone in landscape (the Dynamic Island side and its mirror).
The table lives as data in `templates/src/ui/adaptive/pane-layout.test.ts`; copy the rows into the
tests of every new layout function.

## 4. List-detail: when two panes fit

`listDetailLayoutOf({ width, windowClass })` in `pane-layout.ts`, fed by `useListDetailLayout()`:

1. A compact window always gets one pane.
2. The width is the **box the panes get**, not the window: `ListDetailLayout` reports its own width
   through `onLayout` (inside the screen's `SafeAreaView`, so the notch side is already off), and the
   hook decides from it. Before the first layout it estimates the window minus the physical side
   insets, which is exact whenever the screen spans the window. The box matters beside a side tab bar
   or a permanent drawer (an iPad mini in portrait with an 80 pt rail leaves 664 pt: one pane, not a
   343 pt detail) and in an iPad form sheet (about 540 to 700 pt inside a 1,376 pt window).
3. The list pane is `LIST_PANE_WIDTH` (320), or `LIST_PANE_WIDTH_LARGE_TEXT` (400) while the text is
   large.
4. Two panes when `usable >= listWidth + hairline + DETAIL_PANE_MIN_WIDTH (400)`, so from 721 pt with
   normal text and 801 pt with large text. Otherwise one pane.

Why a content rule and not "regular means two panes": a half-width 13-inch iPad Split View is 678 pt,
regular, and a 320 pt list beside a 357 pt detail reads as two cramped columns. Why not Material's
840: an iPad mini in portrait (744) and a large phone in landscape show list and detail comfortably,
as Apple's own split views do there. The constants are structural, not visual design tokens: change
them in one place with the window-table test.

One pane on the list route shows the list; one pane on the detail route shows the detail; two panes
show both on either route. The selection is the route's (list-detail-and-navigation.md). The window
table's pane column assumes the panes span the window; the hook's test adds a 664 pt box in a 744 pt
window.

## 5. Readable widths

A line of body text is comfortable at roughly 45 to 75 characters. At 17 pt that is about 600 pt, so
the theme's `CONTENT_MAX_WIDTH` (640, design-system-structure owns the value) caps every reading
column. Every screen file caps its content one of three ways (`readable-width`):

| Screen shape | How it caps | Why |
|---|---|---|
| A fixed screen (settings, a form, an empty state) | `ScreenFrame` (react-components-and-hooks): a centred column at most `CONTENT_MAX_WIDTH` | the frame owns the insets and the column together |
| A long scrolling list | the list's `contentContainerStyle`: `width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center'` | the margins still scroll, and the scroll indicator stays at the window edge instead of floating mid-screen |
| A list and its detail | `ListDetailLayout` in a `SafeAreaView` (not in `ScreenFrame`, whose 640 pt column is narrower than two panes): the list pane has its width, the detail pane centres a `CONTENT_MAX_WIDTH` column | a 1,055 pt detail pane would otherwise run the lines across it |

A screen whose content is meant to fill the window (a canvas, a map, a camera preview, a video) is
listed in `contracts/adaptive-layout.json` `fullBleedScreens` with its reason. A hand-written
`maxWidth: 720` is a `readable-width-token` failure: the cap is the token.

Centring is `alignSelf: 'center'` (or `alignItems: 'center'` on the parent), never a computed
`marginLeft`: logical and symmetric, it stays right in RTL.

## 6. Grids: columns from the container

A grid inside the detail pane of a 13-inch iPad is about 1,055 pt wide in a 1,376 pt window. Sizing
its columns from the window gives too many. Columns come from the grid's own box:

```tsx
const { width, onLayout } = useMeasuredWidth();           // null until the first layout
const columns = width === null ? 1 : gridColumnsOf({ width, minCellWidth: 160, gap: SPACING.md, maxColumns: 4 });
return (
  <View style={styles.fill} onLayout={onLayout}>
    {width === null ? null : (
      <FlatList key={`grid-${columns}`} numColumns={columns} ... />
    )}
  </View>
);
```

- `gridColumnsOf` fits as many cells of at least `minCellWidth` as the width allows, between 1 and
  `maxColumns`; `useMeasuredWidth` floors to whole points so the cells never overflow by a fraction.
- **The key is required.** React Native's `FlatList` throws `Changing numColumns on the fly is not
  supported. Change the key prop on FlatList when changing the number of columns to force a fresh
  render of the component.` the first time a rotation changes the count (`grid-columns-key`).
- Rendering nothing until the first layout avoids a one-column flash that then remounts.
- A computed `numColumns` in a file that does not call `gridColumnsOf` is `grid-columns-source`.

## 7. Fixed widths and the narrowest window

The narrowest window is 320 pt (a narrow Split View pane, the smallest phone). With 16 pt gutters on
both sides, 288 pt is the widest fixed width that never overflows. A style `width`, `minWidth` or
`flexBasis` (or a JSX `width={n}`) above 288 is `fixed-width`. Size regions with `flex`, percentages,
the pane layout's `listWidth`, or the measured container. Raise `maxFixedWidth` in the contract only
for an app that truly never runs narrower (and say so in its `$comment`).

## 8. Large text inside adaptive layouts

`isLargeText` (fontScale >= 1.25) already stacks rows (accessibility-as-code owns the threshold). In
adaptive layouts it also widens the list pane, so two panes need 801 pt, and a narrow regular window
falls back to one pane: a 320 pt list at 200 % text wraps every title onto three lines. Grids take
care of themselves when `minCellWidth` is a size that holds the text at 200 %; test the grid at the
window table at `fontScale` 2.

## 9. Navigation chrome on wide windows

How navigation looks on a wide window (bottom tabs, a side tab bar, a sidebar) is
navigation-and-routing's decision. Facts this skill relies on, read from expo-router 57.0.24's
bundled React Navigation sources, not run on a device:

- Expo Router's JS `Tabs` take `tabBarPosition: 'bottom' | 'left' | 'right' | 'top'`, and
  `tabBarVariant: 'material'` only with `'left'` or `'right'` (it throws otherwise). A screen may pass
  `tabBarPosition` from `useWindowClass().width`.
- A side tab bar pads the top and bottom insets and its own side's inset itself. A screen beside it
  then needs its bottom edge again (no bar below) and no inset on the bar's side: the four edge sets of
  `ScreenFrame` assume a bottom tab bar, so a side bar needs its own edge set, verified on a named iPad
  simulator and Android tablet emulator before it ships.
- A side bar also takes width from the screen. A list-detail screen beside it gets its pane count
  from its own measured box (section 4), never from the window, so switching the bar on at a
  regular width cannot squeeze the detail pane below `DETAIL_PANE_MIN_WIDTH`.
- `expo-router/unstable-split-view` (`SplitView`, `SplitView.Column`, `SplitView.Inspector`) is a
  native iOS split view: on Android and web it warns and renders a plain `Slot`, it allows at most two
  columns, and it cannot sit inside another navigator. It is not the default here: `ListDetailLayout`
  works on both platforms and keeps the selection in the route.

## 10. Decisions and their reasons

| Decision | Reason |
|---|---|
| Layout reads the window (`useWindowDimensions`, `useWindowClass`, `onLayout`), never the device | windows resize at any time on both platforms; device checks are wrong on iPad multitasking, foldables and Android tablets |
| One classifier, owned by react-components-and-hooks | two classifiers disagree at the boundary |
| Extra breakpoints only in `src/ui/adaptive/pane-layout.ts`, as content rules | a number in a screen drifts; a content rule explains itself |
| Two panes when list and detail both fit in the panes' measured box (the window minus the side insets until the first layout) | a regular window is not always wide enough; a side bar, a drawer or a sheet makes the box narrower than the window; the notch side is not usable space |
| Selection in the route | rotation, resizing and links keep the selected item; both layouts read one source |
| Readable column at `CONTENT_MAX_WIDTH` | long lines are hard to read; the token keeps every screen equal |
| Grid columns from the measured container plus a key | the window lies inside a pane; React Native throws on a changed `numColumns` |
| No fixed width above 288 | the 320 pt window must never scroll sideways |
| `orientation: 'portrait'` allowed as a phone-only lock | it is the Expo template default and phones honour it; tablets rotate anyway (platforms-orientation-and-resizing.md) |

## 11. Verified facts and re-verify commands

Run inside an app with the canonical stack installed (verified 2026-10-10 in the reference app):

- `useWindowDimensions` re-renders on width, height, scale or fontScale changes:
  `sed -n 18,40p node_modules/react-native/Libraries/Utilities/useWindowDimensions.js`.
- `Platform.isPad` is `interfaceIdiom === 'pad'`:
  `grep -n "isPad\|interfaceIdiom" node_modules/react-native/Libraries/Utilities/Platform.ios.js`.
- The `numColumns` invariant: `grep -n "numColumns on the fly" node_modules/react-native/Libraries/Lists/FlatList.js`.
- Side tab bar options: `grep -n "tabBarPosition?:\|tabBarVariant?:" node_modules/expo-router/build/react-navigation/bottom-tabs/types.d.ts`.
- SplitView is iOS-only: `grep -n "only supported on iOS" node_modules/expo-router/build/split-view/split-view.js`.
