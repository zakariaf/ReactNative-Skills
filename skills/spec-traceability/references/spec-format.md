# The spec format, the contract and what the checker reads

How an app's requirement spec is written so that a script can look any entry up and prove every
citation of it, and exactly what `check-spec-refs.mjs` and `spec-lookup.mjs` read. Verified against
the scripts of this skill on 2026-10-14.

## Contents

- The spec folder
- Entry headings
- Fields and statuses
- The contract: contracts/spec.json
- What counts as a citation
- Tracing: built entries and excluded work
- Agreement with the commit and test rules
- Rules of check-spec-refs.mjs
- An app with no spec, and adopting one
- When multi-package

## The spec folder

The spec is a folder of markdown files in the app repo, `docs/spec/` by default, copied from the
skill's `templates/docs/spec/`. One file per kind keeps entries easy to find:

| File | Holds | Default prefix |
|---|---|---|
| `non-negotiables.md` | The few rules no task, design or library may break (offline, data survives updates, accessibility, start/end layout) | `NN-` |
| `screens.md` | Every screen: what it shows, actions, states, its route | `SCR-` |
| `requirements.md` | Behaviours, each provable by one test or flow | `REQ-` |
| `decisions.md` | Open decisions (with a default) and settled ones | `DEC-` |
| `out-of-scope.md` | What this version does not build | `OOS-` |
| `README.md` | How the folder is organized; holds no entries | — |

Sub-folders and `.mdx` files are read too; files starting with `.` are not. The file names are a
convention, not a rule: the kind comes from the ID prefix, wherever the heading sits.

## Entry headings

An entry is a markdown heading of any level, `<ID> · <title>`:

```markdown
### REQ-4.1 · Ask for notification permission on first use
```

- **The ID** is a configured prefix plus a number: `REQ-4`, a child `REQ-4.1` (up to two dots), an
  optional lowercase letter `SCR-11a`. Prefixes are 1 to 10 capitals or digits starting with a letter,
  optionally ending in `-` or `_`. Keep the `-`: `REQ-4` is unmistakable, `R4` is not.
- **The separator** is the middle dot `·` (U+00B7); an em dash, an en dash, ` - ` or `:` also work.
- **The text** of an entry runs from its heading to the next heading of the same or a higher level, so
  a parent prints with its children (`spec-lookup REQ-4` includes `REQ-4.1`).
- **Numbered sections** (`## 4 · Reminders`, `### 4.2 · Snooze`) are entries too, of kind `section`,
  for specs that number their chapters. With `"sections": "auto"` (the default) section citations are
  checked only when the spec has at least one numbered section: in a spec without one (the shipped
  templates have none), `spec 7.3` is not read at all. Set `"sections": true` to check it anyway, so
  every `spec N.N` citation must name a numbered section.
- A heading that starts like an entry but is not one (`### REQ 6 · Archive`, `### REQ-2` with no
  title) is reported as `malformed-heading`: nobody could look it up.
- Headings inside fenced code blocks are ignored, so the README can show an example entry.

## Fields and statuses

Fields are `Name: value` lines of the entry's own body, above its first sub-heading (a list marker and
bold are allowed: `- **Status:** built`). The checker reads these; any other field is free text.

| Field | Values | Read by |
|---|---|---|
| `Status` | `planned`, `in-progress`, `built`, `dropped`, `out-of-scope`, `open`, `decided` | `invalid-field`, `untraced-requirement`, `out-of-scope-traced`, `route-missing` |
| `Platforms` | `ios`, `android`, `web` (comma or space separated); leave it out when the entry applies everywhere | `invalid-field` |
| `Route` | the route file in backticks, `src/app/(app)/settings.tsx` | `route-missing` once the entry is `built` |
| `Default` / `Decided` | the default of an open decision, or what was decided | `entry-field-missing` for decisions |
| `Enforced by` | the test, lint rule, flow or check that holds a non-negotiable | `entry-field-missing` for non-negotiables |

An entry without `Status:` takes its kind's `defaultStatus` (`planned` unless the contract says
otherwise; decisions `open`, out-of-scope entries `out-of-scope`, non-negotiables `decided`).

The lifecycle of a traced entry: `planned` → `in-progress` (a slice started) → `built` (its first test
is green and committed) → possibly `dropped`. An ID is never renamed or reused: a dropped entry stays
in the file, so old commits and tests still resolve, and a reused ID is reported as
`duplicate-spec-id`.

Platform differences: when iOS and Android behave differently, split the entry into children with a
`Platforms:` line each (or one child per platform), so each behaviour is traced by its own test or
flow. Example: notification permission is the system prompt on iOS and the `POST_NOTIFICATIONS`
runtime permission on Android 13 and later; Android's predictive back and edge-to-edge layout have no
iOS twin.

## The contract: contracts/spec.json

Optional; without it the defaults below apply (they equal the shipped `templates/contracts/spec.json`).
A malformed contract is exit 2, never a silent pass. `rn-skills.config.json` `"specContract"` moves the
file, and `--contract` overrides both.

| Key | Default | Meaning |
|---|---|---|
| `specDir` | `docs/spec` | The spec folder, repo-relative (`--spec` overrides it) |
| `kinds` | the five kinds above | `[{ kind, prefix, traced, named, requiredFields, defaultStatus, bareIn }]` |
| `kinds[].traced` | false (true for `SCR-`, `REQ-`) | A `built` entry must be cited by a test or flow |
| `kinds[].named` | false (true for `SCR-`) | `Title (ID)` pairs are checked against the entry's title and aliases |
| `kinds[].requiredFields` | decisions `Default\|Decided`, non-negotiables `Enforced by` | `A\|B` means either field |
| `kinds[].bareIn` | `everywhere` for prefixes ending in `-`/`_`, else `comments` | Where a bare ID is read (below) |
| `sections` | `auto` | `true`, `false` or `auto` |
| `aliases` | `{}` | Extra names per ID: `{ "SCR-1": ["Home", "Tasks"] }` |
| `traceGlobs` | `*.test.{ts,tsx,js,mjs}`, `<e2eDir>/**/*.{yaml,yml}` | Files whose citations trace an entry |
| `ignore` | `[]` | Extra globs the checker does not read |

An app already using other IDs keeps them: `{ "kind": "story", "prefix": "US-", "traced": true }`.

## What counts as a citation

The checker walks the repo (installed skills under `.agents/`, `.claude/`, `skills/` and any folder
holding a `SKILL.md`, `node_modules`, `ios/`, `android/`, build output, `*.d.ts`, `package-lock.json`,
`reports/coverage`, `reports/stryker` and `scripts/git/**` are never read) and reads `.ts .tsx .js
.jsx .mjs .cjs .md .mdx .yaml .yml .txt .json` files, the spec itself included:

- **A prefixed ID** (`REQ-19`, `SCR-16`) anywhere, when its prefix ends in `-` or `_`: in code,
  strings, comments, markdown, flows, JSON. An unknown one is `dangling-id`.
- **A short prefix** without a separator (`S16` for a kind with prefix `S`) only inside comments of
  code files (and anywhere in markdown, flows and other text files), because `S256` in a code string
  is a crypto name, not a citation. A comment such as `PKCE (S256)` is still read once an app
  configures the prefix `S`, which is one more reason to keep a separator. This is why
  the defaults end in `-`: bare `S7`, `D4` or `N3` mean nothing to the checker unless the app
  configures such a prefix.
- **A section**: `spec 4.2`, `spec section 4`, `spec § 4.2`, `spec's 4.2`, lists and ranges
  (`spec sections 1.1 to 1.2`). Dates (`spec 2026-09-26`) and measures (`spec 1.2 - 180 s`) are not
  read. An unknown section is `unknown-spec-section`.
- **A name pair** for `named` kinds: `Task list (SCR-1)`, `SCR-1 (Task list)`, `(Task list, SCR-1)`.
  A name that belongs to another entry is `screen-name-mismatch`; a child ID accepts its parent's name.
- **Commit messages** with `--range <revs>` (runs `git log`) or `--log <file>`: every ID must exist.
  A range with no commit yet (base equals HEAD, work still uncommitted) prints a `NOTE` and checks
  the files only; an empty `--log` file is bad input (exit 2).

A line holding `spec-refs-ignore` and the line after it are not read; use it for test data that names
a missing ID on purpose, never to silence a real citation.

## Tracing: built entries and excluded work

A file matching `traceGlobs` (tests and end-to-end flows) that cites an entry traces it. Comments in
source files (`// Task list (SCR-1)`) are checked for existence but do not trace: only a test proves a
behaviour.

- `untraced-requirement`: a `traced` kind marked `built` that no test or flow cites. Mark an entry
  `built` in the commit that adds its green test, and cite it there. A parent marked built needs its
  own citing test or flow; tests of its children (`REQ-4.1`, `REQ-4.2`) trace only the children, so
  a parent split per platform cites itself in the test that covers the shared behaviour.
- `out-of-scope-traced`: a test or flow cites an entry whose status is `dropped` or `out-of-scope`.
  A test for excluded work means the work was built.
- **A guard test** that proves excluded work stays absent (no sign-in button, no widget target) is a
  legitimate regression test, but it must not cite the `OOS-` entry: the checker cannot tell "builds
  it" from "proves it is absent" by reading a title. Cite the non-negotiable or the requirement that
  keeps the work out, `it('shows no sign-in button (NN-1)')`, so the guard traces what it protects.
  When no such entry exists, put `spec-refs-ignore` on the line above the `OOS-` citation and say why
  in the same comment (`// spec-refs-ignore: guard, OOS-1 must stay absent`).
- `--trace` prints the matrix: `TRACE REQ-1 [built] Add a task: .maestro/add-task.yaml,
  src/features/tasks/add-task.test.ts`. Paste it into a release report to show coverage by
  requirement.

## Agreement with the commit and test rules

The commit-msg hook (git-commits-and-reporting) accepts a requirement reference in a commit body or a
`Spec-Change:` trailer only when it matches `requirementRef.pattern` of `contracts/commits.json`, or
the default pattern of `scripts/git/requirement-ref.json` (this skill carries a synced copy). The
history check of tdd-workflow uses `requirementIdPattern` of `contracts/tdd.json` (moved by
`rn-skills.config.json` `"tddContract"`). `ref-pattern-mismatch` fails on every traced ID one of these
patterns rejects, before a commit or a first test that cites it is refused.

The default pattern wants a capital word of 2 to 10 characters, `-`, digits with optional dotted
children and one optional lowercase letter, then a word boundary; both the hook and this checker test
it with `RegExp.test`, so a match anywhere in the ID is enough. It accepts `REQ-4`, `SCR-12`, dotted
children such as `REQ-4.1` and lettered ones such as `SCR-2a`. It rejects a prefix ending in `_`
(`US_4`, which the contract allows but the pattern never matches) and a one-letter prefix (`R-4`).
Either keep traced IDs to the accepted shapes, or set the app's own pattern in both contracts, for
example `"\\b(?:REQ|SCR|US)[-_]\\d+(?:\\.\\d+)*[a-z]?\\b"`.

## Rules of check-spec-refs.mjs

| Rule | Fails when | Fix |
|---|---|---|
| `spec-missing` | the contract names a spec folder that does not exist | create it or fix `specDir` |
| `spec-empty` | the spec folder holds no entry heading | write entries as `## REQ-1 · <title>` |
| `malformed-heading` | a heading starts like an entry but is not `<ID> · <title>` | fix the heading |
| `duplicate-spec-id` | two entries share an ID | next free number; never reuse |
| `invalid-field` | an unknown `Status:` or `Platforms:` value | use the listed values |
| `entry-field-missing` | a decision without `Default:`/`Decided:`, a non-negotiable without `Enforced by:` | add the field |
| `route-missing` | a `built` entry's `Route:` file does not exist | fix the path or the status |
| `ref-pattern-mismatch` | a traced ID the commit or test reference pattern rejects | change the ID shape or the pattern |
| `dangling-id` | a cited prefixed ID that is not in the spec | cite a real ID, or add the entry with the reviewer's agreement |
| `unknown-spec-section` | `spec 4.9` with no such section | cite the right section |
| `screen-name-mismatch` | `Settings (SCR-1)` where SCR-1 is another screen | name the entry by its title, or add an alias |
| `untraced-requirement` | a `built` traced entry no test or flow cites | cite it in its first test |
| `out-of-scope-traced` | a test or flow cites dropped or out-of-scope work | remove it, or bring the entry back into scope first |

`spec-lookup.mjs` has one rule, `unknown-spec-id`, and prints the nearest IDs of the same kind.

## An app with no spec, and adopting one

With no `contracts/spec.json` and no `docs/spec/` folder both scripts print `NOT APPLICABLE: the app
keeps no requirement spec` (exit 0); asking `spec-lookup` for an ID then exits 2, because there is
nothing to quote. Requirements then come from the issue tracker or the acceptance criteria: quote them
with their key (`TASKS-12`, `#41`), which the default commit reference accepts.

To adopt a spec in a running app: copy `templates/docs/spec/` and `templates/contracts/spec.json`,
replace the Tasks examples with the app's screens and behaviours (every entry `planned`), run
`check-spec-refs.mjs .` until it passes, then mark entries `built` one by one as their tests cite
them. An app with tracker keys keeps them as a kind (`"prefix": "TASKS-"`) so old commits still
resolve.

## When multi-package

In a workspace repo, keep one spec per app inside its folder (`apps/mobile/docs/spec/`) and point the
contract's `specDir` at it, or pass `--spec apps/mobile/docs/spec`; the contract lives in the repo's
`contracts/` folder or wherever `"specContract"` points. Workspace output folders (`apps/*/ios`,
`packages/*/build`) are skipped through `package.json` `workspaces`. A product made of several apps
that share one spec uses one prefix set, and each app's screens get their own `SCR-` numbers.
