# The catalogue contract and the checks

`contracts/component-library.json` is the app's list of shared components and the facts the two
scripts read. The checkers stay strict; the facts belong to the app. This file explains every key,
the layout options, every rule with its fix, and what a passing run may print.

## Contents

1. [Keys](#keys)
2. [Layout, options and rn-skills.config.json](#layout-options-and-rn-skillsconfigjson)
3. [check-components rules](#check-components-rules)
4. [write-component-specs rules](#write-component-specs-rules)
5. [Passing output, SKIP and NOT APPLICABLE](#passing-output-skip-and-not-applicable)
6. [Adopting the library in an existing app](#adopting-the-library-in-an-existing-app)

## Keys

| Key | Meaning | Default |
|---|---|---|
| `uiDir` | the shared components folder, repo-relative | the layout's `uiDir` (`src/ui`) |
| `exclude` | globs (relative to `uiDir`) of folders other skills own; replaces the default, so keep its five | `["a11y/**", "icons/**", "motion/**", "adaptive/**", "feedback/**"]` |
| `specs` | generated measurements: `tokens`, `block`, `out`, `module`, `asRenderedBorders`, `overrides` ([measurements-and-specs.md](measurements-and-specs.md)); `false` turns them off | `design/tokens.json`, `components`, `<uiDir>/component-specs.json`, `.ts`, `false`, `[]` |
| `prerequisites` | `{ file, owner, mustContain?, why? }` added to the defaults (the same file replaces a default); `{themeDir}`, `{uiDir}`, `{testDir}` are filled | theme modules, AppText, PressableSurface, the press feedback, the render helper, the pressable audit |
| `ownedElsewhere` | `{ file, owner }`: single ui files another skill keeps, added to the defaults; never discovered, never `component-unlisted` (listing one under `components` checks it after all) | `screen-frame.tsx`, `subtree-error-boundary.tsx` (react-components-and-hooks), `physical-direction-view.tsx` (rtl-and-direction), `screen-body.tsx` (screen-contracts), `ad-banner-slot.tsx` (admob-ads-and-consent), `parity-launch-marker.tsx` (design-visual-parity) |
| `pressHosts` | the only ui files that may import `Pressable`, a Touchable or a gesture-handler button | `["pressable-surface.tsx"]` |
| `components` | `{ name, file, role?, notes?, testID?, parts?, flags }` per component | required |
| `mockOnly` | `{ name, file?, why }`: design stand-ins the app never builds | `[]` |

Component entry: `name` (PascalCase, the export), `file` (relative to `uiDir`), `testID`
(`required`, the default; `optional` for decorative parts; `none`), `parts` (kebab names derived
from the testID), and the flags, each `true` only where the look is allowed:

| Flag | Allows or requires |
|---|---|
| `hidesItself` | requires `accessibilityElementsHidden` and `no-hide-descendants` (a decorative part) |
| `mayRotate` | allows a rotate transform (a drawn glyph, a decorative tilt) |
| `mayShadow` | allows a static shadow (it floats: a dialog, a toast, a thumb) |
| `inPairCell` | requires a layout style that grows (`flexGrow: 1`), never `flex: 1` |
| `modalRoot` | requires `accessibilityViewIsModal` and Android back; the only place for the flag |
| `drawnUnderline` | requires a drawn underline bar, no `textDecorationLine` |
| `holdFill` | requires the hold fill inside a track pinned to the face edges |
| `scatter` | requires `direction: 'ltr'` on the band |

A malformed catalogue (not JSON, an unknown key, a wrong type, a name listed twice) stops both
scripts with exit 2 and names the key: the schema `component-library.schema.json` documents every
key for editors.

## Layout, options and rn-skills.config.json

Both scripts take the repo root as the optional positional argument and resolve folders through
the canonical layout (`src/ui`, `src/theme`, `src/i18n`, `test/`, `contracts/`), the `tsconfig.json`
path aliases and `package.json` `workspaces`, overridable by `rn-skills.config.json`:

| Option or key | Effect |
|---|---|
| `--contract <file>`, config key `componentLibraryContract` | the catalogue path |
| `--ui-dir <dir>`, catalogue `uiDir`, config key `uiDir` | the shared components folder; when it is not the layout's, the theme is its sibling (`packages/ui/src/ui` → `packages/ui/src/theme`) |
| `--only <Name>` (repeatable) | check only these components' files, exports, testIDs, parts and tests, while building a subset; never at the end |
| `--json` | also print the problems as one JSON line |
| write-component-specs `--tokens`, `--out`, `--as-rendered-borders`, `--check` | as in the specs key; `--check` compares without writing |

The app-wide scans (`press-outside-host`, `own-press-look`, `hold-reduce-motion`) cover the source
and routes folders of the app and of every workspace. Every scan walks the repo with the
installed-skill folders pruned (`.agents/skills`, `.claude/skills`, `skills/`, any folder that holds
a `SKILL.md`) and the generated native and build folders ignored.

## check-components rules

| Rule | What fails | Fix |
|---|---|---|
| `catalogue-missing` | the ui folder holds components but no catalogue exists | copy the template, list every component |
| `prerequisite-missing` | a file the components import is missing, or lacks its `mustContain` marker | set it up with the owner skill first |
| `specs-missing` | the token file, its components block, `component-specs.json` or `.ts` is missing | run `write-component-specs.mjs`; copy `component-specs.ts` |
| `specs-mismatch` | the JSON differs from the derivation (first difference and why), or the module does not import it | rerun the generator; never edit the JSON |
| `spec-override-reason` | an override without a `why` sentence | name the design rule or decision |
| `component-missing` | a catalogue file does not exist | copy the template, or remove the entry |
| `component-unlisted` | a ui component the catalogue does not list (so none of its rules run) | add it with parts and flags |
| `component-export` | no `export function <Name>` and `export type <Name>Props` | one component per file, named after it |
| `testid-required` | the props lack a required `testID: string` | take a required testID |
| `part-not-derived` | a listed part is not `${testID}.<part>` in the source | derive it; screens never build part ids |
| `component-untested` | no test file imports the component | write `<name>.test.tsx` |
| `press-outside-host` | `Pressable`, a Touchable, React Native's core `Button` or a gesture-handler button imported outside the press hosts (anywhere in the app), by name or used as `RN.Pressable` through `import * as RN` | compose the library component; a file that must render outside every provider (a crash fallback) states why in `// press-outside-host: <reason>` on the import line or in the comment lines directly above it |
| `own-press-look` | a pressed style, `activeOpacity`, `underlayColor` or a `({ pressed })` style outside the press hosts | remove it; the look is the theme's `PRESS` |
| `press-feedback` | a press host never runs `usePressFeedback()` | call it before `onPress` (not for a switch) |
| `rotate-outside-allowed` | a rotate transform without `mayRotate` | keep controls square, or mark the glyph |
| `shadow-outside-allowed` | `shadow()` or `boxShadow` without `mayShadow` | flat parts have no shadow |
| `measurement-literal` | a bare size number in a component's StyleSheet | `COMPONENT_SPECS`, a token, or a named constant |
| `hold-reduce-motion` | a hold timer without `reduceMotion: ReduceMotion.Never` | add it |
| `decorative-not-hidden` | a `hidesItself` component stays in the accessibility tree | set both hide props |
| `testid-on-inner-text` | the component's own testID on its only text inside a box-drawing View | move it to the View with `accessible`, role and label |
| `fixed-text-height` | a fixed `height` around text | `minHeight` |
| `ui-translates` | a ui file imports the translation API (the i18n folder, react-intl, i18next) | the screen model translates |
| `pair-cell-flex` | an `inPairCell` layout style with `flex: 1` or `flexBasis: 0` | `{ flexGrow: 1 }` |
| `modal-root` | `accessibilityViewIsModal` outside the modal root, or a modal root without it | flag the scrim only |
| `modal-back` | a modal root that does not close on Android back | `Modal` `onRequestClose`, or `BackHandler` |
| `drawn-underline` | `textDecorationLine` in a `drawnUnderline` component, or no bar | draw the bar |
| `hold-fill-track` | a `holdFill` component's fill outside a pinned track | wrap it in the track |
| `scatter-ltr` | a `scatter` component without `direction: 'ltr'` | add it to the band |
| `mock-only-built` | a `mockOnly` stand-in exists | delete it, use the real thing |

**Limits: what the heuristics cannot see.** The checker reads source text, not a type-checked tree,
so a reviewer still looks for these shapes:

- `measurement-literal` scans only `StyleSheet.create({...})`; an inline `style={{ paddingTop: 4 }}`
  or a size in a style built by a helper function passes.
- `hold-reduce-motion` fires only in a file that names `holdToConfirm` or `HOLD_TO_CONFIRM`; a hold
  timer under another name is not seen (keep the hold in `use-hold-to-confirm.ts`).
- `press-outside-host` looks for `Pressable`, Touchables, React Native's core `Button` and
  gesture-handler buttons imported by name, or used as `<NS>.Pressable` after
  `import * as NS from 'react-native'`; a `require('react-native')`, a re-export through a local
  module, a `GestureDetector` with `Gesture.Tap()` used as a button, or `onStartShouldSetResponder`
  on a View is a second press implementation it misses.
- The `// press-outside-host: <reason>` marker counts on the import line or anywhere in the unbroken
  run of `//` lines directly above it (so a file header that ends at the import may carry it). A
  blank line or code between the marker and the import breaks the run. There is no built-in
  exception list: the one known case, error-handling-typed-results' crash screen
  (`src/features/crash-recovery/crash-screen.tsx`, which renders outside every provider), ships
  the marker itself.
- `<Text onPress>` (or AppText given `onPress`) and expo-router's `<Link>` without `asChild` are
  press paths too, with no press surface, feedback or pressed look, and the checker does not see
  them: a tappable phrase is a TextButton, a link wraps a library component with
  `<Link asChild>`.
- `own-press-look` reports one problem per line; several looks on one line count once.
- `fixed-text-height` follows only `styles.<name>` references (`testid-on-inner-text` also reads
  inline objects); a style passed through a variable, a prop or a spread is not followed.

Hit regions (`hitSlop`), touch-target size, roles and names on raw pressables, overlay modality on
Android, contrast and reduce-motion sources are accessibility-as-code's checks; raw colours, radii,
durations and legacy shadows are design-system-structure's; testID grammar and file names are
naming-conventions'; `src/ui` importing stores or services is architecture-and-boundaries'. This
checker does not repeat them.

## write-component-specs rules

| Rule | What fails |
|---|---|
| `specs-mismatch` | (`--check`) the JSON is missing or differs from the derivation |
| `spec-override-reason` | an override without a reason (nothing is written until it has one) |

Bad input (exit 2): no token file, no components block, a reference that points at nothing or loops,
an override whose group does not exist, a malformed catalogue.

## Passing output, SKIP and NOT APPLICABLE

A passing run prints `check-components: <n> catalogue entries and files checked, 0 problems` and
`RESULT: PASS`. Neither script prints SKIP lines: a missing prerequisite breaks the components that
import it, so it is a problem, not a step for later. NOT APPLICABLE (exit 0) appears only when a repo
fact proves the check does not apply:

- `NOT APPLICABLE: no shared component library yet: contracts/component-library.json does not exist and src/ui holds only files other skills own`
- `NOT APPLICABLE: contracts/component-library.json sets "specs": false ...` (write-component-specs)
- `NOT APPLICABLE: no component library yet: neither contracts/component-library.json nor src/ui/component-specs.json exists ...` (write-component-specs `--check`)

## Adopting the library in an existing app

1. Run `check-components.mjs .` before copying anything: without a catalogue it lists the existing
   `src/ui` components (`catalogue-missing`) and the file rules they break, which is the work list.
2. Copy the catalogue template, keep the entries for the components the app adopts, add the app's
   own components with their parts and flags.
3. Replace older primitives one by one ([building-a-component.md](building-a-component.md),
   "Replacing older primitives") until `press-outside-host` and `own-press-look` are clean.
4. Use `--only` while a subset is being built; the definition of done runs without it.
