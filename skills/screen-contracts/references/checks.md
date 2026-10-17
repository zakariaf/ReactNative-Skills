# The checks, rule by rule

What `check-screens.mjs` and `list-screen.mjs` prove, why each rule exists, and how to fix a `FAIL`
line. Every line names the file, the rule and the fix; fix the code to the contract, never the
contract to the code, unless the design changed (then the contract changes first, reviewed).

## Contents

- Running them
- What counts as a testID in code
- Contract rules
- testID rules
- Copy rules
- Policy rules
- Test rules
- Overlay rules
- Wiring rules
- SKIP and NOT APPLICABLE lines
- list-screen
- Limits of the heuristics

## Running them

```sh
node ${CLAUDE_SKILL_DIR}/scripts/list-screen.mjs . --screen lists         # the contract of one screen
node ${CLAUDE_SKILL_DIR}/scripts/check-screens.mjs . --screen lists       # one screen, which must be built
node ${CLAUDE_SKILL_DIR}/scripts/check-screens.mjs .                      # every built screen, the contract, every route file
node ${CLAUDE_SKILL_DIR}/scripts/check-screens.mjs . --all                # every contract screen built: the definition of done
```

`--screen` takes a screen id or one of its scopes and may repeat. `--contract <file>` reads another
contract; `--json` adds the problems as JSON. Exit 0 pass, 1 problems, 2 bad input (malformed JSON, an
unknown screen, nothing built yet without `--all`).

## What counts as a testID in code

A string literal shaped like `<scope>.<element>…` whose scope belongs to a contract screen, or a
template literal that builds one (`` `lists.list-row.${list.id}` `` is the pattern
`lists.list-row.*`; `` `${rowID}.delete-button` `` extends whatever `rowID` is). These are not
testIDs: catalog keys and keys passed to `t()`, string literal types (`type Key = 'a.b'`), storage
keys in a `*_KEY` constant, and the argument of `.get(` / `.set(` / `getItem(` / `setItem(`.
Comments are ignored, so a commented-out id neither sets nor breaks anything.

## Contract rules

- **`contract-missing`**: `--all` or `--screen` was asked and the contract does not exist. Copy
  `templates/contracts/screens.json` and its schema, then describe the app's screens. (Without those
  options a missing contract is NOT APPLICABLE: the app keeps no screen contracts yet.)
- **`contract-invalid`**: the contract breaks its format: a missing or duplicate id, a scope owned by
  two screens, a routed screen without `route` or `model`, a state that is not drawn without its
  `why`, an element id outside the screen's scopes or listed twice for one state, a `parent` or
  `coveredBy` that is not an element of the screen, a policy entry without its fields, a stale
  `ignoredRoutes` entry. The message says which; the schema says the shape.
- **`unknown-copy-key`**: an element's `text` or `a11yLabel` key is not in the source catalog. A
  wrong key shows the wrong words in every language. Add the source text first (then every language,
  i18n-strings-and-catalogs), or fix the key.
- **`reference-image-missing`**: a state names a design frame the references folder lacks. Export the
  approved frame there (1 pt = 1 px, light theme, the source language) or fix the name.
- **`screen-unlisted`**: a route file under the routes folder is no screen's `route` (layouts, `+html`,
  `+native-intent`, `+middleware` and API routes excepted). Add the screen to the contract first, or
  list a redirect-only route under `ignoredRoutes` with its why.

## testID rules

- **`screen-not-built`**: a screen named with `--screen` (or any, with `--all`) has no code. Build it
  (route, model hook, view, tests), or remove it from the contract in a reviewed change. A screen that
  is not ready stays out of navigation; it never ships as a route with no-op handlers.
- **`missing-testid`**: a contract id of a built screen is set nowhere in its code: not as a literal,
  not by a pattern, not by a component that derives it from its parent's id. E2E flows and screenshot
  checks then find nothing. Set the id on the element the design measures, or pass the base id to the
  component that derives it.
- **`unknown-testid`**: an id (or a pattern) of the screen's scope that the contract does not list, or
  a pattern that matches none of its ids (a typo such as `lists.list-rows.${id}` hides a missing id).
  Use exactly the contract's ids; a new one is a contract change first.
- **`testid-wrong-screen`**: an id of another screen's scope in this screen's code. A borrowed id makes
  a flow or a screenshot measure the wrong element; use this screen's own scope.

## Copy rules

- **`missing-copy-key`**: a key an element shows is never used in the screen's code, its model hook or
  its `textVia` module. The design's words are then missing or replaced. Translate `t('<key>')` in the
  model hook, exactly as the contract says, and hand the text to the view; the view never translates.
- **`retired-copy-key`**: a key listed in `policies.retiredKeys` is still in the contract or passed to
  `t()`. Use its successor, then delete the old key from every catalog.

Every catalog holding the same keys is i18n-strings-and-catalogs' rule (`check-catalogs.mjs`), not
repeated here.

## Policy rules

- **`ad-slot-not-allowed`**: a file of a screen outside `policies.adSlot.screens` renders or imports an
  ad slot component. Ads stay where the product decided (a list screen's bottom, never a dialog, a
  purchase flow or a form) and never for paying users.
- **`one-primary-action`**: more primary actions (`policies.primaryAction.match`) in one file than
  `max`. One obvious "go" per screen: pick the primary's label and handler from the state, make the
  others secondary.

## Test rules

- **`screen-test-missing`**: the view test does not exist, or never names one of the screen's ids.
- **`testid-untested`**: a contract id the view test never names (parts derived by a component count
  through their parent's id). Find it in the state that shows it, with
  `{ includeHiddenElements: true }` for decorative parts.
- **`state-untested`**: a state after the first has no test block named for it (its id, or the id with
  spaces, in the `it`/`describe` titles) that also audits. A state without a test is the state that
  ships blank.
- **`state-test-audit`**: a block renders the screen (`render`, `renderWithProviders`,
  `renderRouterWithProviders` or a local `render*` helper) without
  `expect(findInaccessiblePressables(screen.container)).toStrictEqual([])`, or no block audits at all.
  Each state is its own screen for VoiceOver and TalkBack; the audit is accessibility-as-code's helper
  (`test/a11y/find-inaccessible-pressables.ts`). A commented-out audit does not count.

## Overlay rules

- **`overlay-not-modal`**: a `dialog`, `overlay` or `sheet` keeps no screen reader inside it: no React
  Native `Modal`, no modal root component (`Scrim`, or another in `policies.modalRoots` or marked
  `modalRoot` in the catalogue), no `accessibilityViewIsModal` (or `aria-modal`, its alias). Draw it
  in `Modal` (or the library Scrim), or present it as an Expo Router modal route. A full-window layer
  that carries `accessibilityViewIsModal` or `aria-modal` passes this rule; that flag is iOS only, and hiding the screen behind it
  for TalkBack is accessibility-as-code's rule (`modal-overlay-android`), checked there, not here.
- **`overlay-no-back`**: Android's back button and predictive back gesture cannot close it. Each
  `<Modal` opening tag of the overlay's files must pass `onRequestClose` a real handler (not
  `() => {}`, `undefined`, `null` or `noop`); a layer outside `Modal` and the modal roots must subscribe
  to `BackHandler.addEventListener('hardwareBackPress', …)` or call a `useBackHandler(` hook. A modal
  root such as `Scrim` handles back in its own file (ui-component-library's `modal-back`). A dialog that
  ignores back traps every Android user who reaches it. Every root in `policies.modalRoots` (or
  marked `modalRoot`) is trusted to close on Android back, so both rules skip it: a third-party sheet
  listed there (`BottomSheetModal`) needs its own `BackHandler` wiring and a view test that fires
  back (overlays-and-dialogs.md).

The details are in [overlays-and-dialogs.md](overlays-and-dialogs.md).

## Wiring rules

- **`route-model-hook`**: a routed screen's route file is missing or never calls its model hook
  (`useListsModel()` for `use-lists-model.ts`). Keep the route to "call the hook, render the view".
- **`model-hook-missing`**: the contract's model hook file does not exist. Write it, or point `model`
  at it; never a stand-in that returns fixed values.
- **`model-hook-test`**: the model hook has no `use-<name>.test.ts(x)` beside it. Test it with
  `renderHook` through unit-and-component-tests' `createProvidersWrapper` and fakes: one test per state
  and per handler.

## SKIP and NOT APPLICABLE lines

- `NOT APPLICABLE: no contracts/screens.json: this app keeps no screen contracts yet` (the plain run,
  without `--all` or `--screen`). The plain run is the look-first probe of workflow step 1 in an app
  that has not adopted screen contracts, so it says so instead of failing; route coverage
  (`screen-unlisted`) starts once the contract exists. The definition of done runs `--all`, which
  fails `contract-missing` in the same app, so an app with screens and no contract never finishes.
- `SKIP src/i18n/catalogs/en.json [unknown-copy-key] not yet created (i18n-strings-and-catalogs creates it)`:
  the copy keys cannot be checked against a catalog that does not exist yet. Every other rule still
  runs.

No other SKIP is expected; a definition of done lists these two as the only allowed ones.

## list-screen

`list-screen.mjs . --screen <id>` prints the screen's files, scopes, states (Chosen ones marked, with
their reference image) and one row per element: testID, role, component, copy keys, the text in the
source language (`--lang ar` for another catalog), the states it shows in, who sets it (this screen,
or a component from its parent's id, keyed by data or not) and its screenshot reach. `--all` prints a
line per screen. Both validate the contract with the same contract-level rules as check-screens
(`contract-invalid`, `unknown-copy-key`, `retired-copy-key` for a retired key still in the contract,
`reference-image-missing`). Without a contract there is nothing to print or validate, so `--all` and
`--screen` both exit 2 (`ERROR [bad-input] nothing to check`), the missing-target rule every checker
keeps; the gate that fails `contract-missing` (exit 1) for an app with screens and no contract is
`check-screens --all`, which the definition of done runs.

## Limits of the heuristics

The scripts read TypeScript without a parser. These limits are known and deliberate; each has a way
to stay checkable:

- **A render helper that audits.** A block counts as audited only when `findInaccessiblePressables(`
  appears in the block itself. A local helper that renders and audits (`renderAndAudit()`) is seen as
  a render without an audit: keep the audit line in each block (the helper may still render).
  `renderHook(` and `renderItem(` never count as renders.
- **`it.each` titles.** `state-untested` reads titles literally: `it.each(states)('shows the %s
  state', …)` names no state, and a tagged-template `it.each` is not read at all. Write one `it` (or
  `describe`) per state whose title holds the state id.
- **Primary actions are counted per file**, not per screen (rule 8 says per screen). Mutually
  exclusive states in different component files (the empty body's action, the error body's action)
  would otherwise count together. Keep each file to one primary; two states that each need one in the
  same file pick the primary's props from the state.
- **Index ids pass here.** `` `lists.list-row.${index}` `` matches the contract pattern
  `lists.list-row.{listId}` like any data key: the checker cannot tell an index from an id.
  naming-conventions' `testid-index` (its `check-code-names`) owns that rule and fails an index written
  straight on the prop (`` testID={`lists.list-row.${index}`} ``); an id built in a variable first
  (`` const rowID = `lists.list-row.${index}` ``) passes both checkers, so review row ids by eye and
  key them by the item's id (rule 2).
- **A `<scope>.<word>` string literal in screen code counts as a testID** unless it is a catalog or
  `t()` key, a literal type, a `*_KEY` constant, or a `get`/`set` argument. An analytics event, a log
  tag or a feature-flag key shaped `lists.delete-asked` in a model hook is read as an unknown testID
  (`unknown-testid`). Keep those names out of that shape: kebab-case without dots
  (`'list-delete-asked'`), as naming-conventions prescribes for event names.
- **Back handling is matched by name.** `overlay-no-back` accepts any `onRequestClose` other than the
  listed no-ops, and any `BackHandler` subscription in the overlay's files; whether the handler really
  closes the layer is the view test's job: fire the Modal's `requestClose` event and assert the cancel
  handler, as the template dialog test does.
