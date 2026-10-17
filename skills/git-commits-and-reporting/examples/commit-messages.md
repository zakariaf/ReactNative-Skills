# Commit messages: good and bad

Each good message passes `scripts/check-commits.mjs` in a Tasks app (features `tasks` and `lists`, the `src/` layers, the fixed scopes); each bad one fails with the rule named. The requirement references (`TASK-12`) are needed only when `contracts/commits.json` sets `requirementRef`; they are good practice either way.

## Good

A feature, with why and what the tests prove:

```text
feat(tasks): keep a draft when the app is killed

TASK-12: an unsaved task title survives a restart. A repository test
reopens the database on real SQL and finds the draft.
```

A fix that says what was wrong:

```text
fix(lists): keep overdue state across time-zone changes

TASK-31: a task due yesterday stayed overdue only in the old time zone.
The due check compared timestamps; it now compares date keys. A
property over shuffled time zones covers it.
```

A golden changed on purpose (golden snapshots are gated paths):

```text
test(tasks): record the task row golden

The row now shows the due date under the title, so a long title no
longer cuts it off.

Gate-Change: new golden for the task row with a due date
```

A requirement change the developer decided, with both trailers in the last paragraph:

```text
test(tasks): expect weekly repeats to skip public holidays

The product decision changed the repeat rule after user feedback.

Spec-Change: TASK-40 weekly repeats now skip public holidays
Co-Authored-By: Claude <noreply@anthropic.com>
```

A refactor (no behaviour change, so no body is required):

```text
refactor(tasks): name the draft storage key
```

A release commit written by the local release lane:

```text
chore(release): build 15

The local lane bumps the shared build number before the archive for
TestFlight and Play internal testing.
```

## Bad

| Message | Rule it breaks | Why it matters |
|---|---|---|
| `Updated stuff.` | header-format | no type or scope, nothing to search for |
| `feature(tasks): keep a draft` | header-type | `feature` is not a type; `feat` is |
| `feat(widgets): add buttons` | header-scope | `widgets` is no folder or fixed scope; use `ui` |
| `feat: add weekly repeats` | scope-missing | the change lives in a folder; name it |
| `fix(tasks): Fixed the draft` | subject-case, subject-mood | imperative, lowercase: "fix the draft" |
| `chore(ui): cleanup` | subject-vague | say what changes |
| `feat(tasks): add weekly repeats` with no body | body-missing | the reviewer cannot see why |
| `feat(tasks): add weekly repeats` with a body naming no `TASK-` id, when the contract sets `requirementRef` | spec-ref-missing | the app asked every feature to name its requirement |
| a commit changing `eslint.config.mjs` without `Gate-Change:` | gate-change-missing | gate changes must be agreed and findable |
| `Gate-Change: tidy` on a commit that changed only `src/ui/button.tsx` | gate-change-unneeded | the trailer pollutes the list of gate changes |
| `Gate-Change: update` | trailer-empty | the reason says nothing (under 10 characters) |
| `Gate-Change:` in the middle of the body | trailer-placement | git reads trailers only in the last paragraph |
| `Spec-Change: the test was wrong` | spec-change-format | names no requirement; a wrong test is fixed, never a Spec-Change |
| `__WHY_THE_CHANGE_WAS_MADE__` left in the body | placeholder-left | the template was not filled in |
| a stored message holding `# Keep Gate-Change only when ...` | comment-line (history) | committed with plain `-F`; use `--cleanup=strip` |
