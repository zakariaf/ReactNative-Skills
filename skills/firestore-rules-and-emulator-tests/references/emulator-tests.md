# Emulator tests for security rules

How the rules are proven: Jest tests that send real client requests to the Firebase emulators with
`@firebase/rules-unit-testing`, one `describe` per match block, an `assertSucceeds` for each allow and
an `assertFails` for each denial. Read this before writing or changing a rules test, and when a test
hangs, cannot connect or passes for the wrong reason.

## Contents

- The pieces
- How a run works
- The test environment helper
- Contexts: who is asking
- Seeding with `withSecurityRulesDisabled`
- `assertSucceeds` and `assertFails`
- What every block's describe proves
- The naming the checker reads
- The Jest `emulator` project
- Keeping the rules tests out of the unit run
- Proving the tests have teeth
- Failures and what they mean
- Dated facts

## The pieces

| Piece | Where | Why |
|---|---|---|
| `firebase-tools` (exact pin, devDependency) | `package.json` | the CLI that downloads and runs the emulators; a global install is a different version on every machine |
| `@firebase/rules-unit-testing` + `firebase` (exact pins, devDependencies) | `package.json` | the test helpers and their peer, the Firebase JS SDK; test tooling only, never imported by app code (the app talks to Firebase through React Native Firebase) |
| `firebase.json` | repo root | which rules file each service deploys and tests; emulator ports |
| `firestore.rules`, `storage.rules` | repo root | the rules (paths in `contracts/firebase-rules.json`) |
| `test/rules/rules-test-env.ts` | tests folder | the demo project id and `createRulesTestEnvironment(service)` |
| `test/rules/*.rules.test.ts` | tests folder | one describe per match block |
| `jest.emulator.config.js` | repo root | the `emulator` Jest project: Node environment, one worker |
| `test:rules` script | `package.json` | `firebase emulators:exec --only firestore,storage --project demo-tasks "jest --config jest.emulator.config.js"` |

## How a run works

`firebase emulators:exec` starts the named emulators, waits until they are ready, exports their
addresses to the child process (`FIREBASE_EMULATOR_HUB`, `FIRESTORE_EMULATOR_HOST`,
`FIREBASE_STORAGE_EMULATOR_HOST`), runs the quoted command, then stops the emulators and exits with
the command's exit code. That is why the tests name no host or port: `initializeTestEnvironment`
finds the emulators through the hub variable. Outside `emulators:exec` it rejects, because no emulator
is reachable; that is the expected failure of `npx jest --config jest.emulator.config.js` alone.

`--only firestore,storage` starts nothing else (no Functions, no Auth): rules tests fake the signed-in
user with a token, so they need neither. `--project demo-tasks` makes the run a demo project: the
emulators never call a production API for it, and nothing it does can reach real data
(`real-project-id` in the checks reference).

## The test environment helper

```ts
export const RULES_TEST_PROJECT_ID = 'demo-tasks';

export function createRulesTestEnvironment(service: RulesService): Promise<RulesTestEnvironment> {
  setLogLevel('error');
  const rules = readFileSync(join(REPO_ROOT, RULES_FILES[service]), 'utf8');
  return initializeTestEnvironment(
    service === 'firestore'
      ? { projectId: RULES_TEST_PROJECT_ID, firestore: { rules } }
      : { projectId: RULES_TEST_PROJECT_ID, storage: { rules } },
  );
}
```

- It loads the rules file from disk into the running emulator, so every run tests the file in the
  working tree, not what was last deployed.
- One service per environment: an environment configured for Storage fails to start when only the
  Firestore emulator runs, so each test file asks for its own.
- `setLogLevel('error')`: every denied request is a warning in the SDK log, and denials are what
  these tests make on purpose.
- The id is a literal const: the checker reads it, and an id from the environment could be anything.

Each file then has the same frame: one top-level describe named after the rules file (the house lint
rule `jest/require-top-level-describe` wants the hooks inside one), holding the hooks and one inner
describe per match block:

```ts
let testEnv: RulesTestEnvironment;

describe('firestore.rules', () => {
  beforeAll(async () => { testEnv = await createRulesTestEnvironment('firestore'); });
  afterEach(async () => { await testEnv.clearFirestore(); });   // clearStorage() for Storage
  afterAll(async () => { await testEnv.cleanup(); });

  describe('users/{uid}/tasks/{taskId}', () => { /* its tests */ });
});
```

`clearFirestore()` deletes the project's data in the emulator after each test, so no test depends on
another's leftovers; `cleanup()` closes every client so Jest exits.

## Contexts: who is asking

```ts
testEnv.authenticatedContext('user-a').firestore();   // signed in as uid user-a
testEnv.unauthenticatedContext().firestore();          // signed out
testEnv.authenticatedContext('user-a', { email_verified: true }).firestore();   // extra token claims
```

The returned instances work with the modular SDK (`doc`, `setDoc`, `getDoc`, `uploadBytes`, ...).
Their declared type is the compat `Firestore`/`Storage`, so type a helper that returns one as
`ReturnType<RulesTestContext['firestore']>` rather than the modular `Firestore` (which does not
compile). Test with at least the owner, another signed-in user and a signed-out client.

## Seeding with `withSecurityRulesDisabled`

```ts
async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}
```

Seed the state a test starts from (an existing task, a server-written entitlement) with the rules
off. Never seed through an authenticated context: the seed then depends on the rule under test, and a
broken create rule fails every update test with a confusing message.

## `assertSucceeds` and `assertFails`

- `assertSucceeds(promise)` resolves when the request is allowed and rethrows any error.
- `assertFails(promise)` resolves when the request is denied by the rules (permission denied) and
  fails the test when it succeeds.
- Always `await` them; an un-awaited assertion passes before the request returns.
- Call them directly in the describe's tests, not through a wrapper helper: the checker counts the
  calls inside each describe.
- The house ESLint rule `jest/expect-expect` counts only the names in its `assertFunctionNames`; the
  canonical config (typescript-and-lint-rules) needs `'assertSucceeds'` and `'assertFails'` there,
  or every rules test fails lint as "Test has no assertions". Never wrap them in a dummy `expect`.

## What every block's describe proves

| Block kind | Succeeds | Fails |
|---|---|---|
| client-writable (lists, tasks) | owner create with the allowed fields; owner update of an allowed field; owner read; owner delete | another user; signed out; a field outside the allow-list; a wrong type; an empty or too-long string; a client-chosen timestamp; changing a set-once field |
| append-only (activity) | owner create; owner read | an unknown `kind`; another user; the owner's update; the owner's delete |
| server-only (entitlements) | owner read of a seeded document | another user's read; the owner's create, update and delete |
| Storage folder | owner upload of an accepted type under the cap; owner read and delete | another user; signed out; a wrong content type; a file at the cap or over |

## The naming the checker reads

Each describe is titled with the block's path exactly as the rules file writes it, below
`/databases/{database}/documents` or `/b/{bucket}/o`:

```ts
describe('users/{uid}/tasks/{taskId}', () => { ... });
describe('users/{uid}/attachments/{fileName}', () => { ... });
```

`describe.skip`, `xdescribe` and `describe.each` do not count, and neither do assertions inside
`it.skip`, `xit` or `it.todo`: a test that never runs proves nothing. A title may say more
(`'users/{uid}/tasks/{taskId} (offline batch)'`) as long as the path stands whole in it.

## The Jest `emulator` project

`jest.emulator.config.js` is a Jest project of its own (`displayName: 'emulator'`), run only by
`npm run test:rules`, the way simulations keep their own config:

- `testEnvironment: 'node'`: the tests use the Firebase JS SDK over the network, no React Native.
- `testMatch: ['<rootDir>/test/rules/**/*.rules.test.ts']`.
- `maxWorkers: 1`: every file shares one emulator project, so one file's `clearFirestore()` would
  otherwise wipe what another file is testing.
- `testTimeout: 20000`: the first request also compiles the rules in the emulator.
- TypeScript is compiled by the app's `babel.config.js` through babel-jest, as in every other project.

## Keeping the rules tests out of the unit run

The canonical `jest.config.js` (owned by unit-and-component-tests) runs every `*.test.ts` under
`test/` in its unit project. Until its ignore list holds `'\\.rules\\.test\\.'` (beside the golden,
sim and android patterns), `npm test` also picks up the rules tests and they fail there for want of an
emulator. Add the pattern there, through that skill, in the same change that adds the first rules
test; this skill never edits that config.

## Proving the tests have teeth

A rules test that passes against a broken rule is worse than none. After writing the tests, break the
rule on purpose once per kind and watch a test fail, then restore it:

| Break | A test must fail |
|---|---|
| `hasOnly([...])` replaced by `hasAll(['title'])` | the "field outside the allow-list" test |
| `request.auth.uid == uid` replaced by `request.auth.uid != null` | every "another user" test |
| `allow write: if isOwner(uid)` added to the entitlement block | "denies every client write" |
| `allow update: if isOwner(uid)` added to the activity block | "the log is append-only" |
| `&& isAcceptedImage()` removed | the wrong-type and oversized-file test |

All five were tried on the templates on 2026-10-21 and each failed a test. The first attempt found a
real gap: the task block had no unknown-field test until then, so dropping its allow-list passed.

## Failures and what they mean

| Symptom | Cause | Fix |
|---|---|---|
| `firebase-tools no longer supports Java version before 21` | the JDK on PATH is older than 21 | point `JAVA_HOME` (and PATH) at a JDK 21 or newer for this command (toolchain-and-ci reference) |
| `initializeTestEnvironment` rejects with no emulator found | Jest was run outside `emulators:exec` | `npm run test:rules` |
| every request is denied, including the owner's | the rules file failed to compile (the emulator log names the line), or the test loaded a different file than firebase.json | read the emulator output above the Jest output; check `RULES_FILES` |
| `PERMISSION_DENIED` warnings flood the output | the SDK logs each denial | `setLogLevel('error')` in the helper |
| a test passes alone and fails in the full run | two files share the project and ran in parallel | `maxWorkers: 1`, `clearFirestore()` in `afterEach` |
| an update test fails with "not found" | the document was never seeded | seed with `withSecurityRulesDisabled` first |
| Jest does not exit | `cleanup()` missing in `afterAll` | add it |

## Dated facts

| Fact | Verified | Re-verify |
|---|---|---|
| `@firebase/rules-unit-testing` 6.0.0 exports `initializeTestEnvironment`, `assertSucceeds`, `assertFails`, `withFunctionTriggersDisabled`; the environment has `authenticatedContext`, `unauthenticatedContext`, `withSecurityRulesDisabled`, `clearFirestore`, `clearStorage`, `clearDatabase`, `cleanup`; config keys `projectId`, `hub`, `firestore`, `storage`, `database` (`rules`, `host`, `port`) | 2026-10-21, read from the package's `dist/src/*.d.ts` | `npm view @firebase/rules-unit-testing version`, then read `node_modules/@firebase/rules-unit-testing/dist/src/public_types/index.d.ts` |
| Contexts return compat instances that the modular `firebase` 13.0.0 functions accept (they compile under strict TypeScript 6.0.3 and run) | 2026-10-21, `tsc --noEmit` and `npm run test:rules` in a scratch app | the same two commands after an upgrade |
| `emulators:exec` exports the hub and emulator hosts to the child; firebase-tools treats a `demo-` project as fake and skips production calls | 2026-10-21, firebase-tools 15.33.0 source (`lib/emulator/env.js`, `constants.js` `FAKE_PROJECT_ID_PREFIX`) | `grep -n FAKE_PROJECT_ID_PREFIX node_modules/firebase-tools/lib/emulator/constants.js` |
| Default ports: Firestore 8080, Storage 9199, hub 4400 | 2026-10-21, firebase-tools 15.33.0 `lib/emulator/constants.js` `DEFAULT_PORTS` | `grep -n -A20 DEFAULT_PORTS node_modules/firebase-tools/lib/emulator/constants.js` |
