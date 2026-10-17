# Product spec

This folder says what the app must do. Every entry has a stable ID, so a test title, a code comment, a
commit body, a report or a question can cite it exactly instead of retelling it from memory. The spec
decides _what_ is built; the code and its tests decide _how_.

## Files

| File                                     | Holds                                                            | IDs    |
| ---------------------------------------- | ---------------------------------------------------------------- | ------ |
| [non-negotiables.md](non-negotiables.md) | The few rules no task, design or library may break               | `NN-`  |
| [screens.md](screens.md)                 | Every screen: what it shows, what it does, its states, route     | `SCR-` |
| [requirements.md](requirements.md)       | Behaviours, each testable on its own                             | `REQ-` |
| [decisions.md](decisions.md)             | Open and settled product decisions, each open one with a default | `DEC-` |
| [out-of-scope.md](out-of-scope.md)       | What this version does not build, even when it looks helpful     | `OOS-` |

The ID scheme lives in `contracts/spec.json`.

## How an entry looks

```markdown
### REQ-1 · Add a task

- Status: planned
- Platforms: ios, android

The text of the requirement, with exact numbers.

- Acceptance: one observable outcome per line.
```

- The heading is `<ID> · <title>`. The ID is a prefix and a number; a child adds a dot (`REQ-4.1`
  belongs to `REQ-4`).
- `Status:` is one of `planned`, `in-progress`, `built`, `dropped`, `out-of-scope`, `open`, `decided`.
  A requirement or screen marked `built` must be cited by at least one test or end-to-end flow.
- `Platforms:` appears only when the entry applies to some platforms (`ios`, `android`, `web`).
- An entry's text runs to the next heading of the same or a higher level.

## Changing the spec

- A new entry takes the next free number. An ID is never renamed or reused: an entry that is no longer
  wanted stays, marked `Status: dropped`, so old commits and tests still resolve.
- A change to what an existing entry requires is a product decision. The commit that changes a test
  expectation because of it carries a `Spec-Change:` trailer naming the entry.
- Run `check-spec-refs.mjs` after every change to this folder.
