# What "matches the design" means, in numbers

Every tolerance in `scripts/lib/gates.mjs` is a measured noise floor, not a preference. This page says
what was measured, what each gate catches, what no machine can check, and why a tolerance is never
widened.

## Contents

- Why screen-level pixel scores cannot be the gate
- The gates, their tolerances and the evidence
- Details that keep the gates honest
- Text ink: how a run is measured
- Measuring the type-role floors
- Borders and edge widths
- What the machine proves, and what only a look proves
- Why a tolerance is never widened
- Where the numbers come from

## Why screen-level pixel scores cannot be the gate

Measured on 2026-09-28 (iPhone 16 Pro simulator, iOS 26.5, a Release React Native 0.86.3 build;
Google Chrome 153 on macOS; the same font files on both sides):

| Build | Differing pixels (threshold 0.1) | SSIM |
|---|---|---|
| a correct screen | 0.13 to 0.51 % | 0.983 to 0.995 |
| a button 1 pt lower | 0.35 % | 0.987 |
| a label at weight 600 instead of 700 | 0.19 % | 0.992 |
| a wrong string ("pt" instead of "px") | 0.14 % | 0.994 |
| a fill one token off (`#1F5FBF` drawn `#3B6FD0`) | 0.14 % (missed) | 0.994 |

Correct builds and real defects overlap, and a perceptual pixel difference at threshold 0.1 does not
even see a clearly wrong fill. So the whole-screen difference is printed for information only, and the
gates below work per element, keyed by testID. Android emulator captures use the same numbers; they
were measured on iOS only (an Android probe run is an open item: references/devices-and-capture.md).

## The gates, their tolerances and the evidence

Fix failures in this order: a later gate's message is noise while an earlier one fails.

| Order | Gate (rule id) | Rule | Correct builds measured | Planted defect it caught |
|---|---|---|---|---|
| 1 | `capture-size` | the capture is the device profile's screen (a state card: its width, at most its height) | always | a capture from another simulator model |
| 2 | `screen-not-reached` | the frame's root testID is on screen (or the modal layer that proves it) | always | a pending system alert hid every testID |
| 3 | `scroll-mismatch` | a tall frame's capture is scrolled by the requested `scrollY` (clamped to the design's scroll end), within 2 pt | within 0.5 pt | a harness that ignored `scrollY` passed every offset with the top screen |
| 4 | `duplicate-testid` | one app element per testID | - | a copied row kept its testID |
| 5 | `missing` | every reachable design element with a testID exists (tall frames: once on screen; fewer than 8 pt on screen counts as off-screen) | - | an element not rendered, or its testID on an inner Text |
| 6 | `bounds` | x, y, width, height within **2 pt** | at most 0.9 pt off, plus Maestro's whole-point flooring (up to 1 pt) | panel padding 14 to 12: height -3.8 pt; border 3 to 2: the next block -3.6 pt |
| 7 | `text` | the accessibility label equals the design text (whitespace and bidi controls normalised) | equal | "Item 12" shown as "Item 13" |
| 8 | `fill` | the most frequent colour inside the element (inset by border + 2 pt, text excluded): max channel difference **3/255** | identical (difference 0) | a fill drawn 16/255 off; one 4/255 off |
| 9 | `border` | a solid border's thickness within **0.5 pt** and its colour within 3/255, read at three points on every side the element draws | passed on every correct probe build | a 3 pt border drawn 2 pt; one side drawn 1 pt |
| 10 | `text-ink` | per text run: ink width and height within **1 pt**; ink centre within **2 pt**, or the run's type-role floor + 0.9 pt where larger | ink box within 0.3 pt; centre within the role floors | a bold label drawn regular (width -13 pt); size 17 drawn 16 (-8 pt); weight 600 (-2.3 pt); a label moved 3 pt; a label 1 px past its role limit; a label in the wrong colour |
| 11 | `structure` | each element's painted area (box, hard shadow, ring, focus outline) cropped from both images, aligned within 6 px, diffed per pixel; a difference blob at least **1.5 pt thick** and 24 px large, outside text, fails | none | a missing icon; a shorter panel; a thinner border |

The self-test holds fixtures on both sides of each boundary: bounds 2 pt passes and 3 pt fails, fill
3/255 passes and 4/255 fails, a role limit of 2.3 pt passes 2.0 pt and fails 1 px past it.

## Details that keep the gates honest

- **Masks.** The device profile's OS-drawn areas (iOS status bar and home indicator; Android status
  bar and navigation bar) are never compared and never pull an alignment. Elements a frame masks keep
  their bounds check, but their pixels are skipped: a masked element still has to be in the right place.
- **Children answer for themselves.** A parent's crop ignores smaller compared elements inside it (plus
  2 pt), so one wrong icon fails that icon, not every card around it.
- **Crop-only parts ride in their cover.** Elements Maestro cannot list (inside an accessible element,
  or hidden from screen readers) are never paired and never cut out of a crop: their pixels stay inside
  the aligned crop of their `coveredBy` element, their text runs are placed by that element's measured
  offset, and a structure difference over one of them names it ("inside its crop-only part
  tasks.add-button.icon"). They are never reported `missing`.
- **Structure is per element, never whole screen.** In a correct RTL build, sub-point rounding added
  up to a 1 pt drift further down the screen; a whole-screen "blob at least 1 pt thick" rule failed that
  correct build, the per-element aligned crop passed it.
- **Floating elements** (checks without `bounds`: a toast the app places elsewhere than the mockup) are
  compared by text, fill and crop wherever they are, and are cut out of other elements' crops.
- **Rotated elements** may report either their box or its bounding box; both are accepted within 2 pt.
- **Transforms are invisible to bounds.** Maestro and the screen readers report layout frames, so a key
  sunk by a `translateY` transform measured 3 pt high. Anything that stays moved must move by layout;
  transforms are for transient animation only.
- **Tall frames** are compared per capture, the way the app shows them: the fixed header stays put, the
  body scrolls under it by the shift measured from the body elements (median), and pinned components
  sit at the bottom of the screen while the design draws them at the end of the page. Body pixels under
  the header or behind a pinned part are hidden in the app and never compared; an element partly hidden
  is checked by position only, and in full in the capture that shows it whole. `run-parity.mjs` plans the
  offsets so that every body element is fully on screen once, and `check-signoff.mjs` (`coverage`)
  demands it. Problem rects are page coordinates with a `viewRect` for this capture's screen.
- **State cards** (a fragment of a phone screen: one state of a purchase sheet, a toast stack) are
  compared by text, fill, border, ink size and crop, never by position. The fragment root has no
  structure check, the fragment's own stand-in heading is not ink-checked, a run's ink is judged by
  width and height only, and each part is compared inside its own painted shape (rounded box and hard
  shadows), because around it the design shows empty ground and the app the page behind it.
- **Off-screen slivers.** An element with fewer than 8 pt inside the body window counts as off-screen:
  iOS leaves such a sliver out of the accessibility snapshot Maestro reads, and the scroll plan shows it
  whole at another offset.
- **Behind a dialog card.** Text of the screen behind a dialog (`layout.dialogComponents`) is not
  ink-checked where the card, with its hard shadow, covers any part of it.
- **A region the app draws itself** (`probe`: a map, a game board, a chart canvas): the union of the
  rectangle the app reports and the design's placeholder is filled with one grey in both images, except
  where an element drawn over it paints (placed in the app by pixel alignment). Elements wholly inside
  are skipped with a `masked` note; everything around it, the overlays included, is gated in full.
- **A picture the app draws** (`appDrawn`): the union of both rectangles is filled in both images; the
  picture keeps its bounds check (a picture 4 pt off fails).

## Text ink: how a run is measured

Three things made correct text fail before, and the gate measures around each of them:

- **Ink by the run's text colour.** A run's ink is the pixels whose colour lies on the way from the
  window's background to the text colour, past halfway. The text colour is the owner's CSS colour when
  solid pixels of it are in the run's box, else the most frequent far-from-background colour; the
  candidate that leaves the most glyph ink wins. Ink components that touch the edge of the measuring
  window belong to something larger (a segment's rounded corner) and are dropped. A label in the wrong
  colour has no ink in the app and fails.
- **Rotated owners.** A run inside a tilted surface has an axis-aligned design rect that holds the
  surface's paper and border at its corners; only pixels inside the rotated line box count.
- **Inside the owner's box.** Chrome gives an Arabic-script run a tall line box (1.56 em) that reached
  into the label below and took in its dots; the window is clipped to the owner element's box (plus a
  2 pt pad), and ink components whose centre lies in another element's text box are dropped.
- **Pixel-measured owner edges.** The centre is judged against where the run's surroundings really are
  in the app: the owner's box, border, fill, separators and icons within 12 pt (then 36 pt) of the run
  are aligned between design and app, searched from Maestro's position to 1 pt further right and down
  (Maestro floors bounds to whole points). `report.json` records per run the role, the anchor source and
  both readings (`stats.textInk`).

## Measuring the type-role floors

A text engine places a role's glyphs a little off where Chrome places them in the same box, and that
offset depends on the family, the size, the weight and the line height. Measured on 2026-09-29 with a
probe of 72 rows (each role in a 2 pt bordered box), drawn by a Release build on the parity simulator
and by Chrome in software raster, box edges matched within 0 pt and the ink-centre floors were:

| Face (the source app's fonts) | Sizes probed | Floor range (pt) | Worst |
|---|---|---|---|
| a sans-serif text face, 400 and 700 | 11 to 21 | 0.32 to 1.37 | 1.37 at 14 (700, line height 1.2) |
| a rounded display face | 12 to 50 | 0.09 to 2.57 | 2.57 at 44 with line height 1.0 |
| an Arabic-script face, 400 and 700 | 13 to 28 | 0.47 to 1.19 | 1.19 at 28 |

These are evidence, not defaults: the floors that count are the app's own, measured for its own fonts
and written into `textRoleFloors` with their probe evidence. How to measure them:

1. Build a probe page: one row per type role the app uses (family, size, weight, line height from the
   theme), each text in a 2 pt bordered box, in every script the app ships.
2. Draw the same rows in the app (a test-only probe screen using the real text styles) and capture it
   with `capture-app.mjs` on the parity device; render the page with `shoot-design.mjs --out`.
3. Compare them with `check-parity.mjs` with no floors: every `text-ink` "moved" line names a role and
   its dx/dy. The floor of a size is the largest of |dx| and |dy| over its weights and line heights.
4. Write each into `textRoleFloors` with the probe's date, device and run folder. A floor over 3 pt, or
   one without evidence, fails the contract.

Before blaming glyph placement, rule out a type-role mismatch: compare the run's `font` in the
reference `.layout.json` (`700 17px/22.44px App Sans`) with the role the app uses. At line height 1.0
React Native clips tall Arabic-script marks and digits where Chrome lets them overflow (ink height
-9 pt), so a role for those scripts never uses 1.0; and a mark the platform shapes narrower (a madda
0 to 0.67 pt narrower, inside the 1 pt ink tolerance) that still exceeds 1 pt somewhere gets a
`platform-text-shaping` waiver naming the glyphs, never a wider tolerance.

## Borders and edge widths

- **Sides the element does not draw.** A CSS border lies inside its element's box. When the only band
  found on a side sits on or past the box edge (a tab without a bottom border standing on its list's top
  border), that side belongs to a neighbour and is not compared. A side the element does draw is read at
  three points.
- **The band ends at the outside colour.** Past the border, a pixel counts as band only as far as it
  blends the border into the colour outside, not into the element's own fill: a neighbour's fill nearer
  the border colour was once read as band (4.0 against 3.4 pt for the same 9 px edge).
- **Browser-rendered widths.** Chrome draws a CSS border of 1 px or more at whole CSS px (2.5 -> 2,
  1.5 -> 1), so a reference says `2px solid` where the token says 2.5. Components must draw the
  rendered width: ui-component-library's `specs.asRenderedBorders: true` floors border keys in the
  generated specs, and check-harness.mjs (`component-border`) fails while it is off. Rings
  (box-shadow), icon strokes and canvas strokes keep their token values.
- **Dashed and dotted borders** are compared by the crop only: React Native draws its own dash length
  and phase on both platforms, so the edge differs along the dashes (a known platform cause,
  signoff-and-waivers.md); a missing or thicker dashed edge still fails.

## What the machine proves, and what only a look proves

Machine-checked, for every device, theme and language: the same screen, the same set of testIDs, every
element within 2 pt, the same strings, the same colours (in practice exact), the same type size, weight
and alignment, and no shape difference of 1.5 pt or more inside any element.

Never promised: pixel identity. Glyph anti-aliasing and 1/3 pt rounding always differ; the text engine
places glyphs up to each role's floor away from Chrome; the OS status bar is not the mockup's.

Only a look at the sheets proves these; the ledger records each answer:

| Eye check | What to compare on the sheets |
|---|---|
| `icons` | icon shape, stroke weight, size and centring (eye-*.png pairs, crops) |
| `pictures` | illustrations, empty-state art, avatars, app-drawn pictures |
| `shadows` | shadow offset and edge, rings, focus rings, pressed depth at rest |
| `alignment` | optical centring, baselines in rows, equal gaps the gates tolerate within 2 pt |
| `wrapping` | line breaks, truncation, text that fits in every language |
| `direction` | RTL mirroring: rows, chevrons and back arrows flip; play icons, clocks, logos and media controls do not |
| `feel` | the whole screen next to the design: nothing extra, nothing missing, the same design character |

## Why a tolerance is never widened

A failing gate means the screen differs from the design by more than a correct build ever did; the fix
is in the app. If the platform truly cannot draw something the way the design does, that one problem
gets a waiver with its class and reason, reported to the reviewer (signoff-and-waivers.md); the
tolerance stays. No script has an option to change one.

## Where the numbers come from

- A probe app (2026-09-28): a screen with display and body text, 3 pt borders, radius 14, hard
  shadows and an Arabic-script block, built as a Release React Native app and captured on the parity
  simulator, against an HTML replica rendered by the same Chrome setup; good and planted-defect
  captures fixed the gate numbers.
- The type-role probe (2026-09-29): the floors above.
- Renderer determinism: with GPU rasterisation two Chrome renders of the same frame differed in 2 to
  2,451 edge pixels (up to 57/255); with `--disable-gpu` repeated renders are identical, and
  `shoot-design.mjs --check` proves a re-render is pixel-identical.
- Simulator determinism: two `simctl` screenshots of the same screen had 0 differing pixels, 1 s apart
  and across a reboot; hard shadows can re-dither by 1/255 on a redraw (the settle loop allows 3/255).
- The structure gate's per-pixel difference follows the published YIQ method with anti-aliasing
  detection at threshold 0.1 (scripts/lib/pixel-diff.mjs, zero dependencies); the blob rule (1.5 pt
  thick) absorbs any difference between implementations.
