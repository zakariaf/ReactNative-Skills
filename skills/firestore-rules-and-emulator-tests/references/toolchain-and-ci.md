# Toolchain and CI

The versions the rules tests run on, the JDK the emulators need, where the emulator jars are cached,
and how the run reaches CI. Read this when installing the tooling, when a run fails before the first
test, and when wiring the rules tests into the gate. Every version fact is dated with its re-verify
command.

## Contents

- The pins
- Node
- The JDK: 21 or newer, beside the Android build's 17
- The emulator jars and their cache
- package.json
- Reaching the gate and CI
- When multi-package
- Dated facts

## The pins

Exact versions, installed as devDependencies with `npm install --save-dev --save-exact` (never a
global `npm i -g firebase-tools`, which drifts per machine and is invisible to the lockfile):

| Package | Pin | Note |
|---|---|---|
| `firebase-tools` | `15.33.0` | 15.34.0 is the npm latest on 2026-10-21 but was published 2026-10-14T23:01Z, under the 7-day release age on that date; move to it after 2026-10-21T23:01Z through the dependency policy |
| `@firebase/rules-unit-testing` | `6.0.0` | published 2026-10-07; peer `firebase` `^13.0.0`; engines `node >=24.12.0` |
| `firebase` | `13.0.0` | the peer above, test tooling only. 13.1.0 was published 2026-10-21 (too new). The app itself uses React Native Firebase, so the app's dependency policy allows `firebase` only with `where: dev` and the rules tests as its only importers (below) |

A dependency-policy row per package (dependency-management's `contracts/dependency-policy.json`)
records the version, `where: dev`, why and the verified date.

An app on React Native Firebase keeps the JS SDK out of its own code. The policy says both halves at
once: a `doNotAdd` entry scoped to the app, whose `allowIn` names the rules tests, next to the dev row
that allows the package for them:

```json
"doNotAdd": {
  "firebase": {
    "reason": "the app talks to Firebase through @react-native-firebase/*; the JS SDK is a second client with its own cache",
    "where": "app",
    "allowIn": ["test/rules/**"]
  }
},
"packages": {
  "firebase": { "version": "13.0.0", "spec": "13.0.0", "install": "npm", "where": "dev", "why": "the peer of @firebase/rules-unit-testing; only test/rules/ imports it" },
  "@firebase/rules-unit-testing": { "version": "6.0.0", "spec": "6.0.0", "install": "npm", "where": "dev", "why": "the rules test helpers (initializeTestEnvironment, assertSucceeds, assertFails)" }
}
```

dependency-management's `check-deps-policy.mjs` then fails `firebase` in the app's `dependencies`
(`do-not-add`) and accepts it in the root `devDependencies`; architecture-and-boundaries'
`check-boundaries.mjs` reads the same entry and fails every import of `firebase` outside
`test/rules/**` (`banned-package`), app code and other tests alike. A plain string entry
(`"firebase": "<reason>"`) would fail the dev row's install and the rules tests' imports too. Mirror
the ban in `eslint.config.mjs`: `const FIREBASE_JS_SDK = bannedWithSubpaths('firebase', '<message>')`
in `BANNED_PACKAGE_PATHS` (it bans `firebase` and `firebase/*`, so `firebase/firestore` too), lifted
in one block for the folder the entry's `allowIn` names:

```js
{
  files: ['test/rules/**'],
  rules: { 'no-restricted-imports': restrictedImports({ allow: [FIREBASE_JS_SDK] }) },
},
```

typescript-and-lint-rules' `check-configs.mjs` accepts that glob only because the scoped `doNotAdd`
entry's `allowIn` names it (`[scoped-lift]` otherwise), so a new rules test file needs no change to
the gated config.

## Node

`@firebase/rules-unit-testing` 6 declares `node >=24.12.0`, so under `engine-strict` an install on
Node 22 fails. The house `.nvmrc` pins Node 26, which satisfies it; a CI job that runs the rules tests
takes Node from `.nvmrc` like every other job.

<!-- stack-pin-ignore-start: superstatic's engines field and npm's error quote other Node majors -->
**firebase-tools on Node 26 needs a root override of `superstatic`.** firebase-tools 15.33.0 (and
15.34.0) depends on `superstatic` `^10.0.0`, whose only release, 10.0.0, declares `node: "20 || 22 ||
24"`. Under the house `engine-strict=true` an install on Node 26 therefore stops before anything is
written:

```
npm error code EBADENGINE
npm error notsup Not compatible with your version of node/npm: superstatic@10.0.0
npm error notsup Required: {"node":"20 || 22 || 24"}
```
<!-- stack-pin-ignore-end -->

superstatic 11.0.0 (published 2026-07-08, MIT, no install scripts of its own) declares `"22 || 24 ||
26"`; its diff from 10.0.0 drops `lodash`, `glob-slasher` and `join-path`, and only the Hosting
emulator and `firebase serve` load it, never the Firestore, Storage, Auth or Functions emulators. Pin
it with a root override, in the same commit as firebase-tools:

```json
"overrides": { "superstatic": "11.0.0" }
```

and record it as a companion of the firebase-tools row, so dependency-management's
`check-deps-policy.mjs` accepts the override (`stale-override` fails any other) and moves it with the
row:

```json
"firebase-tools": { "version": "15.33.0", "spec": "15.33.0", "install": "npm", "where": "dev", "why": "the Firebase CLI and emulators for the rules tests", "companions": [
  { "package": "superstatic", "version": "11.0.0", "via": "overrides", "why": "firebase-tools asks for ^10.0.0, whose only release 10.0.0 declares node 20 || 22 || 24 and fails engine-strict on Node 26" }
] }
```

Never answer `EBADENGINE` with `--force`, `--engine-strict=false` or an older Node for the install:
each switches the guard off for every package. Both superstatic versions bring the optional `re2`
(a native install script), which `allowScripts` keeps denied: superstatic falls back to JavaScript
regular expressions without it. Drop the override once a firebase-tools release past the release age
depends on superstatic 11 (re-verify below).

## The JDK: 21 or newer, beside the Android build's 17

firebase-tools 15 refuses to start the emulators on a JDK older than 21: <!-- stack-pin-ignore: the Firebase emulators' JDK, not the Android build's -->

```
Error: firebase-tools no longer supports Java version before 21. Please install a JDK at version 21 or above to get a compatible runtime.
```

(seen on 2026-10-21 with firebase-tools 15.33.0 on JDK 17.0.11; the check is
`MIN_SUPPORTED_JAVA_MAJOR_VERSION = 21` in `lib/emulator/commandUtils.js`). The Android build keeps
JDK 17 (React Native's Gradle plugin), so a machine has both and each command picks its own: <!-- stack-pin-ignore: names both JDKs on purpose -->

- **Locally:** run the rules tests with `JAVA_HOME` set for that command, for example
  `JAVA_HOME="$(/usr/libexec/java_home -v 21+)" npm run test:rules` on macOS when the JDK is registered <!-- stack-pin-ignore: the Firebase emulators' JDK -->
  there, or `JAVA_HOME=<that JDK's home folder>` (any JDK 21 or newer; the templates were proven with OpenJDK 26.0.1 from Homebrew). Never change the machine's <!-- stack-pin-ignore: the JDK used for the proof run -->
  default JDK for it: the Android build then breaks the other way.
- **CI (GitHub Actions `ubuntu-24.04`):** the image ships JDK 8, 11, 17 (default), 21 and 25 and <!-- stack-pin-ignore: the runner image's JDK list -->
  exports `JAVA_HOME_21_X64`; select it for the job that runs the rules tests, no setup action needed: <!-- stack-pin-ignore: the Firebase emulators' JDK -->

  ```yaml
  - name: Use the image's JDK 21 (the Firebase emulators need 21 or newer)
    run: echo "JAVA_HOME=$JAVA_HOME_21_X64" >> "$GITHUB_ENV"
  ```

## The emulator jars and their cache

On first use firebase-tools downloads each emulator (the Firestore emulator jar is about 137 MB, the
Storage rules runtime about 53 MB) into `~/.cache/firebase/emulators`, or into
`$FIREBASE_EMULATORS_PATH` when that variable is set. The jar versions are fixed by the firebase-tools
version (firebase-tools 15.33.0: `cloud-firestore-emulator-v1.22.0.jar`,
`cloud-storage-rules-runtime-v1.1.3.jar`), and the CLI checks each download's checksum. In CI the CLI
prints "You can avoid downloading the ... repeatedly by caching the ... directory".

Cache the folder keyed on the lockfile, which pins firebase-tools and so every jar:

```yaml
- name: Cache the Firebase emulator jars
  uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
  with:
    path: ~/.cache/firebase/emulators
    key: firebase-emulators-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
```

Only in an unprivileged job (no secrets, no protected environment): a cache any branch can write never
sits next to a secret. Never cache `node_modules`.

## package.json

```json
{
  "scripts": {
    "test:rules": "firebase emulators:exec --only firestore,storage --project demo-tasks \"jest --config jest.emulator.config.js\""
  }
}
```

- `--project demo-<app>`: the emulators run as a demo project with nothing in production behind it.
  Without `--project` they run as the `.firebaserc` default, a real project (`real-project-id`).
- `--only`: exactly the services whose rules are tested (`firestore` alone when the app has no Storage).
- The real project id belongs only in deploy commands and `.firebaserc`, which the developer runs.

## Reaching the gate and CI

The rules tests are a gate like lint and unit tests: they run before every push and on every pull
request. The house way to add a gate (quality-gates) is to append the npm script to
`verifyExtraSteps` in `quality-gates.json`, so `npm run verify` runs it locally and in CI unchanged.
Then the CI job that runs `npm run verify` (ci-pipeline-and-gates' `ci.yml`) needs the two steps
above, the JDK 21 selection and the jar cache, before `npm run verify`. Both files belong to those <!-- stack-pin-ignore: the Firebase emulators' JDK -->
skills; make the change through them, never by adding a separate `jest` step to a workflow.

The rules files are gates too: add `firestore.rules`, `storage.rules`, `firebase.json`,
`jest.emulator.config.js`, `contracts/firebase-rules.json` and the tests folder (`test/rules/**`) to
`quality-gates.json` `gatedPaths`, so a change to who may read or write data carries a `Gate-Change:`
trailer and a reviewer.

## When multi-package

Keep `firebase.json`, the rules files and the tests at the repository root: they describe the backend
project, not one app. The `test:rules` script may live in the root `package.json` or in a workspace
(`functions/`, `packages/backend`); check-rules-tests reads the root and every workspace's
`package.json` from `package.json` `workspaces`. Paths in `contracts/firebase-rules.json` stay
repo-relative. The `superstatic` override sits in the **root** `package.json` wherever
firebase-tools is installed: npm workspaces share one lockfile and read `overrides` only from the
root, so moving firebase-tools into `functions/` (even one pinned to an older Node) neither avoids
`EBADENGINE` nor lets a workspace override fix it.

## Dated facts

| Fact | Verified | Re-verify |
|---|---|---|
| firebase-tools latest 15.34.0 (published 2026-10-14T23:01Z), 15.33.0 published 2026-10-08T04:09Z | 2026-10-21 | `npm view firebase-tools version time --json` |
| @firebase/rules-unit-testing latest 6.0.0 (published 2026-10-07T19:23Z), peer `firebase ^13.0.0`, engines `node >=24.12.0` | 2026-10-21 | `npm view @firebase/rules-unit-testing version time peerDependencies engines --json` |
| firebase-tools 15.33.0 and 15.34.0 depend on `superstatic` `^10.0.0`; superstatic 10.0.0 (2025-09-11) declares engines `node: "20 \|\| 22 \|\| 24"`, 11.0.0 (2026-07-08) `"22 \|\| 24 \|\| 26"`, 11.1.0 published 2026-10-14; with `engine-strict` on Node 26.12.0 and npm 11.20.0 the install stops with `EBADENGINE` on superstatic@10.0.0, and with `"overrides": { "superstatic": "11.0.0" }` it resolves | 2026-10-22, `npm view` and `npm install --engine-strict --package-lock-only firebase-tools@15.33.0` in an empty folder, with and without the override | `npm view firebase-tools@<pin> dependencies.superstatic` and `npm view superstatic@<version> engines time --json`, then the same install in an empty folder |
| firebase latest 13.1.0 (published 2026-10-21T15:03Z), 13.0.0 published 2026-10-07T19:36Z | 2026-10-21 | `npm view firebase version time --json` |
| The emulators need JDK 21 or newer: CLI v15.0.0 (2025-12-10) "Removed support for running emulators with Java versions prior to 21"; refused on JDK 17 in a real run | 2026-10-21, Firebase CLI release notes and a run with firebase-tools 15.33.0 | https://firebase.google.com/support/release-notes/cli and `npx firebase emulators:exec --only firestore --project demo-x "true"` on the JDK in question <!-- stack-pin-ignore: the Firebase emulators' JDK --> |
| Emulator cache folder `~/.cache/firebase/emulators`, overridden by `FIREBASE_EMULATORS_PATH` | 2026-10-21, firebase-tools 15.33.0 `lib/emulator/downloadableEmulators.js` `CACHE_DIR` | `grep -n CACHE_DIR node_modules/firebase-tools/lib/emulator/downloadableEmulators.js` |
| Jar versions for firebase-tools 15.33.0: Firestore emulator 1.22.0, Storage rules runtime 1.1.3 | 2026-10-21 | `grep -n -A2 '"version"' node_modules/firebase-tools/lib/emulator/downloadableEmulatorInfo.json` |
| `ubuntu-24.04` image 20261012.334.1: JDK 17 default, `JAVA_HOME_21_X64` present | 2026-10-21, runner-images Ubuntu2404-Readme.md | https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md <!-- stack-pin-ignore: the runner image's JDK list --> |
| `actions/cache` v6.1.0 is commit `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | 2026-10-21 | `git ls-remote https://github.com/actions/cache refs/tags/v6.1.0` |
