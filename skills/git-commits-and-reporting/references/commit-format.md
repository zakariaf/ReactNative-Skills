# Commit messages

The format every commit follows. The commit-msg hook (`scripts/git/check-commit-message.ts`) and `scripts/check-commits.mjs` enforce one rule set with the same rule ids, so the hook never lets through a message the checker fails later, and the checker never fails a message the hook accepted.

## Contents

- The shape
- The header
- Scopes
- The body
- Trailers
- Gated paths
- Slices: what goes into one commit
- Committing the checked file
- Good and bad headers
- The hook and the checker: one rule set
- When multi-package

## The shape

```text
<type>(<scope>): <subject>

<body: why the change was made, and what the tests prove>

<trailers: Gate-Change / Spec-Change / Co-Authored-By, one per line>
```

Example:

```text
test(tasks): record the task row golden

The row now shows the due date under the title, so a long title no
longer cuts it off. The golden pins the new layout in light and dark.

Gate-Change: new golden for the task row with a due date
```

## The header

| Part | Rule |
|---|---|
| type | `feat` (new behaviour), `fix` (wrong behaviour corrected), `perf`, `refactor` (no behaviour change), `test` (tests only), `docs`, `build` (build tooling, dependencies), `ci`, `chore` (maintenance, release commits), `style` (formatting only), `revert` |
| scope | always expected: every change lives somewhere (next section) |
| subject | imperative ("add", "fix", "keep"), lowercase start, no trailing period, says what changes for the user or the code; never only "wip", "fix", "update", "changes" |
| length | the whole header is at most 72 characters |
| `!` | only for a change that breaks persisted data or a public contract (rare: a migration normally prevents it). This is how a breaking change is marked: `feat(data)!: drop the v1 save format`. Do not use the spaced `BREAKING CHANGE:` footer of Conventional Commits: its key holds a space, so neither rule set reads it as a trailer, and a `Gate-Change:` in the same paragraph is then reported as `trailer-placement`. When a footer is wanted too, write `BREAKING-CHANGE: <what breaks>` (with a hyphen, which Conventional Commits accepts) in the trailer paragraph |

Git-generated headers (`Merge ...`, `Revert "..."`, `fixup! ...`, `squash! ...`, `amend! ...`) are accepted as they are; do not rewrite them.

## Scopes

The allowed scopes are computed from the repo, the same way by the hook (`scripts/git/commit-config.ts`) and by `check-commits.mjs`. Both read `<contractsDir>/commits.json` and the folders `<srcDir>/features/*` and `<srcDir>/*`, and of `rn-skills.config.json` (the layout file the other checkers of this library read) **exactly two keys**: `srcDir` (default `src`) and `contractsDir` (default `contracts`). Two readers of one rule must see the same facts, so neither reads more of that file than the other. An app whose scopes live anywhere else sets `scopeFolders` in the contract, which both read. Below, `contracts/` and `src/` are the defaults.

| Source | Scopes it gives (Tasks app example) |
|---|---|
| each visible folder under `src/features/` | `tasks`, `lists`, `reminders` |
| each visible folder under `src/` (the layers) | `app`, `ui`, `core`, `data`, `stores`, `services`, `i18n`, `theme`, `config`, ... |
| the fixed scopes, for work outside `src/` | `repo`, `deps`, `docs`, `ci`, `tooling`, `e2e`, `release`, `skills` |
| `contracts/commits.json` `extraScopes` | any name the app adds (`store`, `design`) |

A folder whose name starts with `.`, `(` or `_` gives no scope (route groups such as `(tabs)` are not scopes). `contracts/commits.json` `scopeFolders` replaces the folder list (`"src/features/*"` gives each sub-folder, `"plugins"` gives the folder's own name). Pick the narrowest scope that holds the change: a task-row change is `tasks`, a change to the shared button is `ui`, a lint config change is `repo`.

**A slice keeps one scope.** Files that travel with a behaviour (its test, its golden, its contract entry, its Maestro flow) take the behaviour's scope: a new golden for the task row is `test(tasks): ...`, not a scope named after the file kind. The table below is for a commit that only touches that folder. A name such as `goldens`, `plugins` or `design` is not a scope until `contracts/commits.json` lists it in `extraScopes`.

| Folder or file at the repo root (canonical layout) | Scope when the commit touches only it |
|---|---|
| `src/features/<feature>/` | `<feature>` |
| `src/<layer>/` (`app`, `ui`, `core`, `data`, `stores`, `services`, `api`, `i18n`, `theme`, `config`, `hooks`, ...) | the layer's folder name |
| `test/` (render helpers, shared fixtures, the pixel matcher), `__mocks__/`, `scripts/` | `tooling` |
| `.maestro/` (flows and baselines) | `e2e` |
| `contracts/` | `repo` |
| root configs: `app.config.ts`, `tsconfig*.json`, `eslint.config.mjs`, `babel.config.js`, `jest.config.js`, `lefthook.yml`, `quality-gates.json`, `knip.json`, the Prettier files, `.npmrc`, `.claude/settings.json` | `repo` |
| `package.json` dependencies and the lockfile | `deps` |
| `eas.json`, store metadata, release notes, the release commit | `release` |
| `plugins/` (config plugins) | `repo`, or `plugins` once it is in `extraScopes` |
| `design/` (the design token source) | `theme` |
| `assets/` (images, fonts) | `ui`; the app icon and splash with `app.config.ts`: `repo` |
| `perf-baselines/` | `tooling` |
| `docs/`, `README.md`, other prose | `docs` |
| `.github/`, other CI files | `ci` |
| installed or vendored skills (`skills/`, `.agents/skills/`, `.claude/skills/`) | `skills` |

## The body

- One blank line after the header, then the body.
- **A body line never starts with `#`.** `git commit --cleanup=strip` and the hook drop such a line as a comment, so "#31 was reopened" vanishes from the stored message, and if it is ever stored, `--range` reports it as `comment-line`. Write "Issue #31 was reopened" (a `#31` inside a line is a requirement reference and is kept).
- Say **why** the change was made, not a list of files (git already shows those).
- A `feat` or `fix` always has a body. A `fix` also says what was wrong and how the test proves it now.
- **Requirement references (opt-in).** When `contracts/commits.json` sets `requirementRef` (for example `{ "pattern": "\\bTASK-\\d+\\b" }`), every `feat` or `fix` outside its `exemptScopes` (default: the fixed scopes) names a reference matching the pattern (rule `spec-ref-missing`). Use it when the app keeps numbered requirements or issues (`spec-traceability`); without it, the rule is off.
- Wrap at about 72 characters. The body is where the reviewer, or a later session, finds the reason for a change; write it for them.

## Trailers

Trailers go in the last paragraph, after a blank line, one per line, `Key: value`. Git reads trailers only there (`git interpret-trailers`, `%(trailers)`).

| Trailer | When | Rule |
|---|---|---|
| `Gate-Change: <reason>` | a changed file matches `gatedPaths` in `quality-gates.json` (next section) | required then, and only then (`gate-change-missing`, `gate-change-unneeded`); the reason (at least 10 characters) says why the gate, golden, baseline or fixture had to change; a gate config changes only after the reviewer agreed |
| `Spec-Change: <requirement> <what changed>` | an existing test's expectation changed because the requirement changed | required then; names the requirement (`TASK-40`, `#31`, `spec 4.2`, `issue 31`, or the contract pattern); never for "the test was wrong" (`spec-change-format`) |
| `Co-Authored-By: ...` | the session instructions ask for attribution | keep it in the same final trailer block |

A tolerance raise on a pixel golden carries the word `approved` and the reviewer in its reason (`Gate-Change: failureThreshold 0.001 -> 0.002 approved by <reviewer>: <reason>`); golden-and-snapshot-tests checks that wording.

The reviewer finds every gate change with:

```sh
git log --format='%h %s%n%(trailers:key=Gate-Change)' --grep='^Gate-Change:'
```

So a `Gate-Change:` trailer on a commit that changed no gated file is wrong too: it pollutes that list.

## Gated paths

`quality-gates.json` `gatedPaths` (owned by quality-gates) is the one list. A file matches a pattern on its **whole** repo-relative path (`eslint.config.mjs` is the root file only; `**/tsconfig.json` is any depth). The canonical list covers:

- the gate configs: `quality-gates.json`, `eslint.config.mjs`, the tsconfig set, the Jest and Stryker configs, `babel.config.js`, `knip.json`, `lefthook.yml`, the Prettier files, `.npmrc`, `.claude/settings.json`, and the listed gate scripts (`scripts/quality/check-quality-gates.ts`, `gate-diff.ts`, `gated-paths.ts`, `verify-plan.ts`, `run-verify.ts`, `device-only.ts`, `scripts/hooks/after-edit.ts`; other files in those folders, such as `scripts/hooks/install-git-hooks.ts` or a test beside a gate script, are not gated);
- the repo-owned contracts the gates read (`contracts/architecture.json`, `contracts/dependency-policy.json`, `contracts/goldens.json`, `contracts/knip-ignores.json`, `contracts/seeded-generators.json`);
- the frozen expectations: golden snapshots (`__snapshots__/*.golden.test.ts.snap`, `*.golden.test.ts.snap.ios`, `*.golden.test.ts.snap.android`; ordinary snapshots such as `__snapshots__/task-row.test.tsx.snap` are not gated and need no trailer), the pixel matcher `test/goldens/skia-golden.ts`, image snapshots (`__image_snapshots__/`), golden vectors (`**/*.vectors.json`), database fixtures (`src/data/**/fixtures/**`), Maestro baselines (`.maestro/baselines/**`) and performance baselines (`perf-baselines/**`).

This summary helps you guess; `gatedPaths` decides. When in doubt, run `check-commits.mjs --staged`: it says `gate-change-missing` or `gate-change-unneeded` from the real list.

A skill that adds a gate appends its path in the same commit (for example design-visual-parity's design baselines); "any path in `gatedPaths`" is the rule, never a list remembered from here. Files in an agent folder (`skills/`, `.agents/`, `.claude/`, `.cursor/`, `.codex/`, ...) are knowledge, not gates: they match only a pattern that starts with that folder, so a vendored skill's template `tsconfig.json` needs no trailer while `.claude/settings.json` stays gated. The matcher is quality-gates' `scripts/quality/gated-paths.ts`; the hook imports it and `check-commits.mjs` applies the same rule. Without a `quality-gates.json`, the checker uses the canonical list in `assets/quality-gates.json`.

## Slices: what goes into one commit

- **One behaviour per commit**, its tests and its code together (red and green in the same commit), and any documentation it changes.
- **Never `--no-verify`** and never `LEFTHOOK=0`: a failing hook means the commit is not ready (quality-gates' agent permissions deny `--no-verify`; quality-gates' `check-bypasses` finds the rest).
- **Never amend, rebase or force-push commits that were pushed.** An unpushed commit of this session may be reworded, the one way the hook can judge: `git reset --soft HEAD~1`, fix `reports/commit-message.txt`, `check-commits.mjs --staged`, then `git commit --cleanup=strip -F reports/commit-message.txt`. The reset keeps every change staged, so the hook sees all of the commit's files. `git commit --amend` (and a rebase reword) hides them: the staged diff then compares against the commit being amended, so a correct `Gate-Change:` is reported as `gate-change-unneeded`, a missing one goes unnoticed, and the only message that passes would corrupt the list of gate changes. The hook falls back to HEAD's files when nothing is staged, which covers a plain message-only amend, but an amend that also stages a file still sees only that file.
- **Release commits come only from the release step** (`chore(release): ...`, see `tags-and-releases.md`).
- **Branches**, only when one is needed: `<type>/<scope>-<slug>`, for example `feat/tasks-weekly-repeats`.

## Committing the checked file

Write the message into a git-ignored file (`reports/commit-message.txt`), check it, then commit that exact file:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-commits.mjs . --message reports/commit-message.txt --staged
git commit --cleanup=strip -F reports/commit-message.txt
```

`git commit -F` keeps `#` lines unless `--cleanup=strip` is given (git cleans `-F` messages in `whitespace` mode; only an edited message is stripped by default; verified with git 2.50 on 2026-10-10: `git commit -F` of a file holding `# hint` stores the line). The commit-msg hook drops comment lines before it checks, as git's editor flow does, so it cannot see this; `check-commits.mjs --range` reports a stored `#` line as `comment-line`.

## Good and bad headers

| Header | Verdict |
|---|---|
| `feat(tasks): keep a draft when the app is killed` | good |
| `fix(lists): keep overdue state across time-zone changes` | good |
| `test(core): cover the last day of a leap year` | good |
| `chore(deps): pin react-native-reanimated to the stack version` | good |
| `Updated stuff.` | bad: no type or scope, past tense, vague, trailing period |
| `feat(widgets): add buttons` | bad: `widgets` is not a folder or a fixed scope (use `ui`) |
| `feat: add weekly repeats` | bad: no scope |
| `fix(tasks): Fixed the draft` | bad: capital letter, past tense |
| `feat(tasks): add weekly repeats, shared lists, the stats card and the new settings layout` | bad: over 72 characters and several behaviours |

## The hook and the checker: one rule set

The commit-msg hook (`scripts/git/check-commit-message.ts` over `commit-message-rules.ts`, `commit-trailer-rules.ts` and `commit-config.ts`; quality-gates' `lefthook.yml` runs `node scripts/git/check-commit-message.ts {1}`) and `scripts/check-commits.mjs` apply the same 18 rules with the same ids: `header-format`, `header-type`, `scope-missing`, `header-scope`, `header-length`, `subject-case`, `subject-period`, `subject-mood`, `subject-vague`, `blank-line`, `body-missing`, `spec-ref-missing`, `trailer-placement`, `trailer-empty`, `spec-change-format`, `gate-change-missing`, `gate-change-unneeded` and `placeholder-left`. Both drop comment lines and everything below git's scissors line first. Git-generated headers pass.

The default requirement reference (`#123`, `TASK-12`, `spec 4.2`, `issue 31`) lives once, in `scripts/git/requirement-ref.json`: the hook's `commit-config.ts` reads it, `check-commits.mjs` reads this skill's template copy, and tdd-workflow's history check reads a synced copy, so a `Spec-Change:` the hook accepts passes all three. Change the default only there.

The two cannot drift: `scripts/git/commit-message-samples.json` holds good messages and at least one sample per rule with the exact rule ids it must give. The hook's Jest test (`commit-message-rules.test.ts`) runs every sample through the TypeScript rules, and this skill's self-test runs the same list through `check-commits.mjs --samples`. A new rule is added to both rule sets and to the sample list in one change.

What each knows about the files differs: the hook always has the commit's files (the staged files; HEAD's files when nothing is staged, which is an amend), so it always applies the `Gate-Change:` rules; the checker applies them when it knows the files (`--staged`, `--files`, `--range`, `--log`), not for a bare `--message`. The checker also has two rules of its own: `comment-line` (history only, see above) and `sample-mismatch` (`--samples`).

## When multi-package

With npm workspaces (`package.json` `workspaces`, for example `["apps/*", "packages/*"]`), each workspace folder name is a scope (`mobile`, `core`) next to `src/features/*`, `src/*` and the fixed scopes; set `scopeFolders` in `contracts/commits.json` to drop the root `src/` folders. quality-gates adds `apps/*/tsconfig*.json` and `packages/*/tsconfig*.json` to `gatedPaths`. Tags carry the app folder (`tags-and-releases.md`).
