# The screen contract: contracts/screens.json

The app's screens, dialogs and overlays in one repo-owned JSON file. It is the design-to-code
contract: the design names each element once, the contract gives it a testID, a role, a component and
its copy keys, and the code, the view tests, the E2E flows (e2e-maestro) and the screenshot checks
(design-visual-parity) all use exactly those ids. `check-screens.mjs` proves the code matches it;
`list-screen.mjs` prints one screen's part of it. The template is `templates/contracts/screens.json`
with its JSON Schema `templates/contracts/screens.schema.json` (editors validate the file while you
type it).

## Contents

- Where the file lives
- Top level
- A screen
- Which files are a screen's code
- States
- Elements and testIDs
- Derived parts (components that build child ids)
- Screenshot reach (parent, a11yHidden, coveredBy, checks)
- Policies
- Ignored routes
- Changing the contract
- When multi-package

## Where the file lives

`contracts/screens.json` at the repo root. A repo that keeps contracts elsewhere sets the layout key
`"contractsDir"` (every contract moves) or the key `"screensContract"` (this file only) in the
optional `rn-skills.config.json`; `--contract <file>` overrides both for one run. The checkers also
read the layout keys `routesDir` (default `src/app`, or `app` when only that exists), `i18nDir`
(default `src/i18n`) and the `@/*` alias from `tsconfig.json`.

## Top level

| Key | Meaning |
|---|---|
| `version` | `1` (the format these scripts read) |
| `screens` | every screen, dialog and overlay of the app (below) |
| `policies` | app-wide screen rules the checker enforces (below) |
| `references` | folder of the approved design frames; default `design/screens` |
| `sourceCatalog` | the catalog copy keys are checked against; default `<i18nDir>/catalogs/<SOURCE_LANGUAGE>.json` (`SOURCE_LANGUAGE` is read from `src/i18n/languages.ts`, else `en`) |
| `componentCatalog` | the component catalogue whose parts are derived; default `contracts/component-library.json` when it exists (ui-component-library writes it) |
| `components` | derived parts for components outside the catalogue, or overrides |
| `ignoredRoutes` | route files that are not screens (`{ "file", "why" }`) |

## A screen

```json
{
  "id": "lists",
  "name": "Lists",
  "presentation": "route",
  "route": "src/app/(app)/lists.tsx",
  "model": "src/features/lists/use-lists-model.ts",
  "view": "src/features/lists/lists-screen.tsx",
  "states": [{ "id": "default" }, { "id": "empty", "drawn": false, "why": "Chosen: ..." }],
  "elements": [{ "testID": "lists.screen", "role": "none", "component": "View" }]
}
```

| Key | Meaning |
|---|---|
| `id` | kebab-case, unique: `lists`, `task-detail`, `delete-list-dialog` |
| `presentation` | `route` (a stack or tab screen), `modal-route` (an Expo Router route presented as `modal`, `formSheet`, `pageSheet` or `fullScreenModal`), `dialog`, `overlay`, `sheet` (drawn over another screen inside its tree), `embedded` (a part with its own contract, never on its own) |
| `route` | the Expo Router file; required for `route` and `modal-route` |
| `model` | the model hook `use-<feature>-model.ts`; required for `route` and `modal-route`. A dialog names the model that opens it and translates its copy (its copy keys are found there) |
| `view` | the pure view |
| `test` | the view test; default: the view with `.test.tsx` |
| `code` | where the screen's code lives (next section); default: the view's folder |
| `scopes` | the first testID segments this screen owns; default `[id]`. One scope, one owner |
| `states` | every state, the default first (below) |
| `elements` | every element the design shows, and every Chosen one (below) |
| `notes` | free text for the next builder |

## Which files are a screen's code

`code` lists folders (`"src/features/lists/"`), shallow folders (`"src/features/settings/*"`, no
subfolders) or single files. A file belongs to the screen whose entry is the **most specific**: a file
entry beats any folder, a deeper folder beats a shallower one. So the dialog in
`src/features/lists/delete-list-dialog/` is the dialog's code although the Lists folder contains it,
and the Lists screen is not blamed for the dialog's ids. Test files (`*.test.ts(x)`, `__tests__/`) are
never code; folders holding a `SKILL.md` (installed skills) are skipped.

## States

| Key | Meaning |
|---|---|
| `id` | kebab-case: `default`, `empty`, `error`, `offline`, `premium`, `loading` |
| `drawn` | `false` when the design has no frame for it: a Chosen state. It still needs a layout |
| `why` | required when `drawn` is false: what the state shows and who decided ("Chosen: one line and a Try again action, agreed with the reviewer on 2026-10-02") |
| `reference` | the approved design frame of this state, a file in the references folder (`lists-default.png`) |

Every state after the first needs a view-test block named for it (`it('shows the empty state …')` or a
`describe('when empty')`) that renders that state and audits it.

## Elements and testIDs

| Key | Meaning |
|---|---|
| `testID` | `<scope>.<element>[.<part-or-key>…]`, kebab segments; a `{camelCase}` segment stands for a data key (`lists.list-row.{listId}`), one id per item, never an index. naming-conventions owns the grammar |
| `role` | what VoiceOver and TalkBack announce: `button`, `switch`, `checkbox`, `header`, `text`, `image`, `list`, `tab`, `none` |
| `component` | what draws it: a library component (`Button`, `ListRow`), `AppText`, `View`, `FlatList`, `PressableSurface` |
| `kind` | a variant of the component, free text (`secondary`, `danger`) |
| `text` | the copy key of its visible text; leave it out for data text (a list's own name) |
| `a11yLabel` | the copy key of its accessible name when that differs from the text ("Delete" shows, "Delete Groceries" is read) |
| `textVia` | a module outside the screen that renders the key (a shared formatter); the key is looked for there |
| `states` | only in these states; default: every state |
| `requires` | a capability it depends on (an entitlement, a flag), free text |
| `note` | free text |

An element is listed once per state: a second entry with the same id needs `states` that do not
overlap. Copy keys must exist in the source catalog (`unknown-copy-key`) and be used in the screen's
code, its model hook or its `textVia` module (`missing-copy-key`).

## Derived parts (components that build child ids)

A library component derives its parts from the one testID the screen passes: `Button` with
`testID="lists.add-button"` sets `lists.add-button.label` itself. List the parts in the contract
anyway (E2E flows and screenshot checks address them), and the checker counts them as present when
their parent id is set on that component:

- the parts per component come from the component catalogue's `components[].parts`
  (ui-component-library's `contracts/component-library.json`), read automatically;
- a component outside the catalogue, or an override, goes in the contract's `components`:
  `{ "SummaryCard": { "parts": ["title", "value"] } }`;
- a component that repeats a child per data item is `keyed`: `SegmentedControl`, `StatGrid`,
  `BarChart` and `PagerDots` are by default; their children are `<testID>.<key>[.<part>]`
  (`lists.sort-control.{sortKey}.label`).

A misspelt base id (`testID="lists.sumary-card"`) then fails as `missing-testid` for every part, with
the fix "pass `testID="lists.summary-card"` to SummaryCard".

## Screenshot reach (parent, a11yHidden, coveredBy, checks)

Maestro and the accessibility tree list only accessible elements, never their children or hidden
parts. These keys tell design-visual-parity how far it can measure an element; `list-screen.mjs`
prints them in the `reach` column:

| Key | Meaning |
|---|---|
| `parent` | the accessible element it sits inside: crop-only, judged in the parent's crop |
| `a11yHidden` | hidden from screen readers (decorative): crop-only |
| `coveredBy` | the reachable element whose crop judges its pixels |
| `checks` | which comparisons apply: `bounds`, `text`, `fill`, `crop` (default `bounds`) |

View tests still find hidden parts with `{ includeHiddenElements: true }`.

## Policies

| Key | Meaning |
|---|---|
| `primaryAction` | `{ "max": 1, "match": [{ "component": "Button", "prop": "variant", "value": "primary" }] }`: at most `max` matching JSX elements per file (`one-primary-action`) |
| `adSlot` | `{ "components": ["AdBannerSlot"], "screens": ["tasks"] }`: the ad slot components and the only screens that may render or import them (`ad-slot-not-allowed`); leave it out when the app has no ads |
| `modalRoots` | components that keep screen readers inside an overlay; default `Modal` and `Scrim`, plus every catalogue component marked `modalRoot` |
| `retiredKeys` | `{ "<old key>": "<new key>" }`: a retired key fails in the contract and in code (`retired-copy-key`) |

Never-for-paying-users is part of the ad policy too, but it is a runtime fact: the ads skill
(admob-ads-and-consent) hides the slot for Premium, and the view test of an ad screen covers a
`premium` state without it.

## Ignored routes

A route file that is not a screen of its own (a redirect `index.tsx` that only returns
`<Redirect href="/lists" />`) goes under `ignoredRoutes` with its reason. Layouts (`_layout.tsx`),
`+html`, `+native-intent`, `+middleware` and API routes (`+api.ts`) are never screens and need no entry.
Every other route file needs a screen (`screen-unlisted`), so a new route cannot ship without its
contract.

## Changing the contract

The contract changes first, in its own reviewed change, and the code follows:

- **A new testID** (the design gained an element) is added here with its role, component and keys,
  then built. Never invent one in code to make a test pass: `unknown-testid` fails it.
- **A new state** is added with `drawn` and `why` before its layout is built.
- **A renamed key** goes into `retiredKeys` with its successor until no catalog holds it.
- **A new screen** is added with its route, model, view and states before the route file exists, so
  `screen-unlisted` never fires on a half-built screen.

## When multi-package

Run the checkers on the app's workspace folder as the positional root
(`node ${CLAUDE_SKILL_DIR}/scripts/check-screens.mjs apps/mobile --all`). The contract then lives in that workspace
(`apps/mobile/contracts/screens.json`), every path in it is relative to `apps/mobile`, and the layout
keys come from that workspace's `tsconfig.json` and its own `rn-skills.config.json`. One contract per
app: two apps never share screen ids, because their E2E flows and screenshots are separate.
