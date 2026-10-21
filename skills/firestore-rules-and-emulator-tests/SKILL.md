---
name: firestore-rules-and-emulator-tests
description: Secures the database and Storage with deny-by-default rules - owner checks, field allow-lists, server-only docs, a test per rule. Use when adding a collection or upload path, or on permission denied. Not for app reads or writes (firebase-rnfb).
---

# Firestore rules and emulator tests

Makes the app's Firestore and Cloud Storage security rules closed by default and open exactly where
the app needs it, with every allow and at least one denial per block proven by Jest tests against the
Firebase emulators on a `demo-` project. The rules are the only server-side check between any client
and the data, so a rule is finished only when its tests pass and the checker says every block has
both kinds. Verified on 2026-10-21 with firebase-tools 15.33.0, `@firebase/rules-unit-testing` 6.0.0,
`firebase` 13.0.0, the Firestore emulator 1.22.0 and OpenJDK 26.0.1; the templates' 20 tests passed.

## Rules that must hold

1. **Deny by default: no catch-all match, and a new collection or Storage folder is closed until its
   match block and its tests land in the same change.** A path no block names is denied, so nothing
   opens by accident; a catch-all `{document=**}` block is how whole databases leak.
2. **Every match block with an `allow` has a running `describe` titled with its path, with an
   `assertSucceeds` for each allow and at least one `assertFails`** (another user, a signed-out
   client, each field and type check). An allow nobody proved is either broken in production or wider
   than meant, and the denials are the requests that matter.
3. **No open rule, not even for a day:** no `if true`, no `allow` without a condition, no console
   test-mode rule `request.time < timestamp.date(...)`. Each opens the data to anyone holding the
   app's public config, and the date always gets extended.
4. **Ownership comes from the path, through shared `isSignedIn()` and `isOwner(uid)` helpers**
   (`users/{uid}/...`, `isOwner(uid)`). A field can be forged by the client that writes it, and
   `request.auth != null` alone admits every anonymous account anyone creates.
5. **Client-writable documents use allow-lists and types:** `keys().hasOnly([...])` and `hasAll([...])`
   on create, `diff(resource.data).affectedKeys().hasOnly([...])` on update, `is string`/`is bool`
   and size bounds per field, and timestamps `== request.time` from `serverTimestamp()`. Without them a
   client writes `isPremium: true`, a megabyte of junk or a backdated record into its own document.
6. **Append-only collections allow `create` only,** with no update or delete rule, and the tests
   prove the owner's own update and delete are denied. Missing methods are denied, so a log entry
   stays exactly as written.
7. **Server-only documents (entitlements, quotas, moderation results) have no client write rule at
   all;** the Admin SDK writes them and bypasses rules, and the owner may at most `get` their own. A
   client write rule there lets any client grant itself Premium.
8. **No write, create, update or delete on a recursive wildcard** (`{document=**}`, `{allPaths=**}`).
   Firestore allows a request when any matching block allows it, so the wildcard bypasses every
   allow-list below it, for collections that do not exist yet too.
9. **Tests run only against the emulators, as a `demo-` project:** `firebase emulators:exec --project
   demo-<app>` and a literal `demo-` `projectId` in the tests. A demo project has nothing in
   production to reach; a real id lets a test run touch real services.
10. **Storage rules check the owner folder, the content type and the size** (`contentType.matches(...)`,
    `request.resource.size < cap`). The client declares both, so the rule is what keeps scripts out of
    an image bucket and oversized uploads off the bill.
11. **The toolchain is pinned:** `firebase-tools`, `@firebase/rules-unit-testing` and `firebase` as
    exact devDependencies (never a global CLI), a JDK 21 or newer for the emulators beside the Android <!-- stack-pin-ignore: the Firebase emulators' JDK, not the Android build's -->
    build's JDK 17, and the emulator jars cached in CI on the lockfile. The CLI refuses older JDKs, and
    an unpinned CLI tests against a different emulator on every machine.
12. **The rules and their tests are gated paths, and deploying them is the developer's call.** A rules
    change decides who reads and writes every user's data; it carries a `Gate-Change:` trailer and
    a reviewer, and `firebase deploy` replaces the live rules for everyone at once.

## Workflow

1. **Know what the repo has:** `firebase.json`, the rules files, `contracts/firebase-rules.json`, a
   tests folder, `firebase-tools` in `package.json`. Read
   [references/rules-patterns.md](references/rules-patterns.md) for the pattern each kind of document
   needs (client-writable, append-only, server-only, Storage folder).
2. **Copy the templates** (line 1 names the repo path; the JSON files sit at their path under
   `templates/`), then rename the Tasks example blocks to the app's collections:

   | Template | Goes to |
   |---|---|
   | `templates/firestore.rules`, `templates/storage.rules` | repo root (drop `storage.rules` when the app has no Storage) |
   | `templates/firebase.json` | repo root; merge into an existing one (keep its other services) |
   | `templates/contracts/firebase-rules.json` + `firebase-rules.schema.json` | `contracts/` (`storageRules: null` without Storage) |
   | `templates/test/rules/rules-test-env.ts` | `test/rules/` (set `RULES_TEST_PROJECT_ID` to `demo-<app>`) |
   | `templates/test/rules/firestore.rules.test.ts`, `storage.rules.test.ts` | `test/rules/` |
   | `templates/jest.emulator.config.js` | repo root |

   Install the pinned tooling and add the `test:rules` script exactly as
   [references/toolchain-and-ci.md](references/toolchain-and-ci.md) shows; add each package's
   dependency-policy row (`where: dev`) through dependency-management; when the app keeps the JS SDK out
   of its code (React Native Firebase), its `doNotAdd` entry is scoped (`"where": "app"`, `"allowIn":
   ["test/rules/**"]`), as the toolchain reference shows.
3. **Test first, per block:** write the `describe('<match path>', ...)` with its `assertSucceeds` and
   `assertFails` before the block exists; deny-by-default makes the success tests fail (red). Then
   write the block (green). Read [references/emulator-tests.md](references/emulator-tests.md) for the
   helper, contexts, seeding with `withSecurityRulesDisabled`, and the table of what each kind of
   block proves.
4. **Run the emulator tests** with a JDK 21 or newer for this command only: <!-- stack-pin-ignore: the Firebase emulators' JDK -->
   `JAVA_HOME=<a JDK 21+ home> npm run test:rules` until every test passes. The first run downloads <!-- stack-pin-ignore: the Firebase emulators' JDK -->
   the emulator jars into `~/.cache/firebase/emulators`.
5. **Prove the tests have teeth:** break each new rule once (drop the allow-list, loosen the owner
   check, add a write to a server-only block), rerun, see a test fail, restore it. A test that passes
   against a broken rule proves nothing (emulator-tests reference, "Proving the tests have teeth").
6. **Wire the gate through the owning skills** (toolchain-and-ci reference, "Reaching the gate and
   CI"): `test:rules` in quality-gates' `verifyExtraSteps`; the rules, `firebase.json`, the contract,
   the Jest config and `test/rules/**` in `gatedPaths`; `'\\.rules\\.test\\.'` in the unit project's
   ignore list of `jest.config.js` (unit-and-component-tests); `assertSucceeds` and `assertFails` in
   `jest/expect-expect`'s `assertFunctionNames` (typescript-and-lint-rules); the JDK 21 step and the <!-- stack-pin-ignore: the Firebase emulators' JDK -->
   jar cache in the CI verify job (ci-pipeline-and-gates).
7. **Run the checker:** `node ${CLAUDE_SKILL_DIR}/scripts/check-rules-tests.mjs .` (repo root,
   positional). Fix every `FAIL` line ([references/checks.md](references/checks.md) explains each
   rule and the contract) and rerun until it prints `RESULT: PASS`.
8. **Stop and ask before deploying.** `firebase deploy --only firestore:rules,storage --project <real
   project>` is the developer's step, after the tests pass on the merged change; the agent never runs
   it.

## Definition of done

- [ ] Every match block with an allow has a describe titled with its path; each allow has an
      `assertSucceeds`, each block at least one `assertFails` (another user, signed out, each field
      check); append-only and server-only blocks prove the owner's own forbidden writes fail.
- [ ] No catch-all block, no open rule, no write on a recursive wildcard; client-writable blocks use
      `hasOnly`/`hasAll`/`affectedKeys`, type checks and `request.time`; Storage checks owner, type
      and size.
- [ ] `npm run test:rules` passes with `--project demo-<app>`, and breaking a rule makes a test fail.
- [ ] The tooling is pinned exactly, with dependency-policy rows; the gate, gated paths, unit-project
      ignore and CI steps are in place, or listed in the report for their owner skills.
- [ ] Deploying is left to the developer and named in the report.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-rules-tests.mjs .` prints `RESULT: PASS`

The checker prints no SKIP lines. `NOT APPLICABLE` means the repo has no `firebase.json`, no contract
and no `firebase-tools` dependency, so the skill is not applied yet.

## Anti-patterns

- **"Start in test mode, lock it down later."** The date-limited open rule ships, and the date is
  extended when it expires. Start from the deny-by-default template.
- **`match /users/{uid}/{document=**} { allow read, write: if isOwner(uid); }`.** One line that
  skips every field check, for every collection added later. One block per collection.
- **`allow write: if isOwner(uid)` on the entitlement "so the app can set it after a purchase".** Any
  client then grants itself Premium; the server writes it with the Admin SDK.
- **Seeding test data through an authenticated context.** The seed then depends on the rule under
  test; seed with `withSecurityRulesDisabled`.
- **Only happy-path tests.** Every rule passes a test of the owner doing the right thing; the bugs
  are in the requests that should fail.
- **`firebase emulators:exec "jest"` with no `--project`.** It runs as the `.firebaserc` project, a
  real one; always `--project demo-<app>`.
- **`npm i -g firebase-tools`, or switching the machine's default JDK to 21.** Pin the CLI in <!-- stack-pin-ignore: the Firebase emulators' JDK -->
  `package.json`; set `JAVA_HOME` for the rules command only, so the Android build keeps its JDK 17.
- **Importing `firebase` (the JS SDK) in app code because the tests have it.** It is test tooling
  here; the app talks to Firebase through React Native Firebase (firebase-rnfb).

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/rules-patterns.md](references/rules-patterns.md) | Deny by default, `rules_version = '2'`, helpers, allow-lists and types, `request.time`, append-only, server-only, `get`/`list`, recursive wildcards, Storage owner/type/size, limits, deploying, dated facts | Workflow step 1, before writing any block |
| [references/emulator-tests.md](references/emulator-tests.md) | `@firebase/rules-unit-testing` 6: the run, the helper, contexts, seeding, assertions, what each block proves, the describe naming, the Jest `emulator` project, keeping rules tests out of the unit run, mutation proof, failures | Workflow steps 3 to 5 |
| [references/toolchain-and-ci.md](references/toolchain-and-ci.md) | Pins, Node, the JDK beside Android's, the emulator jar cache, the `test:rules` script, the gate, gated paths and CI steps, when multi-package, dated facts | Workflow steps 2, 4 and 6 |
| [references/checks.md](references/checks.md) | The contract, what the checker reads, every rule with its reason, outcomes, limits | Workflow step 7, and when a rule fails |
| `templates/firestore.rules` | Firestore rules skeleton: helpers, lists and tasks (allow-lists, types, `request.time`), an append-only activity log, a server-only entitlement | Workflow step 2 |
| `templates/storage.rules` | Storage rules skeleton: helpers, an owner folder with content type and size checks | Workflow step 2 |
| `templates/firebase.json` | Rules paths and emulator ports (Firestore 8080, Storage 9199), UI off, single project | Workflow step 2 |
| `templates/jest.emulator.config.js` | The Jest `emulator` project: Node environment, `*.rules.test.ts`, one worker | Workflow step 2 |
| `templates/test/rules/rules-test-env.ts` | The demo project id and `createRulesTestEnvironment(service)` | Workflow steps 2 and 3 |
| `templates/test/rules/firestore.rules.test.ts` | One describe per Firestore block, every allow and its denials | Workflow steps 2 and 3 |
| `templates/test/rules/storage.rules.test.ts` | The Storage folder's owner, type and size tests | Workflow steps 2 and 3 |
| `templates/contracts/firebase-rules.json` | The contract: rules file paths (or null) and the tests folder | Workflow step 2 |
| `templates/contracts/firebase-rules.schema.json` | The contract's JSON Schema | When editing the contract |
| `scripts/check-rules-tests.mjs` | The checker: `open-rule`, `wildcard-write`, `untested-match`, `missing-deny-test`, `real-project-id` | Workflow step 7 and the definition of done |
| `scripts/lib/rules-model.mjs` | Reads rules files (blocks, allows, conditions) and test files (describes, assertions) | Read only to change a rule |
| `scripts/selftest.mjs` | Proves the checker passes the templates and catches every planted bug | After changing the checker, a template or a fixture |
| `scripts/check-lib.mjs` | Shared script helper, synced from the library (do not edit here) | Never by hand |
| `assets/shared.json` | Declares the synced files | When adding a shared file |
| `tests/bases/app/` | The minimal app the suite starts from (`package.json` with the pinned tooling and `test:rules`) | When adding a case |
| `tests/fixtures/` | Overlay cases in `CASES.json`: `good/`, a `bad-*` per rule, `pass-*` for comments, no Storage, a moved contract and NOT APPLICABLE, `error-*` for bad input; installed and vendored skills planted to stay silent | When adding a rule |

## Related skills

- `firebase-rnfb` - the app-side Firestore and Storage code whose writes these rules allow.
- `cloud-functions-backend` - the Admin SDK writes behind server-only documents.
- `unit-and-component-tests` - the canonical `jest.config.js` that must leave `*.rules.test.ts` out.
- `typescript-and-lint-rules` - the canonical ESLint config whose `jest/expect-expect` must accept `assertSucceeds` and `assertFails`.
- `quality-gates` - `verifyExtraSteps` and `gatedPaths` for the rules and their tests.
- `ci-pipeline-and-gates` - the JDK step and emulator jar cache in the CI verify job.
- `dependency-management` - the policy rows for the pinned Firebase tooling.
- `tdd-workflow` - red, green, then prove the test catches the broken rule.
