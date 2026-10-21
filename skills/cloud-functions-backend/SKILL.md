---
name: cloud-functions-backend
description: Builds 2nd-gen Cloud Functions - App Check callables, auth, bound secrets, limits, quotas, a budget kill switch. Use when adding a callable, trigger, server secret or paid API call. Not for security rules (firestore-rules-and-emulator-tests).
---

# Cloud functions backend

The app's server code runs as 2nd-gen Cloud Functions for Firebase in TypeScript, in a `functions/` package that deploys as one esbuild bundle. Every client call goes through one `defineCallable()` wrapper that enforces App Check, requires a signed-in user, parses its input with valibot before any work and maps typed failures to `HttpsError` codes once; every function has a region and hard limits; money is spent only behind a kill switch, a server-side quota that counts real work, and bound secrets. `check-functions.mjs` proves the checkable part; the templates' tests prove the rest.

## Rules that must hold

1. **2nd-gen `onCall` is the only client entry point.** Callables carry the Firebase ID token and the App Check token and decode errors on the client; `onRequest` is for server-to-server webhooks only, and 1st-gen APIs (`firebase-functions/v1`, `runWith`, `functions.config()`, removed in firebase-functions 7) are not used at all.
2. **Every callable sets `enforceAppCheck: true`, and every cost-bearing callable also sets `consumeAppCheckToken: true`.** Without App Check any script can call the function with a stolen ID token; without replay protection one token can be replayed in a loop against a paid provider. A consumed token is not rejected by the SDK, so the wrapper rejects `request.app.alreadyConsumed`.
3. **`request.auth` is required, anonymous users included.** Every per-user quota, claim and cache is keyed by `request.auth.uid`, never by a uid from the payload, so a caller can only spend their own allowance.
4. **Input is parsed with the shared valibot schema before any work.** The envelope `{ apiVersion, requestId, payload }` and then the payload; a callable that reads `request.data` first trusts whatever an old build or an attacker sends.
5. **Typed failure kinds are mapped once to `HttpsError` codes.** One exhaustive `switch` with a test per kind; the client reads `details.kind`, never the message, so a new kind is a compile error until both sides handle it.
6. **Secrets come only from `defineSecret`, bound on each function that reads them, and never from `process.env`.** A binding is what puts the value into that function alone; an unbound `.value()` is an empty string at runtime and a `process.env` read hides the binding from review.
7. **Every function sets `region`, `maxInstances`, `timeoutSeconds` and `memory`,** through `setGlobalOptions` imported first by `index.ts` and per-function overrides. Without `maxInstances` a 2nd-gen HTTP function scales to 100 instances by default, and cost scales with it.
8. **Quotas are counted in server transactions, on real work only.** Reserve in a transaction right before the paid call, after the cache and the kill switch, and release on provider failure; parallel calls then cannot both take the last unit, and users never lose quota to a cache hit or an outage.
9. **Idempotency and dedupe use create-if-absent claims.** `docRef.create()` fails when the doc exists, so a retried request id, a duplicated Pub/Sub message or a second caller of shared work runs it once.
10. **A kill-switch flag is read before every paid provider call, and it fails closed.** The budget alert handler turns it off; a missing or unreadable flag means paused, so a misconfigured project spends nothing.
11. **Logs are structured and carry no PII or user text.** One line per call (function, hashed uid, outcome kind, duration); payloads, prompts, provider output and raw uids stay out of Cloud Logging, which more people read than the database.
12. **Deploys are a developer step, from a tested bundle.** `firebase deploy` spends money and changes production; agents prepare the bundle and the checks, the developer runs the deploy and sets secrets, IAM, budgets and flags.

## Workflow

1. **Read the contract** in [references/callable-contract.md](references/callable-contract.md): the envelope, the order of checks, the error mapping table, App Check and replay protection, the log line.
2. **Create or align `functions/`** from the templates (line 1 of each names its repo path): `templates/functions/package.json`, `templates/functions/tsconfig.json`, `src/index.ts` (exports only), `src/config/global-options.ts` (fill `__FUNCTIONS_REGION__` with the decided region), `src/config/secrets.ts`, `src/lib/admin.ts`, `src/lib/callable-failure.ts`, `src/lib/define-callable.ts` and their tests. Install the pins with `npm install --save-exact` inside `functions/`; versions, the bundle and `firebase.json` are in [references/versions-and-deploy.md](references/versions-and-deploy.md). Merge the `functions` key into `firebase.json`, never overwrite it.
3. **Write the test first** for a new callable, on the shape of `src/tasks/summarize-list.test.ts`: fakes for every dependency, a call log, one test per failure kind it can return (`tdd-workflow`).
4. **Write the callable** with `defineCallable({ name, input, handler, ... })` on the shape of `src/tasks/summarize-list.ts`, as a factory that takes its dependencies, wired in `index.ts`. A cost-bearing callable adds `consumeAppCheckToken: true`, binds only its own secret and follows the order cache, kill switch, quota reserve, paid call, release on failure: [references/quotas-claims-and-kill-switch.md](references/quotas-claims-and-kill-switch.md), which also has `claimOnce()`, the kill switch (`src/lib/paid-calls-flag.ts`), the quota (`src/lib/daily-quota.ts`) and the budget Pub/Sub handler.
5. **Declare secrets and config** per [references/secrets-and-config.md](references/secrets-and-config.md): `defineSecret` in `config/secrets.ts`, bound per function, dummy values in the git-ignored `functions/.secret.local` for the emulator. Ask the developer to set real values (`firebase functions:secrets:set <NAME> --project <alias>`); never read or print them.
6. **Run the package's gates:** `npm run typecheck`, `npm test` and `npm run build` in `functions/`. Add emulator integration tests for the four callable paths and for quotas and claims under concurrency: [references/testing-functions.md](references/testing-functions.md).
7. **Check:** `node ${CLAUDE_SKILL_DIR}/scripts/check-functions.mjs .` from the repo root. Each `FAIL` line names the file, the rule and the fix; [references/checker-rules.md](references/checker-rules.md) explains every rule, how the folder is found and what the scan cannot see. Fix and rerun until it prints `RESULT: PASS`.
8. **Hand the deploy to the developer** with the list of human steps: secrets per project, the `ops/flags` doc, the App Check Token Verifier role when a callable consumes tokens, the budget and its topic. Stop and ask before any of them.
9. **Report** the functions added, the failure kinds, the bound secrets, the `RESULT` line and the human steps still open.

## Definition of done

- [ ] Every client-facing function is made with `defineCallable` (or an `onCall` with `enforceAppCheck: true`, an auth check and a parse before work); every cost-bearing one consumes the App Check token, binds only its own secrets and reads the kill switch before the paid call.
- [ ] `CallableFailure` has one `HttpsError` code per kind in an exhaustive `switch`, with a test per kind; the client's adapter handles the same kinds.
- [ ] Quotas are reserved in a transaction after the cache and the kill switch and released on provider failure; once-only work is claimed with `create()`.
- [ ] `setGlobalOptions` sets `region`, `maxInstances`, `timeoutSeconds` and `memory`, and is imported first by `index.ts`.
- [ ] No secret in source, tests or committed env files; `functions/lib/`, `*.local` and `.secret.local` are git-ignored.
- [ ] In `functions/`: `npm run typecheck`, `npm test` and `npm run build` pass; emulator tests cover no App Check, no auth, bad input and success.
- [ ] The developer has the list of human steps (secrets, flags doc, IAM role, budget); nothing was deployed by an agent.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-functions.mjs .` prints `RESULT: PASS` (it prints no SKIP lines; a `note: functions folder ...` line only says where the folder came from).

## Anti-patterns

- **`export const x = onCall(async (request) => ...)` with no options.** App Check is off, the auth check is up to memory and the limits are the platform's; make it with `defineCallable`.
- **Trusting `enforceAppCheck` alone on a paid call.** A valid token can be replayed until it expires; set `consumeAppCheckToken: true` and have the client request limited-use tokens.
- **`request.data.listId as string`.** A cast is not a check; old builds and scripts send anything. Parse, then use the parsed output.
- **`throw new HttpsError('internal', error.message)`.** The message can carry user text or provider output to the client and the logs; return a typed kind and log the error's name.
- **`process.env.SUMMARY_API_KEY`, or a key in `.env`.** The binding disappears from review and a committed key is leaked for good; use a bound `defineSecret`.
- **Counting quota before the cache lookup, or never releasing it.** Users then pay for cache hits and outages; reserve right before the paid call and release on failure.
- **`set()` for once-only work.** Two retries both write and both pay; claim with `create()`.
- **Disabling billing from the budget handler.** It stops Firestore and Auth for every user and can delete resources; pause paid calls with the flag.
- **`setGlobalOptions` in `index.ts` after the imports.** A module that creates its function at import time is built before the options run and ships with no region and default limits.
- **`--packages=external` in the esbuild command of a multi-package repo.** The shared package stays an import and `firebase deploy` cannot install it; list the externals.
- **`npm install firebase-functions-test --legacy-peer-deps`.** Its peer range ends at firebase-admin 13; a forced install hides a real incompatibility. Test callables with `run()` and fakes.

## When multi-package

In an npm workspaces repo (`apps/*`, `packages/*`), the request and response schemas live once in a shared package (`packages/shared`, imported as `@<org>/shared`) that both the app and `functions/` import as TypeScript source. The layout is the one architecture-and-boundaries and expo-project-bootstrap check (their "When multi-package"):

- `functions/` sits at the repo root and is its own workspace, listed by its folder: `"workspaces": ["apps/*", "packages/*", "functions"]`. `contracts/architecture.json` records it as a Node backend, `{ "name": "functions", "dir": "functions", "world": "node" }`, so no app or package may import it and it is never read as an app (no `@/*` alias, no app `src/` zones asked of it).
- Its `package.json` is the template's with the workspace's name in the one scope (`"name": "@<org>/functions"`, `"private": true`): `"type": "module"`, `"main": "lib/index.js"`, `"engines": { "node": ... }`, no `exports` map (nothing imports it), and the root-run scripts every workspace keeps (`"typecheck": "tsc --noEmit -p tsconfig.json"`); it lists `@<org>/shared` in `devDependencies` (`"*"` or the workspace version), because the bundle inlines it.
- Its `tsconfig.json` becomes a workspace program: it extends the root `tsconfig.base.json` and sets only `types` (`["node"]`, plus `"jest"` when the root Jest config runs its tests), because the root checks allow a workspace program nothing else; `quality-gates.json` `typescript.projects` lists it (`functions/tsconfig.json`). Checked with an empty entry file in a workspace app on 2026-10-21; the full templates were not type-checked against the root base (re-check: `npm run -s typecheck` after copying them).
- The esbuild command bundles everything except `firebase-functions` and `firebase-admin` (`--external:` for each, never `--packages=external`), so `lib/index.js` contains the shared schemas and `firebase deploy` never has to resolve a workspace link: the Cloud Build step runs `npm install` on `functions/package.json` alone, where a workspace dependency does not exist.
- `functions/package.json` `dependencies` hold only the externals; check it by grepping the bundle's imports (`grep -o 'from "[^"]*"' lib/index.js | sort -u`).
- The build writes the bundle into the workspace's own `functions/lib/index.js` (`"main"`), never into a root `build/` folder: `firebase deploy` uploads the `functions[].source` folder and loads what its `"main"` names, so a bundle written elsewhere leaves a missing or stale `lib/` to deploy. A root script runs the workspace's build unchanged (`"build:functions": "npm run -s build -w functions"`). The root ignore lists name exactly that folder: `'functions/lib/**'` in ESLint's `globalIgnores`, `functions/lib/` in `.prettierignore` and `/functions/lib/` in `.gitignore` (typescript-and-lint-rules' `check-configs.mjs` requires all three and accepts only that folder of a workspace), so `eslint .`, `format:check` and knip stay green after a real deploy build.
- `knip.json` gives the workspace `"functions": { "entry": ["src/index.ts", "src/**/*.test.ts"], "project": ["src/**/*.ts"] }` without `includeEntryExports`: the entry exports every deployed function and nothing in the repo imports them, so its exports count as used while dead exports below it are still reported.
- Its tests run in the root Jest config's Node project (`displayName: 'functions'`, `testEnvironment: 'node'`; unit-and-component-tests, When multi-package), not inside the React Native `unit` project, so they use Jest's `describe`/`it`/`expect` and the program lists `"jest"` beside `"node"`.
- `firebase.json` `functions[].source` stays `functions`; the checker reads it, and `rn-skills.config.json` `"functionsDir"` overrides it.
- The shared package must not import React Native, Expo or anything with platform code, so it type-checks and bundles for Node.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/callable-contract.md](references/callable-contract.md) | The envelope, the order of checks, the error mapping table, App Check and replay protection, auth, logs, changing the contract | Workflow step 1 |
| [references/quotas-claims-and-kill-switch.md](references/quotas-claims-and-kill-switch.md) | Quota transactions, counting real work only, `claimOnce()`, the kill switch, the budget Pub/Sub message and handler, instance limits as a spend ceiling | Workflow step 4 |
| [references/secrets-and-config.md](references/secrets-and-config.md) | `defineSecret` binding, why never `process.env`, params and `.env` files, the emulator's `.secret.local`, human steps, leak response | Workflow step 5 |
| [references/testing-functions.md](references/testing-functions.md) | Unit tests with `run()` and fakes, firebase-functions-test and its peer conflict, emulator integration tests and token handling | Workflow steps 3 and 6 |
| [references/versions-and-deploy.md](references/versions-and-deploy.md) | Dated versions and import paths, the Node runtime, the package, the global options trap, the bundle, `firebase.json`, deploy steps | Workflow step 2 and before any upgrade |
| [references/checker-rules.md](references/checker-rules.md) | Every checker rule, how the functions folder is found, config keys, what the scan cannot see | Workflow step 7, when a check fails |
| `templates/functions/package.json` | The functions package: ESM, Node 24 engine, build, typecheck and test scripts, exact pins | Workflow step 2 |
| `templates/functions/tsconfig.json` | Strict type-check-only config for Node type stripping and esbuild | Workflow step 2 |
| `templates/functions/src/index.ts` | Exports only; imports the global options first and wires real dependencies | Workflow steps 2 and 4 |
| `templates/functions/src/config/global-options.ts` | `setGlobalOptions` with region, `maxInstances`, `timeoutSeconds`, `memory` | Workflow step 2 |
| `templates/functions/src/config/secrets.ts` | The `defineSecret` declarations | Workflow step 5 |
| `templates/functions/src/lib/admin.ts` | Lazy Admin SDK initialisation | Workflow step 2 |
| `templates/functions/src/lib/callable-failure.ts` | The failure kinds and the one mapping to `HttpsError` codes | Workflow step 2; a new failure kind |
| `templates/functions/src/lib/define-callable.ts` | The callable wrapper: App Check, replay, auth, envelope and payload parsing, mapping, log line | Workflow step 2 |
| `templates/functions/src/lib/define-callable.test.ts` | Wrapper tests: every rejection path, no message leak, one test per failure kind | Workflow steps 2 and 6 |
| `templates/functions/src/lib/daily-quota.ts` | Per-user daily quota in a Firestore transaction, with release | Workflow step 4 |
| `templates/functions/src/lib/daily-quota.test.ts` | Tests of the UTC day key and reset time | With the quota |
| `templates/functions/src/lib/paid-calls-flag.ts` | The fail-closed kill switch with a short cache | Workflow step 4 |
| `templates/functions/src/tasks/summarize-list.ts` | A cost-bearing callable: cache, kill switch, quota, paid call, release | Workflow step 4 (the shape to copy) |
| `templates/functions/src/tasks/summarize-list.test.ts` | Its tests with fakes and a call log | Workflow step 3 (the shape to copy) |
| `templates/functions/src/tasks/summary-cache.ts` | Summary cache per list and content fingerprint | Workflow step 4 |
| `templates/functions/src/tasks/summary-provider.ts` | The paid provider behind a port; fill `__SUMMARY_API_URL__` | Workflow step 4 |
| `scripts/check-functions.mjs` | The checker: App Check, auth, parsed input, secrets, literal keys, limits, 1st-gen API | Workflow step 7 and the definition of done |
| `scripts/selftest.mjs` | Proves the checker against the templates and planted bugs | After changing the checker, a template or a fixture |
| `scripts/check-lib.mjs` | Shared checker library (synced; do not edit here) | Never by hand |
| `scripts/lib/source-scan.mjs` | Source masking and bracket matching (synced; do not edit here) | Only when changing the checker |
| `scripts/lib/object-literal.mjs` | Object-literal entry reader (synced; do not edit here) | Only when changing the checker |
| `assets/shared.json` | The shared files this skill syncs in | When adding a shared file |
| `tests/bases/` | Planted decoys under installed and vendored skills that every scan must skip | When adding a fixture |
| `tests/fixtures/` | The overlay cases (`check-functions/CASES.json`): good, a bad case per rule, pass and error cases | When adding a rule |

## Related skills

- `firebase-rnfb` - the app side: `httpsCallable` with limited-use App Check tokens, the client adapter that turns `details.kind` back into a typed failure, the emulator connection.
- `firestore-rules-and-emulator-tests` - rules that keep `ops/`, quota and claim docs server-only, and the emulator setup in `firebase.json`.
- `error-handling-typed-results` - the Result type and typed failures on the client side of the same kinds.
- `subscriptions-revenuecat` - the purchase webhook (`onRequest`) whose entitlement doc a quota reads.
- `app-variants-and-environment` - which project each variant talks to; `EXPO_PUBLIC_*` is public, so paid keys live here, in functions.
- `privacy-and-store-declarations` - the repository-wide secret audit that also covers `functions/`.
- `dependency-management` - exact pins, the release-age policy and the policy rows for `firebase-functions`, `firebase-admin`, `esbuild`.
- `tdd-workflow` - test first, one behaviour per commit, for every callable.
