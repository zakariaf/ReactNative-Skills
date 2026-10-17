# Text and fonts

AppText, type roles, the pixel grid at every font scale, tall scripts, balanced headings, tabular
figures, bundled fonts and the system font on iOS and Android. Facts verified on 2026-10-03 against
Expo SDK 57 (expo-font ~57.0.4, the Expo fonts guide), React Native 0.86.3 (its source, paths below)
and Reanimated 4.5.1; device measurements were taken on an iPhone at 3x and the default text size
(marked "iOS, measured"). Re-verify with `npm view expo-font@~57.0.0 version`, the Expo fonts guide
and the React Native files named below.

## Contents

- AppText: the only component that renders text
- Type roles and component styles
- Line heights on the device pixel grid
- The font scale: what React Native multiplies
- No glyph nudges
- Tall scripts: line heights and the overflow guard
- Balanced display text
- Tabular figures
- System font (the template default)
- Fonts: choosing, naming, bundling, pinning
- Every script of the app's languages
- One family name with fontWeight (fenced alternative)
- Font scaling

## AppText

`src/ui/app-text.tsx` is the one file allowed to import React Native's `Text` (the canonical ESLint
config bans it elsewhere). Its props: `children` (a string from `t()`, a formatter or an autonym; the
lint bans literal JSX text), `variant` (a role or style), `tone` (`default`, `muted`, `onPrimary`,
`danger`, `success`, `warning`), `align` (`start`, `center`, `end`), `language` (text in another
language than the UI), `direction` (a whole text in the other direction than the layout; see below),
`numberOfLines`, `isHeader` (`accessibilityRole="header"`, read by VoiceOver and TalkBack), `testID`,
`onLineCount`. It asks `useTextStyle` for the font (a family, or a weight on the system font), size,
line height, tracking, writing direction and alignment, caps font scaling at 200 %
(`maxFontSizeMultiplier={MAX_FONT_SCALE}`), maps `isTabular`, balances display text and guards tall
scripts at the current font scale (`useFontScale()`).

**`direction` on both platforms.** `writingDirection` works on iOS only: React Native 0.86 types it in
`TextStyleIOS`, and Android's `TextAttributeProps.kt` drops it, while `TextLayoutManager.kt` lays text
out with `FIRSTSTRONG_LTR`, which takes a paragraph's direction from its first strong character
(React Native 0.86 source). So on Android AppText starts a text whose `direction` is set with a
direction mark, U+200F (right to left) or U+200E (left to right), a strong character that decides the
paragraph. An isolate (FSI ... PDI) would not: Android's first-strong rule skips everything inside
isolates (AOSP `TextDirectionHeuristics.java`, read in source). `app-text.android.test.tsx` pins the
mark and `app-text.test.tsx` the iOS style; neither was device-measured here. Screen readers do not
speak the marks, but an E2E text assertion on such a text must include it. Direction across a whole
screen, digits and isolation inside sentences belong to rtl-and-direction.

`useTextStyle` reads the UI language and its text direction (`directionOf(language)`) with
`useTextLocale` (`src/theme/use-text-locale.ts`) from `TextLocaleProvider`
(`src/theme/text-locale.tsx`), a two-field seam the i18n root fills: the design system never imports
i18n code. Without a provider (a component test) it uses `en`, left to right.

## Type roles and component styles

`TYPE_SCALE` holds the roles (`display`, `title`, `heading`, `body`, `label`, `caption`, `number`);
`TYPE_STYLES` holds named component styles (`rowLabel`, `buttonLabel`, `statValue`...). A component
picks one, never a raw size (`no-raw-font-size`). A style is
`{ fontSize, weight, face, lineHeight: { base, tall }, letterSpacingEm?, isTabular? }`:

- `face`: `display` (headings, numbers; always the bold weight), `text` (any weight), `brand`
  (the product name: the Latin family in every language, isolated with U+2068/U+2069 so a
  right-to-left sentence cannot reorder it).
- `weight` (`regular`, `medium`, `semibold`, `bold`) picks a bundled family, never a synthetic
  weight, or a `fontWeight` of 400 to 700 on the system font (below).
- `letterSpacingEm`: tracking only through a style (`no-letter-spacing` bans raw `letterSpacing`),
  and never on connected scripts (Arabic letters break apart when tracked), which `useTextStyle`
  enforces.

When a design adds a style the token file lacks, add it to the token file first (as a documented
override in the decision log), then to `TYPE_STYLES`.

## Line heights on the device pixel grid

**React Native rounds every measured text box up to whole device pixels** (iOS, measured). A
fractional line height (17 x 1.32 = 22.44) made each line up to a third of a point taller than
designed: a settings row with a two-line label and description grew 0.4 to 0.7 pt, and a long screen
ended 2.5 pt low. Rounding to whole points instead (26 for 25.5) drifted every tall-script screen by
about 1 pt every few lines. So:

```ts
lineHeight = snapToPixels(fontSize * ratio * fontScale) / fontScale;   // snapToPixels: round(v * PixelRatio.get()) / PixelRatio.get()
```

At 3x and the default text size: 18.2 -> 55/3, 22.44 -> 67/3, 25.5 -> 77/3. On Android
`PixelRatio.get()` is often fractional (2.625 at 420 dpi); the same function puts the box on that
grid. Android's text layout also reports whole-pixel heights (StaticLayout), so the rule holds there
by construction; it was device-measured on iOS only. `type-styles.test.ts` pins the grid values;
Jest tests that assert a line height mock the ratio (`jest.spyOn(PixelRatio, 'get')`) and the font
scale (React Native's `useWindowDimensions` module; Jest's own default is 2), then expect `67 / 3`,
never a rounded number. Checks: `line-height-grid` (the hook and `snapToGrid`),
`no-rounded-line-height` (any `Math.round` line height in app code).

## The font scale: what React Native multiplies

Text grows with the system setting (Dynamic Type on iOS, font size on Android), and React Native
draws both `fontSize` and `lineHeight` times that scale, but leaves padding and margin in points:

- iOS: `RCTAttributedTextUtils.mm` sets the paragraph's line height to
  `textAttributes.lineHeight * RCTEffectiveFontSizeMultiplierFromTextAttributes(...)`, the same
  multiplier the font size gets, capped by `maxFontSizeMultiplier` (React Native 0.86 source).
- Android: `TextAttributes.kt` converts `lineHeight` with `PixelUtil.toPixelFromSP(lineHeight,
  maxFontSizeMultiplier)`, the same sp conversion as the font size (React Native 0.86 source).

So the drawn line box is `lineHeight x scale`, and that is what must land on the pixel grid: the hook
snaps the scaled value and divides it back (`useFontScale()` reads `useWindowDimensions().fontScale`,
which re-renders when the setting changes, capped at `MAX_FONT_SCALE`). At 200 % text, 17 x 1.32 x 2
= 44.88 is drawn as 135/3 = 45 pt from a style line height of 22.5.

What is exact and where: at the default text size every box is device-measured exact on iOS. At other
scales the arithmetic follows the source above but was not device-measured. Android 14 and later
scale sp values non-linearly (large sizes grow less than small ones), so there `size x fontScale` is
an approximation of the drawn size; the boxes stay on the grid only where the scaling is linear.

## No glyph nudges

With exact boxes, what remains is where each platform's text engine places glyphs inside a line box,
which differs by a point or two between fonts, sizes and renderers. A per-size `translateY`, padding
or margin on text "to match a screenshot" breaks every height built on the exact boxes, and differs
per platform anyway (`no-glyph-nudge` in AppText and the text-style hook). Before blaming glyph
placement, compare the element's font size and line height with the role the design uses: a wrong
role is the usual cause.

## Tall scripts: line heights and the overflow guard

Scripts such as Arabic, Devanagari and Thai reach far above and below a Latin line box. Each style
has a `tall` ratio, used when the text's script is in `TALL_SCRIPTS` (`src/theme/fonts.ts`);
`tall-script-line-height` keeps it at least the `base` ratio and at least any device-proven minimum
the contract records (`text.minTallLineHeight`; the demo keeps tall-script counts at 1.45, where
their digits stopped losing their tops).

A font's content box is its hhea ascender plus descender (Noto Sans Arabic: 1374 + 738 of 1000 per
em, 2.1 em), usually taller than the line box. **iOS lays the whole overflow above the line and clips
the Text at its frame** (iOS, measured: digits on tight number lines lost their tops, and every line
sat half its overflow high). React Native's Android text layout uses CSS-like half-leading
(`CustomLineHeightSpan`, read in the 0.86 source, not device-measured here): the overflow is already
centred, but a parent still clips at the frame. So `AppText` guards a tall-script line when half the
overflow is at least 1.5 pt:

- Sizes are the drawn ones: `size = fontSize x fontScale`, `line = lineHeight x fontScale`, because
  the font scale multiplies the text but not the pads (above). A guard from the unscaled sizes
  covers only half to two-thirds of the overflow at 150 to 200 % text, and iOS clips tall glyph
  tops again for exactly the people who enlarged their text.
- `h = (round(ascender x size / upm) + round(|descender| x size / upm) - line) / 2`
- iOS: `paddingTop = ceil(h) + h`, `paddingBottom = ceil(h) - h` (the line moves down by h);
  Android: both pads `ceil(h)` (no shift); both: `marginVertical = -ceil(h)`, so the element still
  takes the design's line box. Noto Sans Arabic `number` (28 pt, tall 1.5): at 100 % the pads are
  17.5 and 0.5 on iOS (9 and 9 on Android); at 200 % they are 34 and 0 (17 and 17).
- The Text sits in a `View` that carries the testID, so Maestro and screen readers measure the line
  box, not the padded Text.

The metrics come from the font file, never from a measured offset: `TALL_SCRIPT_METRICS` in
`fonts.ts` must equal the bundled TTF's hhea values (`tall-script-overflow-guard` reads the file and
prints the right numbers, and fails an AppText whose guard ignores the font scale). A Latin-only app
declares no tall script and the rules are skipped with a note. `app-text.test.tsx` (iOS) and
`app-text.android.test.tsx` (the Android Jest project) pin the pads at 100 % and 200 %.

## Balanced display text

Headings that need two lines look best with two lines of nearly equal length (CSS
`text-wrap: balance`); React Native fills the first line greedily and can leave one word alone.
`AppText` runs `useBalancedWrap(style.face === 'display', ...)`: after a layout it searches the
narrowest width that keeps the line count, from the Text's own `onTextLayout` line widths, and
applies it as a pad at the text's end (start pad for `align="end"`, half each side when centred), so
the element keeps its full width. Body text stays greedy.

Two pitfalls made the obvious search work in Jest and fail on a device (iOS, measured):

1. **`onTextLayout` and `onLayout` arrive in one batch.** A handler that computes the next state from
   its closure loses one event and the search never starts: both handlers update state functionally.
2. **An unchanged layout sends no event.** A probe wider than a failed one can lay out the same lines
   and wait forever, so every probe is narrower than the widest kept line, a probe that adds a line
   first returns to the last kept width, and a late layout wider than the current room is dropped.

`use-balanced-wrap.test.ts` replays device-measured sequences; `balanced-display` fails an AppText
without the call or a hook that sets state from a closure. Android sends the same events; the
pitfalls were observed on iOS.

## Tabular figures

Numbers that sit in columns or change while visible (counts, timers, totals) use tabular figures, so
digits keep one width and the layout does not jitter: the style carries `isTabular: true` and
`AppText` maps it to `fontVariant: ['tabular-nums']` (both platforms; the font must have a `tnum`
feature, which Noto Sans and Noto Sans Arabic have; on the system font check it on both platforms,
not measured here). The contract lists the styles that render numbers (`text.tabularStyles`);
`tabular-digits` checks each, and the mapping.

## System font (the template default)

The templates use the platform font (San Francisco on iOS, Roboto on Android, and the platform's
fallback for other scripts), because it needs nothing to download, embed, pin or license, and most
apps never change it. Bundling one particular typeface is a product decision a design makes, not a
library rule, so it is the opt-in of the next section:

- `contracts/design-system.json`: `"fonts": "system"` (no files, no plugin, no pins). The key is
  always declared: a missing `fonts`, `null` or an empty `files` list is bad input (exit 2), because
  none of them says whether the app chose the system font or never filled the contract in.
- `src/theme/fonts.ts`: each script of `SCRIPT_FONTS` is `null`; `TALL_SCRIPT_METRICS` is `{}`.
- `useTextStyle` then sets no `fontFamily` and returns `fontWeight` from the style's weight
  (`FONT_WEIGHT_VALUES`: regular 400, medium 500, semibold 600, bold 700); the system families hold
  every weight on both platforms, so here `fontWeight` is right and `no-font-weight` is off.
- check-design-system prints `font rules: the contract says "fonts": "system" ...` and checks no
  file, pin, licence or `expo-font` entry. It still holds the two halves together: a `fonts.ts` that
  names a family while the contract says `"system"` fails `font-family` (a build would draw the
  platform font instead), and so does a contract that bundles files while every script of
  `SCRIPT_FONTS` is `null` (the build embeds fonts no text draws).
- A script may be bundled while another stays on the system font (`latin` bundled, `arabic: null`);
  the contract then lists the bundled files only.
- The template tests read families from `SCRIPT_FONTS`, so they pass on either setup; the tall-script
  guard cases (`app-text.test.tsx`, `app-text.android.test.tsx`) mock `@/theme/fonts` with the
  bundled example below, so the guard stays proven in Jest whatever the app ships.

What is lost without a font file: the tall-script overflow guard needs the font's hhea metrics, and
the system font has no file in the app to read them from (they also differ by platform and OS
version). check-design-system prints a note and computes no guard for such a script; its tall
line-height ratios are still checked, so keep them generous (1.5 or more held tall digits in the
demo) and look at the screens with Arabic, Devanagari or Thai text on both platforms. AppText passes
`fontVariant: ['tabular-nums']` the same way; check that the digits keep their width on both
platforms (not measured here). Bundle the script's font when the design needs exact boxes or names a
typeface (next section).

## Fonts: choosing, naming, bundling, pinning

Bundling is the opt-in for a design that names a typeface. It starts in the contract: replace
`"fonts": "system"` with `{ "dir": "assets/fonts", "files": [...], "licences": {...} }`. From then
on every rule below applies strictly (`font-files`, `font-plugin`, `font-family`, and
`no-font-weight` in check-raw-values), and none of them relaxes until the contract says `"system"`
again.

1. **Bundle, never download at runtime.** Copy the TTF or OTF files into `assets/fonts/` and embed
   them with the `expo-font` config plugin (works in development and release builds on both
   platforms; `npx expo install expo-font`, then a new build, since it is native):
   ```ts
   plugins: [['expo-font', { fonts: ['./assets/fonts/NotoSans-Regular.ttf', './assets/fonts/NotoSans-Bold.ttf'] }]]
   ```
   `font-plugin` fails when the entry is missing or misses a contract font.
2. **One string per family on both platforms.** With a list of file paths, Android names the family
   after the file (without extension) and iOS reads the name from the file; Expo's guide recommends
   naming the file after its PostScript name so both agree (verified in the SDK 57 docs). So
   `NotoSans-Bold.ttf` holds PostScript name `NotoSans-Bold`, and `fonts.ts` says
   `'NotoSans-Bold'`. `font-family` reads the file's name table and fails a mismatch.
3. **The family is the weight.** With this convention every weight is its own one-face family, so
   `fontWeight` has no face to choose: Android's `Typeface.create(family, weight, italic)` fakes a
   bold by thickening the letters, and iOS (React Native's `RCTFontUtils.mm`) looks the PostScript
   name up, then picks the closest weight among the bundled files of that font's family, so it keeps
   the face or swaps in another file (read in the 0.86 source). Either way the text does not show
   the face the design chose (`no-font-weight`, active only when the contract bundles fonts with the
   default `weightBy`). `SCRIPT_FONTS` therefore names a family for every weight token; the worked
   example bundles two Noto Sans weights, so its `medium` points at the regular file and `semibold`
   at the bold one until the app bundles the real faces.
4. **Pin the files.** The contract records each file's sha256 (`shasum -a 256 assets/fonts/<file>`);
   `font-files` fails a missing file, a different file (a variable font swapped for a static one, a
   newer build with other metrics) or a family without its licence text. The licence (usually the SIL
   OFL) ships next to the files and appears on the app's licences screen.
   **The worked example** (what the guard tests mock, and what this skill's self-test bundles as
   stub files): Noto Sans (`NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`) and Noto Sans Arabic
   (`NotoSansArabic-Regular.ttf`, `NotoSansArabic-Bold.ttf`), the hinted static TTFs from the Noto
   project's GitHub releases (github.com/notofonts/latin-greek-cyrillic and
   github.com/notofonts/arabic; Google Fonts serves the same families), licensed under the SIL Open
   Font License 1.1, whose text ships as `NotoSans-OFL.txt` and `NotoSansArabic-OFL.txt`. Bundling
   them means: `SCRIPT_FONTS.latin = { regular: 'NotoSans-Regular', medium: 'NotoSans-Regular',
   semibold: 'NotoSans-Bold', bold: 'NotoSans-Bold' }` (and the same for `arabic`),
   `TALL_SCRIPT_METRICS['NotoSansArabic-Regular'] = { unitsPerEm: 1000, ascender: 1374, descender:
   -738 }` (and `-Bold`), a contract `fonts` entry per file with its sha256 and the two licences, and
   the four paths in the `expo-font` entry. The hhea values and `tnum` features match what this
   reference states (read 2026-10-03); record the sha256 of the exact files you copy, since a newer
   release may change the metrics, and check-design-system prints the values it reads.
5. **Pick per script.** `SCRIPT_FONTS` maps each script to its families; `LANGUAGE_SCRIPTS` maps
   language subtags to scripts; the font follows the language of the text, so an autonym in a
   language list (`language="ar"`) uses its own script in an English UI.

## Every script of the app's languages

`scriptOf` sends every language that `LANGUAGE_SCRIPTS` does not name to `latin`. With the system
font that is harmless. With a bundled Latin family it is not: Japanese, Russian or Hindi text then
asks for `NotoSans-Regular`, the platform fills each glyph the file lacks from a fallback font (with
that font's own weights and metrics, so bold may come out regular), and no line height was chosen
for the script. So once the Latin family is bundled, every script of the app's languages
(`LANGUAGES` in `src/i18n/languages.ts`, i18n-strings-and-catalogs) needs its own decision: a
`ScriptKey` in `LANGUAGE_SCRIPTS` with a family per weight in `SCRIPT_FONTS` (bundled and pinned like
the Latin one), or `null` there for the system font. A tall script also joins `TALL_SCRIPTS`.

`font-script-coverage` fails a language whose default script is not Latin (from a built-in table
of CLDR likely scripts: Arabic, Hebrew, Cyrillic, Greek, the Indic scripts, Thai, CJK and others)
and that `LANGUAGE_SCRIPTS` does not name. A script subtag decides first (`sr-Latn` is Latin, `sr`
Cyrillic). Limits: it reads `LANGUAGES` only as a literal array (else it prints a note and checks
nothing), a language missing from its table counts as Latin, and it does not open the font's
character map, so a Latin family that lacks a Latin letter the app needs (Vietnamese tones, for
example) is the design's check, not this one. Bidi format characters (U+061C, U+200E, U+200F, which
CLDR's Arabic number output and AppText's Android marks emit) need no glyph: Unicode makes them
default-ignorable, so the text engines on both platforms draw nothing for them even when the
family has no entry.

## One family name with fontWeight (fenced alternative)

Expo's config plugin also accepts the object syntax (verified in the SDK 57 fonts guide): on Android
`android.fonts: [{ fontFamily: 'Inter', fontDefinitions: [{ path, weight }, ...] }]` groups the files
under one family name, and on iOS `ios.fonts` lists the files, whose family name iOS reads from them.
Text then says `fontFamily: 'Inter', fontWeight: '700'` on both platforms. It is a valid setup with
different trade-offs: one name per font, but a weight the files do not hold is synthesised on
Android, and the family name inside every file must match. To use it:

- set `"fonts": { ..., "weightBy": "fontWeight" }` in the contract: `no-font-weight` is off, and
  `font-family` checks that each family named in `fonts.ts` is a `fontFamily` of the expo-font entry
  instead of a file and PostScript name;
- in `fonts.ts` map every weight of a script to the family name (`'Inter'`), and in
  `use-text-style.ts` return `{ fontFamily, fontWeight }` from `fontStyleOf` for bundled families.

Variable fonts (one file, faces selected by `fontWeight`) arrive in Expo SDK 58 according to the
fonts guide; on SDK 57 use static files. Re-verify when the SDK moves.

## Font scaling

Text scales with the system setting (Dynamic Type on iOS, font size and display size on Android). Do
not disable it; `maxFontSizeMultiplier={MAX_FONT_SCALE}` (2) caps it at 200 %, the WCAG 1.4.4
reference, so layouts can be designed for a known maximum, and the line boxes and tall-script guard
follow the scale up to that cap (above). accessibility-as-code owns the 200 % layout checks.
