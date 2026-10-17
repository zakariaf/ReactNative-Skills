# The generator and the checker

`scripts/scaffold-feature.mjs` writes a feature; `scripts/check-feature.mjs` proves one (or every)
feature complete. Both are Node ESM with zero dependencies and follow the library's output contract:
`FAIL <file>:<line> [<rule>] <message> Fix: <fix>`, a summary line, then `RESULT: PASS` or
`RESULT: FAIL (<n> problems)`; exit 0 pass, 1 problems, 2 bad input.

## Contents

- scaffold-feature.mjs
- What it writes
- The view's frame
- The bootstrap starter
- Catalogs, contracts and formatting
- check-feature.mjs
- check-feature rules
- SKIP and NOT APPLICABLE
- Configuration and multi-package

## scaffold-feature.mjs

```sh
node ${CLAUDE_SKILL_DIR}/scripts/scaffold-feature.mjs . --feature notes --route "(app)/notes" --title "Notes"
node ${CLAUDE_SKILL_DIR}/scripts/scaffold-feature.mjs . --feature note-detail --route "(app)/notes/[noteId]" --title "Note" --write
```

| Option | Meaning |
|---|---|
| `[repo-root]` | positional, default `.`; needs a `package.json` with `expo-router` |
| `--feature <name>` | kebab-case folder name, also the testID scope and key prefix |
| `--route "<route id>"` | the route file path under the routes folder without the extension; a dynamic route ends in one `[camelCaseParam]` |
| `--title "<Title>"` | the navigation title in the source language (`<f>.title` in the source catalog); one line, no braces or angle brackets |
| `--body "<text>"` | the body the skeleton shows, in the source language; default `Nothing here yet.` |
| `--source-language <tag>` | the language `--title` and `--body` are written in; default `SOURCE_LANGUAGE` in `<i18nDir>/languages.ts` (i18n-strings-and-catalogs), else its first `LANGUAGES` entry, else `en` |
| `--drop-contract-comments` | edit a contract that holds `//` comments anyway, accepting that they are lost |
| `--write` | write the plan; without it the run is a dry run |

Plan lines, in order: the frame note (`note src/ui/screen-frame.tsx exists` / `does not exist`), the
catalogs (`edit <file> (+<n> keys[, <m> drafts to translate])` or `same <file>`), the drafts per
language (`drafts <lang>: <keys>`) and the review-queue note, the contracts, then code files
(`new  <file>`, `same <file>`), the starter note, then a summary (`would write` / `wrote <n> new files
and <m> edits`). Problems (exit 1, nothing written):

| Rule | When | Fix |
|---|---|---|
| `conflict` | a planned file exists with other content; a source-catalog key exists with other text; a `paramParsers` entry or a screen id belongs to another file; a catalog or contract is not valid JSON; a contract to edit holds `//` comments (without `--drop-contract-comments`); another route file serves the same URL (groups and a final `index` dropped, parameter names ignored, platform suffixes stripped: `notes` beside `(app)/notes.tsx`) | pick another `--feature` or `--route`, or finish the existing feature by hand; for comments, move them to a `"$comment"` key |
| `starter` | a planned file is, or lies in, the starter screen of expo-project-bootstrap | delete the starter files it names, then rerun the same command |
| `format` | the app's Prettier failed on the written files | run `npx prettier --check` on the files it names |

Bad input (exit 2): no `package.json`, no `expo-router`, a feature name that is not kebab-case, a
route id the scaffold does not write (a bracket in the middle, a catch-all, a layout, a `+` file), a
missing `--route` or `--title`, a title with braces or line breaks, a `--source-language` that is not
a language tag.

## What it writes

Static route (`--route "(app)/notes"`), from `templates/src/app/__ROUTE_ID__.tsx` and
`templates/src/features/__FEATURE__/`:

```
src/app/(app)/notes.tsx
src/features/notes/notes-screen.tsx            notes-screen.test.tsx
src/features/notes/use-notes-model.ts          use-notes-model.test.tsx
src/features/notes/notes-navigation.test.tsx
keys: notes.title, notes.body
```

Dynamic route (`--route "(app)/notes/[noteId]"`), from `__DETAIL_ROUTE_ID__.tsx` and `__DETAIL__/`:
the same five files plus `note-detail-params.ts`, `note-detail-params.test.ts` and
`components/note-detail-invalid-link.tsx`; keys `note-detail.title`, `.body`,
`.invalid-link.body`, `.invalid-link.go-home`.

Placeholders it fills (the values of `assets/template-placeholders.json` prove the templates):
`__FEATURE__`/`__DETAIL__` (the feature), `__FEATURE_PASCAL__`/`__DETAIL_PASCAL__`, `__ROUTE_ID__`/
`__DETAIL_ROUTE_ID__`, `__ROUTE_HREF__` (`/notes`), `__DETAIL_HREF_BASE__` (the URL without the param,
`/notes`), `__PARAM__` (`noteId`), `__TITLE__`/`__DETAIL_TITLE__`, `__BODY__`/`__DETAIL_BODY__`. A
title used inside code becomes a string literal the way Prettier writes it (double quotes when the
text holds an apostrophe). When the app's layout moves a folder (`rn-skills.config.json`
`routesDir`, `featuresDir`, `i18nDir`), files land there and line 1 names the real path; imports
still use the `@/` alias, so a moved routes folder needs its alias too.

## The view's frame

When the app has `<uiDir>/screen-frame.tsx` (react-components-and-hooks' `ScreenFrame`), the
generator rewrites the template's plain `View` root: `<ScreenFrame testID="<f>.screen"
edges={BELOW_HEADER_EDGES}>`, the `@/ui/screen-frame` import, and no `screen` style or centred-column
keys of its own (the frame brings the ground colour, the insets and the column). The screen entry's
root element then names `ScreenFrame`. Each rewrite must match the template exactly once; a template
that drifted stops the run with a crash naming the edit, never a half-framed view. Without the file
the root stays a plain `View` and the plan says so. Verified on 2026-10-14: both roots pass `tsc`,
ESLint, Prettier and their Jest tests in the reference app, the framed one with the real
`screen-frame.tsx` copied in.

## The bootstrap starter

expo-project-bootstrap's starter route and screen (`src/app/index.tsx`, `src/features/home/`) carry
the header phrase `(scaffold-feature-screen) replaces` in their first 8 lines; that phrase is how both
scripts recognise them. The generator never overwrites them: a planned file that is one of them (or
lies in the starter folder) becomes one `starter` problem naming every starter file to delete, and a
run beside the starter prints `note the starter screen of a new app is still here (...)`.
`check-feature.mjs` reports a starter feature as one `starter-screen` problem and checks nothing else
in it. Generate the first feature at `--route index` (or `"(app)/index"`) after deleting the starter.

## Catalogs, contracts and formatting

- **Catalogs:** every `<i18nDir>/catalogs/<tag>.json` gains the group's keys, sorted. `--title` and
  `--body` are source-language text: the source catalog gets them as they are, every other catalog
  gets them as drafts. The fixed texts (the invalid-link body and button) come from this skill's `en`
  and `ar` templates; any other language gets the English text as a draft. The plan counts the drafts
  per catalog (`+2 keys, 2 drafts to translate`) and lists them per language (`drafts ar: notes.body,
  notes.title`). A drafted language missing from `contracts/i18n.json` `reviewLanguages` gets a note
  naming it (add it, so i18n-strings-and-catalogs' review queue carries the drafts); with no
  `contracts/i18n.json`, the note says the drafts reach no queue yet (list them in the report). A key
  that already exists with the same text is left alone; in the source catalog a different text is a
  `conflict` (the name is taken). No catalogs folder: noted, nothing merged. No catalog for the
  source language: noted, and no key is checked for a conflict.
- **Source language:** `--source-language`, else the `SOURCE_LANGUAGE` literal in
  `<i18nDir>/languages.ts`, else its first `LANGUAGES` entry, else `en`. The same value picks the
  catalog `check-feature.mjs --orphans` reads.
- **Contracts:** with `contracts/navigation.json`, the route id is appended to `routes` and a dynamic
  route mapped in `paramParsers`; with `contracts/screens.json`, the screen entry is appended (see
  routes-and-params "The contracts"). An absent contract is noted, not created: its owner skill
  creates it with the app's other routes and screens.
- **Comments in contracts:** contracts are read as JSON with comments but written as plain JSON, so
  an edit would drop every `//` line. A contract the plan edits that holds comments is a `conflict`
  naming the line count; move the comments into a `"$comment"` key, add the planned entries by hand,
  or pass `--drop-contract-comments` (the plan then notes how many lines are dropped). A contract the
  plan leaves alone (`same`) is never rewritten, so its comments stay.
- **Formatting:** JSON edits are printed in Prettier's JSON layout (`scripts/lib/json-format.mjs`:
  objects expanded, primitive arrays on one line when they fit in 100 columns), so an unchanged
  contract prints byte for byte as before. After `--write`, when `node_modules/prettier` exists, the
  written files go through the app's own Prettier, because a long feature name re-wraps lines the
  template kept on one. Without Prettier the plan says to format them.
- **Never overwrites.** A rerun after a successful write prints only `same` lines; a partly written
  feature (a file deleted by hand) gets only the missing files.

## check-feature.mjs

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-feature.mjs .                         # every screen feature
node ${CLAUDE_SKILL_DIR}/scripts/check-feature.mjs . --feature note-detail   # one, which must exist
node ${CLAUDE_SKILL_DIR}/scripts/check-feature.mjs . --feature notes --orphans
```

A **screen feature** is a folder `src/features/<f>/` holding `<f>-screen.tsx`, or a feature a route
file imports from. Folders without a screen (`root-navigator`, `crash-recovery`) are not screens and
are not checked. A folder holding a `SKILL.md` is an installed or vendored skill and is skipped, and
the route walk prunes such folders too.

## check-feature rules

| Rule | Fails when | Fix |
|---|---|---|
| `starter-screen` | the feature's screen file is expo-project-bootstrap's starter (its header says this skill replaces it); no other rule runs on it | delete the starter route and folder it names, then generate the first feature at that route |
| `feature-files` | `<f>-screen.tsx`, `use-<f>-model.ts`, `<f>-screen.test.tsx` or `use-<f>-model.test.ts(x)` is missing (with `--feature`, also a folder that does not exist) | generate the feature, or add the file from the template of the same name |
| `feature-names` | the view does not export `<F>Screen`; the model file does not export `use<F>Model` or `type <F>Model` | name the exports after the files |
| `component-placement` | a `.tsx`/`.jsx` file other than `<f>-screen.*` sits in the feature root | move it to `components/` (a dialog with its own model to its own subfolder) |
| `route-wiring` | no route renders the feature (unless its `contracts/screens.json` entry has a `presentation` other than `route` or `modal-route`: `embedded`, `sheet`, `overlay`, `dialog`); or a route imports it but does not both call `use<F>Model()` and render `<F>Screen` (both imported from the feature) | the two-line route |
| `route-test` | a route that renders the feature has no test in the feature folder that imports the route file and calls `renderRouterWithProviders`, and the route has no `// device-only:` marker in its first 6 lines. Expo Router's own `renderRouter` does not count: it renders without the app's providers (unit-and-component-tests rule 5, whose `check-test-code` fails it too) | add `<f>-navigation.test.tsx` from the template |
| `params-parser` | a route with a `[param]` has no `<f>-params.ts`, or no `<f>-params.test.ts`, or the parser does not name each bracket param as an object key | create or fix the parser and its test |
| `params-in-model` | the route file or the view reads `useLocalSearchParams`/`useGlobalSearchParams`; or no `use-<f>(-part).ts` hook both imports the parser and calls `useLocalSearchParams()`. A hook that reads `useGlobalSearchParams` instead is named at its line: the global hook re-renders the screen on every URL change, even one in another screen | read the params in the model through the parser with `useLocalSearchParams()` |
| `view-pure` | the view or a `components/` file value-imports `expo-router`, `@react-navigation/*`, `zustand`, `@tanstack/react-query`, `react-intl`, the stores, services, data or api folders, the i18n `t` modules or the feature's own hook files; or calls `useT`, `useIntl`, `useRouter`, `useNavigation`, `useServices`, `useQuery`, `useMutation` or a `use…Store` hook (`import type` is fine) | read it in the model and pass the value |
| `message-key-missing` | a literal `t('<key>')` in the feature's code or its route is missing from a catalog; a catalog is not valid JSON | add the key to every catalog |
| `message-key-orphan` | `--orphans` only: a key under `<f>.` in the source catalog (`<source language>.json`, else the first) appears as a quoted literal in no code file of the repo (tests count; installed skills do not) | delete it from every catalog, or use it |
| `placeholder-left` | an unfilled `__UPPER_SNAKE__` token (React Native's `__DEV__` aside) in a feature file, its route, or a catalog entry under `<f>.`; or any path under the routes or features folder holding one | regenerate, or fill it |
| `nav-contract` | the route id is not in `routes`; a dynamic route's `paramParsers` entry is not the feature's parser; the contract is not valid JSON | add the entries |
| `screen-contract` | no entry has `"view": "<f>-screen.tsx path"`; its `model` differs; a routed entry's `route` is not a route that renders the feature; the contract is not valid JSON | add or fix the entry |

Heuristic limits, documented rather than chased with more patterns: the checks read source text,
not types. A param read through a wrapper hook (`useParams()` around `useLocalSearchParams`), a
`t` renamed on import, a key built at run time (`t(\`notes.${kind}\`)`) or a route test that
renders through a helper with another name are invisible to them; keep to the shapes the templates
use. The starter is recognised by its header phrase only.

What it does not check, on purpose: testIDs, copy keys per element and per-state view tests
(screen-contracts' `check-screens.mjs`), route thinness beyond the wiring and layer direction
(architecture-and-boundaries), the route contract's other keys and typed routes
(navigation-and-routing), catalog parity, plurals and sorting (i18n-strings-and-catalogs), test style
(unit-and-component-tests). Run those too (SKILL.md workflow step 8).

## SKIP and NOT APPLICABLE

- `NOT APPLICABLE: expo-router is not in package.json` when the app has no Expo Router.
- `SKIP src/i18n/catalogs [message-key-missing] not yet created (i18n-strings-and-catalogs creates it)`
  while the app has no catalogs (or `holds no catalog` for an empty folder).
- `SKIP contracts/navigation.json [nav-contract] not yet created (navigation-and-routing creates it)`.
- `SKIP contracts/screens.json [screen-contract] not yet created (screen-contracts creates it)`.

This is a completeness check for one unit of work, not a release gate; the release gates are
navigation-and-routing's `--release` and screen-contracts' `--all`.

## Configuration and multi-package

| Where | Key | Default |
|---|---|---|
| option | `--routes-dir <dir>` | `routesDir` (`src/app`, or `app/` when `src/app` is missing) |
| option | `--features-dir <dir>` | `featuresDir` (`src/features`) |
| option | `--source-language <tag>` (both scripts) | `SOURCE_LANGUAGE` in `<i18nDir>/languages.ts`, else `en` |
| `rn-skills.config.json` | `srcDir`, `routesDir`, `featuresDir`, `i18nDir`, `contractsDir`, `storesDir`, `servicesDir`, `dataDir`, `apiDir`; `uiDir` (the generator, for `screen-frame.tsx`) | the canonical layout |
| `rn-skills.config.json` | `navigationContract`, `screensContract` | `<contractsDir>/navigation.json`, `<contractsDir>/screens.json` |

Imports resolve through `tsconfig.json` `paths` (with `extends`), so an app whose alias differs from
`@/*` is read correctly.

**When multi-package:** run both scripts once per app with the app folder as the repo root
(`node .../scaffold-feature.mjs apps/mobile --feature notes ...`); each app has its own routes,
features, catalogs and contracts. Shared packages hold no routes and no features.
