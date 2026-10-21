# Versions, the functions package and deploy

The verified versions, the shape of `functions/`, the global options trap, the bundle, and the deploy steps the developer runs. Every fact is dated with the command that re-checks it.

## Contents

- Verified versions
- The functions package
- Global options and import order
- The bundle
- firebase.json
- Deploy (developer only)

## Verified versions

| Fact | Value on 2026-10-21 | Re-verify |
|---|---|---|
| `firebase-functions` | 7.4.0 (published 2026-09-15), Node `>=18`; peer `firebase-admin ^11 ... ^14` | `npm view firebase-functions version time engines peerDependencies --json` |
| `firebase-admin` | 14.5.0 (2026-09-23), Node `>=22`; modular imports `firebase-admin/app`, `firebase-admin/firestore` | `npm view firebase-admin version time engines --json` |
| Import paths | `firebase-functions/v2/https` (`onCall`, `HttpsError`, `CallableRequest`, `FunctionsErrorCode`), `firebase-functions/v2/options` (`setGlobalOptions`), `firebase-functions/v2/pubsub`, `firebase-functions/v2/scheduler`, `firebase-functions/params` (`defineSecret`, `defineString`), `firebase-functions/logger`; the root entry and the unprefixed paths (`firebase-functions/https`) are the same 2nd-gen API; `firebase-functions/v1` is 1st gen | `npm view firebase-functions exports --json` |
| `consumeAppCheckToken` | on `CallableOptions` in 7.4.0; a consumed token sets `request.app.alreadyConsumed` instead of rejecting | read `lib/v2/providers/https.d.ts` after `npm i firebase-functions@7.4.0` |
| `functions.config()` | removed in firebase-functions 7.0.0 (typed `never` in 7.4.0); Firebase says deploys that use it fail after March 2027 | the v7.0.0 notes at github.com/firebase/firebase-functions/releases |
| Newest Node runtime | `nodejs24` (GA; deprecation 2028-04-30) is the newest the Firebase CLI deploys; Google lists `nodejs26` as Preview for Cloud Run functions only (`gcloud beta`), not in firebase-tools 15.34.0 | `npm pack firebase-tools && grep -n nodejs2 package/lib/deploy/functions/runtimes/supported/types.js`; docs.cloud.google.com/functions/docs/runtime-support |
| Node 22 runtime | GA, deprecation 2027-04-30 (firebase-tools table) | same command |
| `firebase-tools` | 15.34.0 (2026-10-14); depends on `superstatic` `^10.0.0`, whose only 10.x release declares `node: "20 \|\| 22 \|\| 24"`, so under `engine-strict` on the house Node 26 the install stops with `EBADENGINE` until the root `package.json` has `"overrides": { "superstatic": "11.0.0" }` (11.0.0, 2026-07-08, declares `22 \|\| 24 \|\| 26`; only the Hosting emulator and `firebase serve` load it), recorded as a `via: "overrides"` companion of the firebase-tools policy row (verified 2026-10-22; firestore-rules-and-emulator-tests' toolchain reference has the row) | `npm view firebase-tools version time --json`; `npm view firebase-tools@<pin> dependencies.superstatic` and `npm view superstatic@<version> engines` |
| `firebase-functions-test` | 3.5.0 (2026-05-08); peer `firebase-admin` up to `^13` (conflicts with 14) | `npm view firebase-functions-test version peerDependencies --json` |
| `esbuild` | 0.28.2 (2026-08-08) | `npm view esbuild version time --json` |
| `valibot` | 1.5.0 | `npm view valibot version` |
| `typescript` | 6.0.3 (the library's stack pin; 7.0.2 exists but is not the stack) | `npm view typescript@6.0.3 version` |
| `@types/node` | 24.19.2 (2026-10-09), matching the Node 24 runtime | `npm view @types/node@24 version` |
| Budget notification shape | fields and attributes in the quotas reference | docs.cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications |

The Node 20 runtime row is left out on purpose: its decommission date in firebase-tools 15.34.0 is 2026-10-30, so a project still on it must move to `"node": "24"` now. <!-- stack-pin-ignore -->

All versions respect a 7-day minimum release age on 2026-10-21. Install them exactly (`npm install --save-exact`), as `dependency-management` requires.

## The functions package

`templates/functions/package.json`:

- `"type": "module"` and `"main": "lib/index.js"`: the deployed entry is the esbuild bundle, ESM (firebase-functions 7 supports ESM alongside CommonJS).
- `"engines": { "node": "24" }`: the Firebase CLI picks the runtime from it (a `runtime` in `firebase.json` wins over it).
- `dependencies` hold only what the bundle leaves external: `firebase-functions` and `firebase-admin` (the CLI requires `firebase-functions` there, and the Admin SDK is large and has native optional deps). Everything else (`valibot`, the shared package) is bundled, so it sits in `devDependencies`.
- npm 11.20 asks before running install scripts (`npm warn install-scripts esbuild@0.28.2 (postinstall: node install.js)`, seen on 2026-10-21); esbuild still worked through its platform package. Approve scripts only when the developer agrees.

`templates/functions/tsconfig.json` type-checks only (`noEmit`), strict, with `allowImportingTsExtensions` and `verbatimModuleSyntax`, so the same `.ts` files run under Node's test runner and in esbuild.

## Global options and import order

`setGlobalOptions()` must run before any trigger is created: `onCall()` computes its endpoint (region, memory, instances) when it is called, at import time for a module that exports `export const x = onCall(...)`. Verified on 2026-10-21 with firebase-functions 7.4.0: a module with a top-level `onCall` imported before the options module produced an endpoint with no region and default limits; the same module imported after it got the global values.

- `index.ts` imports `./config/global-options.ts` first, as a side-effect import, and contains only exports.
- The template's factories (`makeSummarizeList(deps)`) create their function inside `index.ts`'s body, after every import, which is safe in either order; keep the import first anyway.
- A per-function value (`maxInstances: 5`, `timeoutSeconds: 60`) overrides the global one.

## The bundle

```sh
esbuild src/index.ts --bundle --platform=node --target=node24 --format=esm \
  --external:firebase-functions --external:firebase-admin --outfile=lib/index.js
```

Verified on 2026-10-21: the templates build to a 19 KB `lib/index.js` whose only imports are `firebase-functions/*`, `firebase-admin/*` and `node:crypto`, and importing it shows `summarizeList` with region, `maxInstances: 5`, `timeoutSeconds: 60`, 256 MB and the bound secret.

List externals explicitly rather than `--packages=external`: that flag also leaves a workspace package (`@<org>/shared`) external, and `firebase deploy` then fails to install it (see "When multi-package" in SKILL.md).

## firebase.json

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "ignore": ["node_modules", "src", "*.local", "**/*.test.ts"],
      "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run typecheck", "npm --prefix \"$RESOURCE_DIR\" test", "npm --prefix \"$RESOURCE_DIR\" run build"]
    }
  ]
}
```

`firebase.json` is shared with the Firestore rules and emulator settings (`firestore-rules-and-emulator-tests`); merge this key, never overwrite the file. The checker reads `functions[].source` to find the folder.

## Deploy (developer only)

Deploying is outward-facing and can cost money: agents prepare, the developer runs it.

1. The developer sets every bound secret in the target project (`firebase functions:secrets:set <NAME> --project <alias>`).
2. The developer creates `ops/flags` with `paidCallsEnabled: true`, grants "Firebase App Check Token Verifier" to the runtime service account if any callable consumes tokens, and sets up the budget and its Pub/Sub topic.
3. `npm run deploy:functions -- --project <alias>` (a root script that runs `firebase deploy --only functions --project`), from a clean tree after `check-functions.mjs` passes.
4. After deploy: call the health callable from a dev build, read the log line, confirm the region in the console.
