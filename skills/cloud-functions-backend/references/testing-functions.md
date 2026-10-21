# Testing functions

Two layers, each proving what the other cannot: fast unit tests that call the callable's handler with fakes, and emulator integration tests that go through the real HTTP layer where App Check and ID tokens are checked.

## Contents

- What each layer proves
- Unit tests with run() and fakes
- firebase-functions-test
- Emulator integration tests
- What to test for every callable
- Commands

## What each layer proves

| Concern | Unit (`callable.run()` + fakes) | Emulator integration |
|---|---|---|
| Wrapper order: auth, replay, parse before work | yes | yes |
| Error mapping (every kind to its code) | yes, one test per kind | spot checks |
| Quota counts only real work, kill switch first | yes, with a call log on the fakes | one path against real Firestore |
| Quota under concurrency (transaction) | no | yes: parallel calls, exactly one takes the last unit |
| Claim-once (`create()` on an existing doc) | no | yes |
| Missing App Check token rejected | no: `run()` skips the HTTP layer | yes |
| Invalid ID token rejected | no | yes |
| Region, limits, bound secrets | read `callable.__endpoint` in a unit test if wanted | the emulator log shows what loaded |
| The esbuild bundle loads (no module-resolution error) | no | yes: the emulator loads `lib/index.js` |

## Unit tests with run() and fakes

A 2nd-gen callable returned by `onCall()` has `run(request)` (`CallableFunction.run` in firebase-functions 7.4.0 `lib/v2/providers/https.d.ts`, verified 2026-10-21). It calls the handler directly: no App Check, no ID token verification, no HTTP. The templates' tests build a `CallableRequest` by hand (`data`, `auth`, `app`, `rawRequest`, `acceptsStreaming`) and assert on the `HttpsError` code and `details`.

- Inject every dependency (flag, quota, cache, provider, clock) through the function's factory (`makeSummarizeList(deps)`); `index.ts` wires the real ones. Fakes record calls in order, so "the cache hit used no quota" is one `assert.deepEqual(log, ['cache-get'])`.
- Tests run on Node's own runner with type stripping: `node --test "src/**/*.test.ts"` (Node 22.18 or newer; imports name the `.ts` file, which the tsconfig allows with `allowImportingTsExtensions` and `noEmit`, because esbuild builds the deploy bundle). No Jest, no transpiler, no extra packages in `functions/`.
- An unbound secret's `.value()` logs a warning and returns an empty string in tests; that is expected, the fake provider ignores the key.
- Never set a real key in a test. A test that needs a value uses an obviously fake one, and the checker's `literal-key` rule scans tests too.

## firebase-functions-test

The official helper (`firebase-functions-test`, 3.5.0 on 2026-10-21) wraps functions for offline tests and builds fake events (`makeMessage`, `makeDocumentSnapshot`) for background triggers. Two facts decide whether to add it:

- Its peer range is `firebase-admin ^8 ... ^13`, so `npm install` with `firebase-admin` 14.5.0 stops with `ERESOLVE` (reproduced on 2026-10-21 with npm 11.20; re-verify with `npm view firebase-functions-test peerDependencies`). Do not force it with `--legacy-peer-deps`; wait for a release that lists 14, or pin `firebase-admin` 13 in that project only if the developer agrees.
- For callables it adds nothing over `run()`. Its value is event construction for Firestore, Storage and Pub/Sub triggers; for those, a plain object shaped like the event (`{ id, data: { message: { json } } }` for Pub/Sub) passed to the exported pure function (`shouldPause`, the parser) is enough in most tests.

## Emulator integration tests

Run the real functions against the Firestore and Auth emulators with a `demo-` project id, so nothing can touch a real project:

```sh
cd functions && npm run build && cd ..
npx firebase emulators:exec --only functions,firestore,auth --project demo-tasks "node --test functions/integration/*.test.ts"
```

How the functions emulator treats tokens (read from firebase-tools 15.34.0 `lib/emulator/functionsEmulator.js`, which sets `skipTokenVerification`, and firebase-functions 7.4.0 `checkAppCheckToken`, on 2026-10-21; not run against a live emulator in this skill's own proof):

- A callable is a POST to `http://127.0.0.1:5001/demo-tasks/<region>/<function>` with the JSON body `{ "data": <envelope> }`.
- With `enforceAppCheck: true`, a request without the `X-Firebase-AppCheck` header is rejected with `unauthenticated`. With any header value it is decoded, not verified, so a fake JWT (`base64({"alg":"none"}).base64({"sub":"<app id>"}).x`) passes, and `alreadyConsumed` is always false: replay protection cannot be proven on the emulator, only the wrapper's handling of `alreadyConsumed` in a unit test.
- `Authorization: Bearer <id token>` takes an Auth emulator token: an anonymous one comes from `POST http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo` with body `{}` (the Auth emulator's REST API).
- Secrets come from `functions/.secret.local`; params from `functions/.env.local`.

The four paths every callable proves on the emulator: no App Check header (`unauthenticated`), no ID token (`unauthenticated` from the wrapper, with `details.kind`), bad input (`invalid-argument`), and success. Add parallel calls for a quota and a claim.

## What to test for every callable

- [ ] Unauthenticated, bad envelope, bad payload: rejected before any fake is called.
- [ ] Each failure kind the handler can return, with its code and `details` (and `params` where typed).
- [ ] A cost-bearing callable: cache hit spends nothing; paused spends nothing; provider failure releases the quota; success counts one unit.
- [ ] The mapping table: one test per kind (the template loops over `CALLABLE_FAILURE_KINDS`).
- [ ] Emulator: the four paths above, plus concurrency for quotas and claims.

## Commands

```sh
cd functions
npm run typecheck     # tsc --noEmit with the functions tsconfig
npm test              # node --test "src/**/*.test.ts"
npm run build         # esbuild bundle to lib/index.js
```
