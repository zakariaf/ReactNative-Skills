# Measurements and specs

How a component gets its numbers: the design's component measurements live in the token file's
`components` block, `write-component-specs.mjs` turns them into `src/ui/component-specs.json`, and
components read `COMPONENT_SPECS`. A retyped number drifts by one digit and nobody notices until a
screen looks wrong; a generated one changes only when the token file does.

## Contents

1. [The components block](#the-components-block)
2. [Generating and checking](#generating-and-checking)
3. [Overrides, with a reason](#overrides-with-a-reason)
4. [Browser-rendered references](#browser-rendered-references)
5. [Turning generated specs off](#turning-generated-specs-off)
6. [What the specs never hold](#what-the-specs-never-hold)

## The components block

design-system-structure owns `design/tokens.json` (primitives and semantic roles). Component
measurements are a third tier in the same file, one group per component, and may name shared steps
by reference instead of retyping them:

```json
"components": {
  "button": {
    "minHeight": 48,
    "paddingBlock": "{spacing.sm}",
    "paddingInline": "{spacing.lg}",
    "radius": "{radius.md}",
    "border": "{stroke.regular}",
    "icon": 20
  },
  "row": { "minHeight": 52, "separator": "{stroke.hair}", "subRowIndent": 60 }
}
```

- Values are pt. A reference `{group.key}` resolves against the whole token file (chains resolve; a
  cycle or a missing target stops the script with exit 2). DTCG `{ "$value": ... }` wrappers are
  unwrapped and `$`-keys ignored, so a design-tool export works as it is.
- Numbers and all-number arrays are kept (`[4, 12, 5]` reads as top, inline, bottom; read one with
  `?? 0` under `noUncheckedIndexedAccess`); strings and other values are left out.
- The demo block the templates were built from is `assets/components-block.json`. Merge its
  `components` into the app's token file, then replace the values with the design's; the shipped
  `component-specs.json` is what the generator writes from design-system-structure's demo token file
  plus that block.

## Generating and checking

```sh
node ${CLAUDE_SKILL_DIR}/scripts/write-component-specs.mjs .           # writes src/ui/component-specs.json
node ${CLAUDE_SKILL_DIR}/scripts/write-component-specs.mjs . --check   # fails when it differs (CI, the definition of done)
```

`src/ui/component-specs.ts` imports the JSON as `COMPONENT_SPECS`, so a misspelt key is a type
error. The output is Prettier-stable (objects expanded, number arrays on one line), so formatting
never reports drift. `check-components.mjs` repeats the comparison (`specs-mismatch`) and names the
first difference and why it differs ("button.radius is 99, the token file gives 10 (the token file
says {radius.md})"). The fix is always to rerun the generator; the JSON is never edited by hand.

Paths come from the catalogue's `specs` key (`tokens`, `block`, `out`, `module`; defaults
`design/tokens.json`, `components`, `<uiDir>/component-specs.json`, `.ts`) or the script's options
(`--tokens`, `--out`, `--contract`, `--ui-dir`).

## Overrides, with a reason

When the approved design and the token file disagree and the design is right (the token file lags,
or a mockup rule the token file cannot express), add an override to the catalogue instead of
editing the JSON:

```json
"specs": {
  "overrides": [
    { "path": "chip.radius", "value": 8, "why": "The approved design draws chips with an 8 pt radius; the token file still says the small radius." }
  ]
}
```

Every override names its reason in a sentence (`spec-override-reason`; the generator writes
nothing until it does). An override "to make the layout fit" is never a reason: fix the layout.
Tell the reviewer about each override, and move it into the token file when the design system is
updated.

## Browser-rendered references

When the design's approved references are browser renders (an HTML mockup captured in Chrome),
they draw CSS borders the way the browser does: a border of 1 px or more is floored to whole pixels
(2.5 → 2, 1.5 → 1; a sub-pixel border keeps its value). An app that draws the token's 2.5 then fails
every edge comparison against the references. Set `"asRenderedBorders": true` in the catalogue's
`specs` (or pass `--as-rendered-borders`) and the generator floors border keys only: `border`,
`*Border`, `border*` and `fillEdge`. Rings (box-shadow), icon and canvas strokes, sizes and gaps
keep their values. Leave it off when the references come from a native design tool or from device
screenshots; the default is off.

## Turning generated specs off

An app whose design defines no component tier sets `"specs": false`: components then take every
size from the theme tokens and named constants. `write-component-specs.mjs` prints NOT APPLICABLE
and `check-components.mjs` skips the three spec rules; `measurement-literal` still applies.

## What the specs never hold

- Colours (semantic roles of the theme), type (AppText variants), durations and springs (motion
  tokens): design-system-structure owns those tiers and their checks.
- Values one screen uses (a screen's gutter, the height of one hero image): they belong to the
  screen's styles, from the spacing scale.
- Behaviour (a slider's step, a drag slop): a named constant in the component, with a comment.
