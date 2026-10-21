# check-rules-tests.mjs

What the checker reads, every rule with its reason, its outcomes and the limits of a text-based
check. Read this when a rule fails and the fix line is not enough, or before changing the contract.

## Contents

- Running it
- The contract
- What it reads
- The rules
- Outcomes
- Limits

## Running it

```sh
node <this skill>/scripts/check-rules-tests.mjs .                 # repo root, positional
node <this skill>/scripts/check-rules-tests.mjs . --contract qa/firebase-rules.json
node <this skill>/scripts/check-rules-tests.mjs . --json
```

It is static and fast (no emulator, no network), so it runs in the pre-push gate beside the emulator
run. It does not replace `npm run test:rules`: it proves that every block *has* tests of both kinds;
the emulator run proves they pass.

## The contract

`contracts/firebase-rules.json` (the folder is `contractsDir` from `rn-skills.config.json`, default
`contracts`; `--contract` overrides the whole path). Template and schema: `templates/contracts/`.

| Key | Value | Meaning |
|---|---|---|
| `firestoreRules` | repo-relative path or `null` | the Firestore rules file firebase.json deploys; `null` when the app has no Firestore |
| `storageRules` | repo-relative path or `null` | the Storage rules file; `null` when the app has no Storage |
| `testsDir` | repo-relative folder | where the `*.rules.test.ts` files live (default `test/rules`) |

At least one rules file is named, and each named file exists; otherwise the run stops with exit 2.
The checker never guesses a path: an app that keeps its rules in `firebase/` says so here.

## What it reads

- The rules files the contract names: match blocks (paths joined through nesting), the `allow`
  statements directly inside each block and their conditions, and whether each block's body holds
  any declaration (a function, a match or an allow); comments are ignored, function bodies are
  skipped.
- Every file under `testsDir` (through the repo walk, which skips installed and vendored skills):
  `describe` titles and the `assertSucceeds` / `assertFails` calls inside each describe, from the
  `*.rules.test.*` files; `projectId` values and the consts they name, from all of them.
- `package.json` at the root and in every workspace: scripts that run `firebase emulators:exec` or
  `emulators:start`.

## The rules

| Rule | Fails when | Why |
|---|---|---|
| `open-rule` | an `allow` has no condition (`allow read;`), its condition is `true` (alone or as one side of `\|\|`), or it is the console's test-mode rule `request.time < timestamp.date(...)` | each opens the data to anyone on the internet who has the app's public config; the test-mode rule is open until a date that someone always extends |
| `wildcard-write` | a `write`, `create`, `update` or `delete` is allowed (condition not `false`) in a block whose path, or an enclosing block's, holds a recursive wildcard (`{document=**}`, `{allPaths=**}`) | Firestore allows a request when any matching block allows it, so the wildcard's write bypasses every allow-list and type check below it, for collections that do not exist yet too |
| `untested-match` | a block with at least one `allow` has no running describe titled with its path; or its describe never calls `assertSucceeds` while the block grants anything | an allow nobody proved is either broken (the app's real write is denied in production) or wider than meant; a block with only `if false` allows needs no success test |
| `missing-deny-test` | the block's describe never calls `assertFails` | the failure that matters is the request that should be denied and is not; every block proves at least one denial |
| `empty-match` | a match block's body holds no declaration: no function, no nested match, no allow (`match /databases/{database}/documents { }`, or a block whose allows were all commented out) | the rules compiler refuses the whole file: the Firestore emulator answers `Error compiling rules: L4:3 The 'match' body must contain at least one declaration.` and the Storage emulator logs the same, so every test fails as a denial and a deploy is rejected. A deny-all file keeps the shared helpers in the service's top match (verified 2026-10-22, Firestore emulator 1.22.0 and Storage rules runtime 1.1.3, firebase-tools 15.33.0; re-verify: load a rules file with an empty documents match through `initializeTestEnvironment` inside `firebase emulators:exec --only firestore,storage --project demo-<app>`) |
| `real-project-id` | a package.json script starts the emulators with no `--project` (they then run as the `.firebaserc` project, a real one), or with a project that is not `demo-...`; a `projectId` in the tests folder that is not a `demo-` literal, or that comes from the environment or a name the tests folder does not define | a real project id lets the emulators and the SDK reach production services, and a test run must never be able to touch real data |

A describe names a block when its title holds the block's path whole, as the rules file writes it
below `/databases/{database}/documents` or `/b/{bucket}/o`: `users/{uid}/tasks/{taskId}` is named by
`'users/{uid}/tasks/{taskId}'` and by `'users/{uid}/tasks/{taskId} (offline batch)'`, never by
`'users/{uid}/tasks/{taskId}/comments/{id}'`. Several describes may name one block; their assertions
add up. `describe.skip`, `xdescribe`, `describe.each` and assertions inside `it.skip`, `xit` and
`it.todo` do not count.

## Outcomes

- `check-rules-tests: N match blocks checked, 0 problems` then `RESULT: PASS`: N counts the blocks
  that hold an allow.
- `NOTE firestore.rules grants no access (deny-all): ...`: a rules file with no allow at all, the
  starting state of rule 1. Nothing is granted, so no block needs a test yet; the file is still read
  for `empty-match`. When every named file is deny-all the summary is
  `check-rules-tests: N deny-all rules files checked, 0 problems` and the run passes; the first allow
  turns its block's test rules on.
- `NOT APPLICABLE: no firebase.json, no contracts/firebase-rules.json and firebase-tools is not in
  package.json`: the repo does not use Firebase rules; exit 0.
- `ERROR [bad-input] contracts/firebase-rules.json is missing`: the repo has firebase.json or
  firebase-tools but no contract; copy the template. Also exit 2: the contract is not JSON, names a
  rules file that does not exist, names none, or has no `testsDir`.
- The checker prints no SKIP lines.

## Limits

It reads text, not a parsed program, so some shapes are review items:

- An assertion inside a helper (`expectDenied(...)` that wraps `assertFails`) is not counted; call
  `assertSucceeds` and `assertFails` directly in the tests.
- It proves a describe has at least one success and one denial, not one per `allow` method: review
  the table "What every block's describe proves" in the emulator-tests reference.
- A condition that is always true in a less obvious way (`request.auth == null || request.auth != null`,
  a helper function that returns `true`) is not recognised as `open-rule`; the denial tests catch it
  only when they test the right request.
- A `projectId` built by a function call or imported from outside the tests folder is reported as
  not a demo- literal; keep it a literal const there.
