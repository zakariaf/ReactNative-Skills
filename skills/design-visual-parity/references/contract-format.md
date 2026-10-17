# The parity contract: contracts/visual-parity.json

What the app tells the parity scripts: which design frames exist, the done set, where everything
lives, how the mockup takes a theme and a language, the layout facts the gates need, the measured
type-role floors, the app's facts and each frame's settings. The template is
`templates/contracts/visual-parity.json` (filled for the demo Tasks app) with its JSON Schema
`templates/contracts/visual-parity.schema.json`.

## Contents

- Where the files live
- The frames come from the screen contract
- Top level
- The mockup adapter
- Layout facts
- Type-role floors
- App facts and reference variants
- Per-frame settings
- Device profiles
- The design fixture
- When multi-package

## Where the files live

| File | Owner | Default path | Override |
|---|---|---|---|
| The parity contract | this skill | `contracts/visual-parity.json` | rn-skills.config.json `"visualParityContract"`, or `--contract <file>` |
| The screen contract | screen-contracts | `contracts/screens.json` | the contract's `screensContract`, or rn-skills.config.json `"screensContract"` |
| References, device profiles, manifest, fixture, waivers, ledger | this skill | `design/parity/` | `referencesDir`, `waivers`, `signoff` |
| Runs (captures, reports, sheets) | this skill | `.parity/` (git-ignored) | `runsDir` |
| Summary (the report's Design match line names it) | this skill | `reports/parity/summary.json` | `summary` |
| The harness | this skill | `src/features/parity/` | `harness.dir`, `harness.fixture` |

The layout keys (`srcDir`, `routesDir`, `uiDir`, `contractsDir`, `i18nDir`) come from
`rn-skills.config.json` and the `@/*` alias of `tsconfig.json`, as every skill reads them.

## The frames come from the screen contract

A design frame is a screen-contract state with a `reference`:

```json
{ "id": "lists", "states": [{ "id": "default", "reference": "lists-default.png" }, { "id": "empty", "drawn": false, "why": "Chosen: ..." }] }
```

The frame key is the file name without `.png` (`lists-default`); one reference belongs to one state.
The frame's elements are the screen's elements in that state (`states` on an element narrows it), with
their testIDs, roles, components, copy keys and screenshot reach (`parent`, `a11yHidden`, `coveredBy`,
`checks`). The parity scripts read that metadata from the current screen contract every time, so a
metadata fix needs no re-render. The frame root is `<screen id>.screen` (a dialog: `<screen id>.scrim`)
unless `frames.<key>.root` names another testID.

## Top level

| Key | Meaning |
|---|---|
| `version` | `1` |
| `themes` | `["light", "dark"]`: every theme the app ships (the done set) |
| `languages` | every language the app ships (the done set), the RTL ones included |
| `rtlLanguages` | the languages laid out right to left (the mockup gets `dir="rtl"`) |
| `devices` | device profile ids (`design/parity/devices/<id>.json`): one iOS, one Android by default |
| `mockup` | the mockup file and its adapter (next section) |
| `launch` | `{ "scheme", "ios", "android" }`: the captured build's URL scheme, bundle identifier and application id (the scripts' `--app-id` and `--scheme` override them) |
| `harness` | `{ "dir", "fixture" }`: the harness folder and the app's copy of the fixture |
| `layout` | the layout facts (below) |
| `textRoleFloors` | measured floors (below); `{}` until measured |
| `facts` | the app's facts (below); leave it out when no frame has variants |
| `frames` | per-frame settings keyed by frame key; `{}` when no frame needs any |
| `referencesDir`, `waivers`, `signoff`, `runsDir`, `summary`, `screensContract` | paths (table above) |

Any other key is `contract-invalid`: a typo never silently drops a setting.

## The mockup adapter

```json
"mockup": {
  "file": "design/parity/mockup/index.html",
  "htmlAttributes": { "data-theme": "{theme}", "lang": "{lang}", "dir": "{dir}" },
  "query": "?theme={theme}&lang={lang}",
  "css": ".showcase-caption { display: none; }",
  "fonts": "design/parity/mockup/fonts"
}
```

`htmlAttributes` are set on `<html>` before the page's own scripts run; `query` is appended to the
file URL; `css` is added to every render (hide showcase chrome, never change a measured style);
`fonts` is hashed into the manifest so a changed font file makes the references stale. The render also
emulates `prefers-color-scheme` for the theme and sets the CSS variables `--parity-width`,
`--parity-height`, `--parity-safe-top` and `--parity-safe-bottom` from the device profile.

## Layout facts

| Key | Meaning |
|---|---|
| `fixedHeaderPt` | the header (pt below the safe area) that stays put while a tall frame's body scrolls under it; required when a frame is `phone-tall` |
| `pinnedComponents` | components pinned to the bottom of the screen while the design draws them at the end of the full height (a bottom bar, a banner slot); everything drawn inside one moves with it |
| `dialogComponents` | dialog cards: text of the screen behind one is not ink-checked where the card covers it |

## Type-role floors

```json
"textRoleFloors": { "App Sans": { "14": { "floor": 1.37, "probe": "type-role probe 2026-09-29, iPhone 16 Pro iOS 26.5, .parity/probe/run-3" } } }
```

Keyed by the font family the mockup's computed style names and the whole px size. `floor` is the
larger of |dx| and |dy| of the ink centre between the platform's text engine and Chrome for that role,
measured with the type-role probe (what-exact-means.md, "Measuring the type-role floors"); a run's centre
limit becomes `max(2, floor + 0.9)` pt. Every floor needs its `probe` evidence (20+ characters) and stays
at or under 3 pt: a floor without evidence, or a larger one, is a widened tolerance and fails the
contract. A size not measured takes its family's largest floor.

## App facts and reference variants

Some frames depend on what this app has (a feature flag, a plan tier, an optional module). The mockup
draws one set of facts; variants of the reference show the others:

```json
"facts": {
  "values": { "hasReminders": [true, false] },
  "design": { "hasReminders": true },
  "app": { "hasReminders": false }
},
"frames": {
  "tasks-default": {
    "when": { "tasks.reminder-chip": { "hasReminders": true } },
    "variants": {
      "no-reminders": {
        "when": { "hasReminders": false },
        "reason": "Builds without reminders hide the chip (reviewer, 2026-10-02).",
        "derive": [{ "hide": "[data-testid='tasks.reminder-chip']" }]
      }
    }
  }
}
```

- Every fact needs a value on both sides; the app's facts pick the reference (`<frame>--<variant>`);
  variants whose `when` matches compose in contract order (`<frame>--a--b`).
- `when` on an element (in `frames.<key>.when`) says which facts it exists for; a variant must change
  at least one such element (or say `"scope": "background"` for a change behind a dialog only).
- `derive` steps change the rendered mockup before it is measured: `hide` (display none; a flex column
  closes up as the app's does), `style` (`"css": { ... }`), `text` (`"texts": { "<lang>": "..." }` for
  every language). Each step matches exactly one element of the frame, and shoot-design.mjs proves the
  derive hides exactly the elements whose `when` the variant's facts do not match (`variant-derive`).
- Variants are derived, never drawn by hand and never an edit of the mockup.

## Per-frame settings

| Key | Meaning |
|---|---|
| `kind` | `phone` (default), `phone-tall` (the design shows the full scroll height), `state-card` (a fragment: compared by text, fill, border, ink size and crop, never by position) |
| `root` | the root testID when it is not `<screen>.screen` / `<screen>.scrim` |
| `settleMs` | the longest wait for a still screen (default 8000) |
| `keys` | the fixture's ids for keyed testIDs: `{ "taskId": ["milk", "bread"] }` |
| `masks` | testIDs whose pixels are skipped (their bounds still checked) |
| `modal` | `{ "reachedBy": "<the modal layer's testID>", "hidden": ["<testIDs behind it>"] }`: the frame is reached through the modal layer, and what lies behind it is compared inside the root's crop |
| `probe` | `{ "region": "<id>", "element": "<the design's placeholder>", "above": ["<testIDs over it>"], "testID": "<the probe element>" }`: a region the app draws itself (a canvas, a map), masked from the rectangle a probe launch reports; `testID` defaults to `parity.probe.<region>` (a skia canvas: `<prefix>.canvas-layout`) |
| `appDrawn` | one testID of a picture the app draws with its own code: its pixels are masked, its bounds checked |
| `designMasks` | `[{ "selector", "as", "why" }]`: unlisted parts of the mockup behind a dialog that their own frame masks |
| `when`, `variants` | above |

## Device profiles

`design/parity/devices/<id>.json`, templates `iphone-16-pro.json` and `android-parity.json`:

| Key | Meaning |
|---|---|
| `id`, `platform`, `name` | the file name, `ios` or `android`, a readable name |
| `points`, `scale`, `pixels` | the screen in pt (dp), the whole pixel ratio, the screenshot size (= points x scale) |
| `safeArea` | `{ "top", "bottom" }` in pt: the mockup's `--parity-safe-*` |
| `masks` | OS-drawn areas `{ x, y, width, height }` in pt (status bar, home indicator or navigation bar), never compared |
| iOS: `deviceType`, `runtime`, `runtimeVersion`, `simulatorName`, `systemLocale`, `contentSize`, `statusBarOverride`, `languages` | simctl identifiers, `<project>-parity`, the clean status bar, per-language `-AppleLanguages`/`-AppleLocale` |
| Android: `avd` `{ name, device, systemImage, density }`, `fontScale`, `demoMode` | the AVD (`<project>-parity`), its density pinned to 160 x scale so every edge lands on a pixel, font scale, the demo-mode clock |

The Android template's safe area and masks come from the platform's documented bar heights and are
not yet verified on an emulator by this skill: check them on the first capture (the status bar and the
gesture handle must sit inside the masks) and correct the profile once.

## The design fixture

`design/parity/fixture.json` holds the data the mockup draws (the tasks, the lists, the day), in every
language. The harness keeps an exact copy (`harness.fixture`, default
`src/features/parity/parity-fixture.json`), which check-harness.mjs compares (`harness-fixture`), and a
launch writes it through the app's own repositories. Change it only together with the mockup, as an
approved design change.

## When multi-package

Run every script on the app's workspace folder (`node <skill>/scripts/check-harness.mjs apps/mobile`):
the contracts, `design/parity/` and `.parity/` then live in that workspace, every path in them is
relative to it, and the layout keys come from its own `tsconfig.json` and `rn-skills.config.json`. One
contract per app; two apps never share references.
