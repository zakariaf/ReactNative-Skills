# The mockup and the reference set

What the approved design is for this skill, how the references are rendered from it, which kinds of
frame exist, how variants, masks and probed regions work, and the only situations in which the
references may change.

## Contents

- Why an HTML mockup
- The mockup conventions
- What is committed
- How a reference is rendered
- Frame kinds
- Reference variants chosen by app facts
- Masks, probed regions and app-drawn pictures
- The design's copy and the app's catalogs
- When the references change (and when they never do)
- The log of intended reference changes

## Why an HTML mockup

Every per-element gate needs to know where each element is in the design, what text, fill, border and
font it has, and where each text run sits. A browser render of a mockup gives exactly that (the DOM
boxes, the computed styles, the text runs) next to the pixels, and Chrome in software raster renders it
the same way every time. A flat PNG exported from a design tool has the pixels and nothing to measure
them by. So the approved design is a static HTML and CSS mockup (often written from the design tool's
frames once, then kept in the repo), and the references are rendered from it. A team without one starts
from `templates/design/parity/mockup/index.html` and draws its frames there; the design reviewer
approves the rendered references, not the HTML.

## The mockup conventions

- One element per design frame, `data-frame="<frame key>"`: the key is the screen-contract state's
  `reference` without `.png`. That element is the device screen: shoot-design.mjs pins it at (0,0) and
  sizes it from the profile, so the mockup lays it out with `var(--parity-width)`,
  `var(--parity-height)`, `var(--parity-safe-top)` and `var(--parity-safe-bottom)`.
- Every element of the frame carries `data-testid="<testID>"`, keys filled in
  (`tasks.task-row.milk`): exactly one per testID the screen contract gives the frame, and no other.
- A frame drawn only to discuss something (a system sheet the app never draws) carries
  `data-mock-only` and is never captured.
- The theme, the language and the direction arrive as `<html>` attributes (the contract's
  `mockup.htmlAttributes`) and `prefers-color-scheme`; texts that differ per language sit in one element
  per language that CSS shows for `html[lang]`. Static markup is the default: check-mockup.mjs reads it
  without a browser, and a review diff shows every change.
- Nothing from the network: fonts are `@font-face` rules pointing at the exact font files the app
  bundles, copied next to the mockup (`mockup.fonts`). Both sides then rasterise the same outlines, which
  is why text ink agrees within 0.3 pt. A system font (`system-ui`) matches only where the platform's
  system font is Chrome's too (iOS on macOS); the demo uses it, an app does not.
- Data the frames draw (task titles, list names, the day) is the design fixture,
  `design/parity/fixture.json`, the same values the harness writes into the app.

check-mockup.mjs proves every point it can read statically (`mockup-frame`, `mockup-testid`,
`mockup-unknown-testid`, `mockup-parent`, `element-reach`, `element-cover`, `mockup-offline`,
`mockup-font`); shoot-design.mjs proves the rest in the browser.

## What is committed

`design/parity/` in the app repo:

- `<device>/<theme>-<lang>/<frame>.png`: the frame at the device's pixel size (tall frames at their full
  height, state cards at their card height), lossless (RGB, no row filter, deflate 9; a quantised
  reference would destroy the exact fill values the fill gate reads);
- `<device>/<theme>-<lang>/<frame>.layout.json`: every testID of the frame with its rect in points, box
  and rotation, text, accessibility label and computed style (fill, text colour, border, radius,
  shadow, outline, font), plus every text run (one rect per line or bidi run) with its owner and font.
  It also copies the screen contract's metadata at render time (role, component, checks, reach), which
  the scripts take from the current contract instead, so a metadata fix needs no re-render;
- `<frame>--<variant>.png` and `.layout.json` next to their base;
- `manifest.json`: the renderer (Chrome and Playwright versions, flags), the sha256 of the inputs (the
  mockup, its fonts, each device profile, the two contracts), the frames and variants, every file's
  sha256, and `referenceChanges`, the log of every deliberate change (last section);
- `devices/`, `fixture.json`, `waivers.json`, `signoff.json`.

And one more image per frame, outside `design/parity/`: the screen contract's own reference,
`<screens.json "references">/<frame>.png` (screen-contracts' default `design/screens/`), which
screen-contracts' checkers require to exist for every state with a `"reference"`. It is the frame on
the contract's first device, in the light theme and the source language, at 1 pt = 1 px (what
screen-contracts asks for). `--update-reference` writes it with the parity references of the frames it
renders, and `--check` proves it (`reference-missing`, `reference-drift`). When screens.json
`references` points inside `design/parity/`, no separate image is written (the note says so).

The set grows with frames x devices x themes x languages (the demo's 3 frames on 2 devices in 2
themes and 2 languages: 24 renders, about 1.8 MB). It is the app's evidence; keep it out of LFS
pointers so a fresh clone can check it.

## How a reference is rendered

`shoot-design.mjs . --update-reference --change <id>` opens the mockup in the installed Google Chrome
through Playwright (pinned in `scripts/package.json`, loaded from the tooling folder):

1. Chrome flags `--force-color-profile=srgb --font-render-hinting=none --disable-lcd-text
   --hide-scrollbars --disable-gpu`; the device scale factor; reduced motion; time zone UTC; the render
   language as the locale. Software rasterisation is what makes a re-render pixel-identical.
2. The theme, language and direction through the mockup adapter, before the page's own scripts run.
3. **Offline**: every request that is not a local file is blocked and reported (`mockup-offline`);
   every `@font-face` must load (`fonts`).
4. **Pinned frame**: the frame is fixed at (0,0), sized to the device (a phone frame to its screen, a
   tall frame to its full height, a state card to its content) and clipped; an element screenshot of an
   in-flow frame came out 3 px too tall because of a fractional offset.
5. Every testID must match exactly one visible element of the frame (`exactly-one-match`); the layout is
   measured and written.
6. **Stable paint**: two animation frames, then screenshots until two in a row agree (under load Chrome
   once handed back a frame before the content was painted).
7. Everything renders into a temporary folder first; the references change only when every render of
   the run succeeded.

`shoot-design.mjs . --check` renders everything into a temporary folder and fails on any pixel or
measured-layout difference (`reference-drift`) and on a changed mockup, font folder or device profile
(`stale-reference`). A changed contract is judged by the re-render itself: a full check whose every
frame matches proves the change was metadata only. A lone frame that drifts once under heavy load and
not on a rerun is renderer noise; rerun before concluding anything. `--out <dir>` renders for a look,
never into the references.

## Frame kinds

- **phone**: the full screen; compared at the same position.
- **phone-tall**: the design shows the full scroll height; the app keeps the header fixed, scrolls the
  body under it and pins its pinned components to the bottom. `run-parity.mjs` captures at 0, the end of
  the scroll, and as few offsets between as it takes for every body element to be fully on screen once.
- **state-card**: a fragment of a phone screen in one state, compared by text, fill, border, ink size
  and crop, never by position (references/what-exact-means.md).
- A frame whose front layer is modal for screen readers (a dialog over a screen whose elements are part
  of the frame) declares `modal`: the frame is reached through the modal layer, and the elements behind
  it are compared as crop-only parts of the root. Never make the dialog non-modal to get the screen
  behind it listed.

## Reference variants chosen by app facts

A frame whose design depends on what the app has gets variants next to its base (contract
`facts` and `frames.<key>.variants`, references/contract-format.md). `shoot-design.mjs` renders every
combination whose conditions can hold together, applying each variant's `derive` to the rendered mockup
(never to the file), and checks the derive against the contract (`variant-derive`): it may hide only
elements whose `when` the variant's facts do not match, and every such element must be hidden or
re-texted. Captures pick the reference from `facts.app`; `run.json` records it, and check-parity.mjs and
check-signoff.mjs refuse a run captured against another reference (`reference-variant`). A missing
element that only another fact has is never waived: the facts pick its variant.

## Masks, probed regions and app-drawn pictures

- Always masked: the device profile's OS-drawn areas.
- `frames.<key>.masks`: testIDs whose pixels are skipped (an ad slot's placeholder); their bounds stay.
- `designMasks`: an unlisted part of the mockup behind a dialog that its own frame masks, measured by
  selector into the layout's `masks`.
- `probe`: a region the app draws itself at a place only it knows (a map, a game board, a chart
  canvas); the mockup draws a placeholder (`probe.element`). The rectangle comes from the probe launch,
  and the elements drawn over it (`probe.above`) stay fully gated.
- `appDrawn`: a picture drawn by the app's own code (a canvas illustration) where the mockup draws a
  stand-in; its pixels are masked, its frame and place are gated.

## The design's copy and the app's catalogs

When an element's screen-contract `text` key is a plain message in the app's catalog for the render
language (`<i18nDir>/catalogs/<lang>.json`), the render must show exactly that text (`design-text`). A
mismatch means the design and the app disagree about the words; the reviewer decides which is right,
and the catalog (i18n-strings-and-catalogs) or the mockup changes, never a reference by hand.

## When the references change (and when they never do)

- **Never to make a screen pass.** A reference is the reviewer's design; changing it to match the app
  is the one thing this skill exists to prevent.
- **Not for a metadata fix** in either contract: change it, run check-mockup.mjs, then a full
  `shoot-design.mjs --check`; when every frame matches, the references stay as they are.
- **Only after the reviewer approved a design change**: first add the entry to the log below, then
  change the mockup (and the fixture with it), run check-mockup.mjs, then
  `shoot-design.mjs . --update-reference --change <id>` (it refuses without an entry naming the frames,
  `reference-change-unlogged`), then `--check`, and say in the report that the references changed.
- **After a renderer change** (a new Chrome or Playwright, a new font file): `--check` names every frame
  whose pixels moved. Look at the differences; update only when the cause is understood, logged and
  approved.

The references, the manifest, the fixture, the mockup, the device profiles and the waivers are gated
paths (quality-gates.json `gatedPaths`, listed one by one; check-harness.mjs `gated-paths`): a commit
that changes them carries a `Gate-Change:` trailer (git-commits-and-reporting). The sign-off ledger is
not gated.

## The log of intended reference changes

`manifest.json` `referenceChanges`: `[{ "id", "date", "frames", "variants", "what", "why" }]`. It is never
a waiver (a waiver accepts a difference the app shows; a change entry says why the reference itself is
what it is). `--update-reference` keeps the log, `--check` validates it (`reference-changes`: a date, known
frames and variants, a `what` and `why` of 20+ characters), and `check-signoff.mjs` prints the entries of
every frame it signs off, so they reach the report:

```json
{ "id": "D-12", "date": "2026-10-02", "frames": ["tasks-default"], "variants": [],
  "what": "The add button became a filled button in both themes.",
  "why": "The reviewer approved the new button style in the design review of 2026-10-02." }
```
