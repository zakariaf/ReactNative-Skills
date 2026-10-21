# Palettes and contrast

How a palette is generated, why contrast is tested as pairs, which table the pairs come from, and
what the palette rules mean. Ratios verified on 2026-10-03 against the WCAG 2.2 formula; re-verify a
pair with `node ${CLAUDE_SKILL_DIR}/scripts/write-palette.mjs . --dry-run`.

## Contents

- Contrast is a property of pairs
- One table: the contrast contract
- The core pairs and the default pairs
- Filled shapes and edges (WCAG 1.4.11)
- Translucent colours
- Exceptions
- Generating a palette with write-palette.mjs
- Fixing a failing pair
- Light and dark: two hand-tuned sets
- Colour-blind variants
- Why hex palettes, not platform colours
- The rule ids

## Contrast is a property of pairs

A colour is never "accessible" on its own: muted text that reads well on the white surface may fail
on the grey ground. So the app keeps one table of the pairs its components actually draw (`textMuted`
on `background`, on `surface`, on `sunken`...), and every palette passes every pair in every scheme.
WCAG 2.2: text needs 4.5:1 (1.4.3; large text may use 3:1, but one 4.5:1 rule is simpler and
survives font scaling); icons, a component boundary and a focus indicator need 3:1 against what
surrounds them (1.4.11). Ratios use the WCAG relative-luminance formula with the sRGB threshold
0.04045 (`src/theme/contrast.ts`, the same maths as the scripts).

## One table: the contrast contract

The pairs live in **`contracts/contrast.json`**, the repo-owned contrast contract. accessibility-as-code
owns that file: its template, every key, the rule to declare each pair a component paints, the
colour-blind `distinct` lists and its own checker (`check-contrast.mjs`, which can also raise the
thresholds through `quality-gates.json`). This skill reads the same file, so `write-palette.mjs`,
`check-design-system.mjs` and accessibility-as-code share one table; this skill adds the core pairs
(below) as a floor that no exception lowers. A path other than `contracts/contrast.json` is set with
`"contrastContract"` in `rn-skills.config.json`.

The part these scripts read, per palette (matched by `file`, and by `export` when the entry names it):

```json
{
  "palettes": [
    {
      "name": "app",
      "file": "src/theme/palette.ts",
      "export": "PALETTE",
      "sets": ["light", "dark"],
      "base": "background",
      "edge": "border",
      "text": [["text", "background"], ["textMuted", "surface"], ["onPrimary", "primary"]],
      "graphics": [["border", "background"], ["focus", "surface"]],
      "shapes": [["primary", "background"], ["primary", "surface"]]
    }
  ],
  "exceptions": []
}
```

`text` pairs need 4.5:1, `graphics` pairs 3:1, `shapes` 3:1 off their ground or edge (below). Declare
a pair the day a component puts a colour on a new ground (a badge `text` on `primary`, `danger` on
`background`), then rerun write-palette. A malformed contract is bad input (exit 2).

## The core pairs and the default pairs

The **core pairs** are checked whatever the contract says, because a table that loses one to make a
palette pass is the failure the table exists to prevent: `text` and `textMuted` on `background` and
`surface`, `onPrimary` on `primary` (4.5:1), `border` and `focus` on `background` (3:1). A failing
core pair is marked `(a core pair)`; `palette.test.ts` checks the same seven in Jest.

Until the app has a contract (or for a palette the contract does not list), the **default pairs**
apply: the `app` palette of `assets/default-contrast.json`, a verbatim copy of accessibility-as-code's
contract template, so the default pairs are written in that one file and nowhere in the scripts. They
are the core pairs plus `text`/`textMuted` on `sunken`,
`danger` on `surface` and `dangerSurface`, `text` on `dangerSurface`, `success` and `warning` on
`surface`, `border` and `focus` on `surface`, and `primary` as a shape on `background` and `surface`.
Every run prints which table judged each palette.

## Filled shapes and edges

A filled control (a primary button, a selected segment) must stand out from what it sits on: 3:1
between the fill and its ground, **or** an edge around it that stands 3:1 off the fill
(`palette-fill`). The edge is the shape's third element, else the palette's `edge` (`border`). Light
designs often use pale fills that sit at 1.5:1 on the ground and carry a strong edge; dark designs
usually do the opposite. Both pass; a pale fill with a pale edge does not.

## Translucent colours

`separator`, `shadow` and `scrim` may be `#RRGGBBAA`: React Native accepts 8-digit hex on both
platforms, and a translucent hairline adapts to whatever it crosses. Contrast is defined only between
opaque colours, so a translucent colour is painted over its ground first, and a translucent ground
over the palette's `base` colour (`background` by default, which must be opaque), exactly as
accessibility-as-code does. `text` on `separator` is therefore measured against the hairline as it
appears on the ground. Decorative translucent roles (the scrim, shadows) usually stay out of the
table: a separator is never a control's only boundary (that is `border`'s job). Every field is an
uppercase `#RRGGBB` or `#RRGGBBAA` (`palette-hex`), which keeps diffs and comparisons exact.

## Exceptions

An accepted failure is an entry in the contract's `exceptions` (`palette`, `set`, `fg`, `bg`,
`reason`, `approvedBy`), added only after the developer agrees. The scripts honour it like
accessibility-as-code does: the pair is printed as a `note:` line on every run, naming the reason and
the approver, instead of failing. Never add one to go green; ask first.

**A core pair cannot be excepted.** Body and muted text on the grounds, text on the primary fill, the
control edge and the focus indicator are what every screen paints, and `palette.test.ts` keeps
checking them in Jest whatever the contract says. So an exception that names a failing core pair is
refused: the pair stays a `palette-contrast` problem whose message ends "a core pair cannot be
excepted", in check-design-system and write-palette alike. accessibility-as-code's `check-contrast`
(verified 2026-10-03) accepts an exception on any pair, so an approved exception on a core pair passes
there and fails here: this skill's floor is the stricter proof, and the fix is the colour, never the
exception.

## Generating a palette with write-palette.mjs

```sh
node ${CLAUDE_SKILL_DIR}/scripts/write-palette.mjs . --dry-run   # validate, print the module
node ${CLAUDE_SKILL_DIR}/scripts/write-palette.mjs .             # write src/theme/palette.ts
```

It reads the contract's first palette (token path, output file, export name) or the defaults
(`design/tokens.json`, `color`, `src/theme/palette.ts`, `PALETTE`), resolves every alias, runs the
pairs on each scheme and writes nothing while a pair fails. An existing file with other colours is
refused (`palette-exists`) until `--force`; an identical one prints `unchanged`. The output is
Prettier-formatted already, so regenerating never produces a diff by itself.

## Fixing a failing pair

Change the colour in the token file, never the table: keep the hue and move the lightness until the
pair passes (in OKLCH this keeps the colour recognisably the same), then regenerate. If one role
cannot serve two grounds (danger text that fails on the ground but passes on surfaces), add a role
or keep that text off the failing ground, and record the choice in the decision log.

## Light and dark: two hand-tuned sets

Dark is never an automatic inversion of light. Grounds become deep, surfaces one step lighter,
`sunken` between them; text turns light; fills usually brighten and the text on them turns dark;
semantic colours lighten to keep 4.5:1 on dark surfaces; shadows go near-black and stop being
boundaries. Each set passes the table on its own, which is why the generator checks both.
A light-only app (contract `lightOnly`, theme-in-react-native.md) aliases its dark set to light
(`"dark": "{color.light}"`) instead of tuning one, and the pairs judge it as they judge light.

## Colour-blind variants

Meaning never rests on colour alone: every state also has a shape or a word (a check mark, a dashed
edge, a label). accessibility-as-code owns and checks those cues and the `distinct` lists. A palette
may add a `colorBlind` variant (`{ light, dark }` under the palette's token path) when hues carry
information that cues cannot fully replace (a chart's series, a status dot). The variant must change
at least one primary or status colour (`palette-colorblind`): a colour-blind setting that changes
nothing is a setting that lies. With no variant, `AppThemeProvider` simply stays on the standard
theme when the setting is on.

## Why hex palettes, not platform colours

React Native's `PlatformColor` (and Expo Router's `Color` helpers) resolve system colours on the
device, which adapts well but cannot be contrast-checked at build time or kept identical on iOS and
Android. This skill keeps its own hex roles so every pair is proven before it ships. An app that
wants system colours for chrome (separators, grouped backgrounds) can still use them there, outside
the palette, and accept that those pairs are verified by eye; Expo's `expo-native-ui` skill covers
them.

## The rule ids

| Rule | Holds when |
|---|---|
| `palette-missing` | every palette the contract lists exists |
| `palette-shape` | the export is `{ light, dark }` (and `colorBlind: { light, dark }` when present) |
| `palette-hex` | every field is `#RRGGBB` (or `#RRGGBBAA`) in uppercase |
| `palette-contrast` | every text and graphics pair passes in every scheme, the core pairs included; every named field exists; the base colour is opaque |
| `palette-fill` | every shape stands 3:1 off its ground or off its edge |
| `palette-colorblind` | a colour-blind variant changes at least one of `primary`, `danger`, `success`, `warning` |
| `palette-invariant` | the contract's `invariantFields` are identical in every palette |
| `theme-mismatch` | the palette module equals the token file's resolved colours |
