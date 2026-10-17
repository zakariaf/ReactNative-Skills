# Contrast and colour

The contrast maths, the contrast contract every app keeps in `contracts/contrast.json` (its one
pair table), how filled shapes, translucent colours and labels over a growing fill are measured,
the colour-blind check and its calibration, recorded exceptions, and focus indicators.

## Contents

- The rules
- The maths
- One pair table
- The contract: contracts/contrast.json
- Canvas surfaces: canvas-palettes.json and canvas-contrast.json
- Filled shapes and translucent colours
- A label over a growing fill
- Colour blindness: never colour alone
- The colour-blind check and its calibration
- Exceptions
- Focus, Increase Contrast and dark mode
- The Jest twin

## The rules

- WCAG 2.2 AA in every colour set the app ships (light, dark, a colour-blind or high-contrast
  variant): **4.5:1 for text** (1.4.3) and **3:1 for icons, control edges, focus indicators, chart
  lines and the filled shapes that identify a control** (1.4.11). Apple and Google use the same
  values. WCAG lets large text (24 px, or 18.66 px bold) drop to 3:1; the contract keeps one 4.5
  floor for all text, because type roles change size with the user's text setting and a pair
  declared once must hold at every size.
- **Never convey meaning by colour alone**: every state and category also has a shape, an icon or
  a word.
- Colours in code come only from the theme (design-system-structure) or a declared colour table;
  the contract names the pairs those colours form on screen. A component that puts a colour on a
  new ground adds the pair.

## The maths

WCAG 2.2 relative luminance with the sRGB threshold 0.04045: `L = 0.2126 R + 0.7152 G + 0.0722 B`
on linearised channels (`c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4`); contrast =
`(Lmax + 0.05) / (Lmin + 0.05)`, from 1 to 21. Sanity values: `#767676` on white = 4.54:1, black on
white = 21:1, `#9A9A9A` on white = 2.81:1. The app's copy is `src/theme/contrast.ts` (owned by
design-system-structure); the checker's copy is `scripts/lib/wcag.mjs`.

## One pair table

A palette file says which colours exist, never which colour sits on which. The contract says it,
and it is the app's only pair table: two tables for one palette drift (a pair added to one is
missing from the other, and a fix proven in one is never proven in the other).

| Reader | What it does with the contract |
|---|---|
| `check-contrast` (this skill) | proves the contract itself and every declared pair, `distinct` list, exception and gate |
| `test/a11y/app-contrast.test.ts` (this skill) | runs the same pairs in Jest, so a colour change fails `npm test` |
| design-system-structure's `write-palette` and `check-design-system` | judge the theme palette by its contract entry (matched by `file` and `export`) plus that skill's core pairs, which `src/theme/palette.test.ts` also keeps as a floor |

So every colour table is declared here: the theme palette (`src/theme/palette.ts`, or each palette
that `contracts/design-system.json` lists) and every other table under `src/` (chart series, tag or
list colours, illustration palettes). `check-contrast` fails a theme palette with no entry, and a
colour table the contract does not declare: a `.ts` or `.json` file named like `chart-colors.ts`,
`tagColours.ts` or `board-palettes.json` that holds two or more hex colours (rename a file that only
shares the name). The one exception is a Skia canvas surface, whose pairs sit beside its palettes
(next section): its `canvas-palettes.json` is never declared here, because two pair tables for one
palette drift.

## The contract: contracts/contrast.json

Schema: `templates/contracts/contrast.schema.json`. Unknown keys are refused, because a misspelt
`"grapics"` would silently turn every graphics pair off:

```json
{
  "$schema": "./contrast.schema.json",
  "palettes": [
    {
      "name": "app",
      "file": "src/theme/palette.ts",
      "export": "PALETTE",
      "sets": ["light", "dark"],
      "optionalSets": ["colorBlind.light", "colorBlind.dark"],
      "base": "background",
      "edge": "border",
      "text": [["text", "background"], ["textMuted", "surface"], ["onPrimary", "primary"],
               ["danger", "surface"], ["danger", "dangerSurface"]],
      "graphics": [["border", "background"], ["focus", "surface"]],
      "shapes": [["primary", "background"]],
      "distinct": []
    },
    {
      "name": "chart",
      "file": "src/features/stats/chart-colors.ts",
      "export": "CHART_COLORS",
      "sets": ["light", "dark"],
      "base": "plot",
      "edge": "bandEdge",
      "text": [["label", "plot"]],
      "graphics": [["series1", "plot"], ["series2", "plot"]],
      "shapes": [["band", "plot"]],
      "distinct": [["series1", "series2", "series3", "series4"]]
    }
  ],
  "exceptions": []
}
```

| Key | Meaning |
|---|---|
| `file` | repo-relative data module: a `.ts` file with type imports only (loaded without packages through Node's type stripping), or `.json` |
| `export` | the exported constant (or JSON path) holding the sets; optional when exactly one constant holds them all |
| `sets` | dotted paths of the colour sets that must exist (`light`, `dark`, `standard.light`) |
| `optionalSets` | sets checked when present (a colour-blind variant the palette may ship) |
| `base` | the opaque token translucent grounds are composited over (default `background`) |
| `edge` | the default edge colour of every shape |
| `text` | `[fg, bg]` pairs at 4.5:1 (`a11y.textContrastMin` when higher) |
| `graphics` | `[fg, bg]` pairs at 3:1 (`a11y.nonTextContrastMin` when higher) |
| `shapes` | `[fill, ground]` or `[fill, ground, edge]`: 3:1 off the edge or off the ground |
| `distinct` | token lists that must stay apart for colour-blind eyes |
| `distinctSets` | the sets the distinct lists are checked in (default: every checked set) |

Every palette entry declares at least one `text`, `graphics` or `shapes` pair. `$comment` is
allowed at every level; any other key is a `contrast-contract` problem at its line. The template's
`app` entry holds the canonical palette's pairs (the same pairs design-system-structure falls back
to while an app has no contract).

The contract file moves with `rn-skills.config.json` `"contrastContract": "<path>"` (or the
checker's `--contract`); both paths are repo-relative, like every other path option. The thresholds never come from the contract: they are WCAG floors, raised
(never lowered) by the `a11y` block of `quality-gates.json`. The Jest twin reads both the same way.

## Canvas surfaces: canvas-palettes.json and canvas-contrast.json

A Skia canvas surface (skia-canvas-rendering) keeps its colours in `canvas-palettes.json` (one object
per palette set, identical tokens) and the pairs `draw()` paints in `canvas-contrast.json` beside it,
in that skill's format 1:

```json
{
  "edge": "edge",
  "text": [["label", "cell"]],
  "graphics": [["mark", "done"], ["hint", "cell"]],
  "shapes": [["done", "background"], ["done", "cell"]],
  "distinct": [["done", "cell"]]
}
```

The keys mean what they mean in the contract (`base`, `edge`, `text`, `graphics`, `shapes`,
`distinct`, `distinctSets`); any other key is refused. `check-contrast` finds every surface folder
(`src/features/*/canvas`, `src/games/*/canvas`, each `dir` in `contracts/canvas-surfaces.json`, or the
globs in `rn-skills.config.json` `"canvasSurfaceDirs"`) that holds a `canvas-palettes.json`, and
measures its pairs in every palette set (`contracts/canvas-surfaces.json` `"paletteSets"`, default
`light` and `dark`) with the same maths and thresholds as the contract. It fails `canvas-contrast` for
a surface with palettes but no pairs file, an unknown key or token, or no pair at all; the measured
failures use the same rule ids (`text-contrast`, `non-text-contrast`, `shape-contrast`,
`cvd-separation`), and a contract entry that names a surface palette is a `contrast-contract`
problem. skia-canvas-rendering's own checker measures the same files, so both agree. Canvas pairs
take no exceptions: change the colour. A canvas has no text in the accessibility tree, so its
summary label (roles reference, "Custom canvases") carries the information; the pairs keep what is
drawn readable for sighted users.

## Filled shapes and translucent colours

- **A filled shape** (a primary button, a selected chip, a chart band) must be identifiable: WCAG
  1.4.11 asks the shape's boundary to stand 3:1 off what is next to it. That boundary is either the
  fill itself against its ground, or an edge drawn around the fill. So a shape passes when
  `max(contrast(fill, ground), contrast(edge, fill)) >= 3`. A pale fill with a dark outline passes; a
  pale fill without one does not; a dark-mode fill that stands off the ground passes even when its
  outline is close to it.
- **Translucent colours** (`#RRGGBBAA`) are composited over their ground first, and a translucent
  ground over the `base` token. Contrast is defined only between opaque colours, so measuring the
  raw token would be meaningless. The scrim, separators and shadows are usually translucent and
  decorative: leave them out of the contract unless they are a control's only boundary.

## A label over a growing fill

A label that stays put while a fill or progress grows under it (a hold-to-confirm button, a
download or upload button, a progress bar with its percentage inside) sits on two grounds at once:
the empty part and the filled part. It must read at 4.5:1 on **every** ground it can sit on, in
every fill state, including a frozen state that a screenshot or a design capture shows half way.
Declare one text pair per ground, for example `[danger, surface]` and `[danger, dangerSurface]` for
a danger label over a growing danger tint. In the app these rules come from, a hold-to-confirm
label passed on the surface (5.5:1) but measured 4.43:1 on the danger tint growing under it; the fix
kept the tint's hue and moved its lightness to the first 8-bit step where the label reads 4.52:1,
and both pairs are now checked in light and dark, which also covers the frozen 46 % fill a design
capture shows.

## Colour blindness: never colour alone

- About 8 % of men and 0.5 % of women have a colour-vision deficiency. Every state carries a
  non-colour cue: a check or dash in toggles, a check and strike-through on completed tasks, an
  icon next to success, warning and error text, a dashed edge on disabled controls, a marker shape
  and a legend label on every chart series.
- **Status colours are not a `distinct` list.** Measured on the canonical palette (2026-10-03):
  success `#13682C`, warning `#8A5300` and danger `#B42318` are only 0.013 apart in OKLab under
  deuteranopia, which is why they always come with an icon and a word. Lists whose colours alone
  must tell categories apart (chart series, tag colours, calendar colours) are `distinct`.
- An optional colour-blind variant (`colorBlind.light`, `colorBlind.dark`) re-picks `distinct`
  colours from a colour-blind-safe family; ThemeProvider selects it when the setting is on.

## The colour-blind check and its calibration

Machado, Oliveira and Fernandes (2009) matrices at severity 1.0 on linear sRGB, distance in OKLab
(Ottosson), where one just-noticeable difference is about 0.02. Colours in a `distinct` list must
stay at least **0.07** apart (3.5 JND) under protanopia, deuteranopia and tritanopia
(`a11y.minCvdDistanceOk`). Code: `test/a11y/cvd.ts`, `scripts/lib/wcag.mjs`.

| Set (smallest pairwise distance) | Normal | Protanopia | Deuteranopia | Tritanopia | At 0.07 |
|---|---|---|---|---|---|
| Okabe-Ito, 8 colours | 0.156 | 0.096 | 0.076 | 0.085 | pass |
| Okabe-Ito, 5 colours | 0.156 | 0.114 | 0.110 | 0.086 | pass |
| Okabe-Ito blue, vermillion, green, purple (the light chart below) | 0.164 | 0.096 | 0.076 | 0.086 | pass |
| Okabe-Ito sky blue, orange, yellow, purple (the dark chart below) | 0.170 | 0.137 | 0.096 | 0.085 | pass |
| Red / green / blue / orange (`#D62728`, `#2CA02C`, `#1F77B4`, `#FF7F0E`) | 0.186 | **0.007** | **0.039** | **0.068** | fail |
| d3 category10, first six | 0.142 | **0.007** | **0.039** | **0.068** | fail |
| Status colours of the canonical palette (light) | 0.116 | **0.029** | **0.013** | 0.104 | fail |

Measured with `scripts/lib/wcag.mjs` on 2026-10-03 (re-verify: import `minPairwiseDistance` from it
in a one-off Node script).

Chart lines are graphics: each series also needs 3:1 against the plot. Okabe-Ito orange
`#E69F00` and sky blue `#56B4E9` are only 2.3:1 on white, so a light chart uses blue `#0072B2`,
vermillion `#D55E00`, green `#009E73` and purple `#CC79A7` (3.1 to 5.2:1), and a dark chart can use
the lighter four (5.8 to 13.4:1 on `#111827`).

## Exceptions

An exception is a failure the team decided to accept (a decorative grid line, a brand colour on a
splash that carries no information). It lives in the contract, not on a command line, so the
decision is reviewed in the diff and printed on every run:

```json
{ "palette": "chart", "set": "light", "fg": "grid", "bg": "plot",
  "reason": "grid lines are decorative; every value is labelled", "approvedBy": "design review 2026-10-01" }
```

`check-contrast` fails an exception without a `reason` or `approvedBy`, and a stale one whose pair
passes now. Adding an exception to make the check green is never the fix: change the colour, or
stop and ask the developer, who takes the question to whoever owns the design.

## Focus, Increase Contrast and dark mode

- The focus indicator (keyboard, Switch Control, Switch Access, a tapped disabled control) is a
  `graphics` pair against every ground it appears on.
- Palettes meet AA by default, so a separate high-contrast palette is optional. iOS Increase
  Contrast can be honoured with `DynamicColorIOS({ light, dark, highContrastLight, highContrastDark })`;
  Android's "High contrast text" is a system rendering change, readable with
  `AccessibilityInfo.isHighTextContrastEnabled()` (Android only). A high-contrast variant, when
  shipped, is one more set in the contract.
- Dark values are tuned by hand, never auto-inverted; each dark set is checked like the light one.

## The Jest twin

`test/a11y/app-contrast.test.ts` finds the contract where the checker does (`rn-skills.config.json`
`contrastContract`, else `<contractsDir>/contrast.json`), refuses unknown keys, loads each palette
module through Jest and runs the same pairs, compositing and colour-blind check at the same
thresholds (WCAG floors raised by `quality-gates.json` `a11y`) through `test/a11y/contrast-contract.ts`
and `test/a11y/cvd.ts`. A colour change then fails `npm test` before it reaches a screen;
`check-contrast.mjs` proves the rest (files, tokens, exceptions, gates, the theme palette and every
colour table declared, and the canvas surfaces, which the twin does not read). A missing contract fails
the twin as it fails the checker; `--categorical` never stands in for it in an app.
