# App Store Connect REST: when, how, and the modules

altool covers validate and upload. The small REST client in `scripts/asc/` covers what altool lacks. Read this before adding a REST call or when one fails. Network policy: this is tooling (Node), outside the app's `ApiClient` rule; the app itself never calls App Store Connect.

## Contents

- When to use REST
- Tokens (JWT)
- The modules (templates)
- Error codes
- Verified

## When to use REST

| Need | Endpoint | When |
|---|---|---|
| App record exists, and its numeric Apple id | `GET /v1/apps?filter[bundleId]=<id>&fields[apps]=name,bundleId` (filtered again by exact bundle id) | preflight, every release |
| Processing state | `GET /v1/builds?filter[app]=...&filter[version]=...&filter[preReleaseVersion.version]=...&fields[builds]=processingState&limit=1` | step 10 |
| What to Test | `GET /v1/builds/{id}/betaBuildLocalizations`, then `PATCH /v1/betaBuildLocalizations/{id}` or `POST /v1/betaBuildLocalizations` | step 11 |
| Internal tester group | `POST /v1/betaGroups` with `isInternalGroup: true`, `hasAccessToAllBuilds: true` | once per app record; by default the developer creates it with the app record, because they add themselves anyway |
| Register the bundle id (optional) | `POST /v1/bundleIds` | before the first archive (otherwise `-allowProvisioningUpdates` registers it) |
| In-app purchases | `POST /v2/inAppPurchases` and their localizations and price schedules | once per product (`in-app-purchases` owns the payloads) |
| Submit for review | `POST /v1/reviewSubmissions` (+ items) | per release, **only after the developer says "submit"** |

There is no endpoint to create an app record (the Apps resource offers list, read and modify only): that is a human step. The App Privacy answers are web-only (`privacy-and-store-declarations` prepares them).

## Tokens (JWT)

Apple's rules: header `alg ES256`, `kid <Key ID>`, `typ JWT`; payload `iss <Issuer ID>`, `iat`, `exp`, `aud "appstoreconnect-v1"`. "Tokens that expire more than 20 minutes into the future are not valid." `createAscJwt()` uses 15 minutes (`ASC_TOKEN_LIFETIME_SECONDS`) and signs with `dsaEncoding: 'ieee-p1363'` (the raw r||s signature JWTs need; Node's default DER encoding is rejected). A long wait reuses one token and mints the next about a minute before it expires (`reusedToken` in `scripts/release/processing-wait.ts`).

`xcrun altool --generate-jwt` also exists but has keychain options; the Node module keeps the key in memory only. The current time comes from `nowEpochSeconds()` in `scripts/clock/system-clock.ts`, the one tooling module allowed to read the wall clock (the canonical ESLint config enforces it).

## The modules (templates)

| File | Job |
|---|---|
| `scripts/asc/asc-jwt.ts` | `createAscJwt(credentials, nowEpochSeconds)`: pure, tested with a throwaway key |
| `scripts/asc/asc-credentials.ts` | `requireEnv`, `ascKeyPath(keyId, home?)`, `loadAscCredentials(env)`: the only reader of the `.p8`, into memory |
| `scripts/asc/asc-client.ts` | `ascRequest(token, { method, path, body })` -> `{ ok, status, json }` or `{ ok: false, status, errors: [{ code, detail }] }`; `ascField`, `errorCodes` |
| `scripts/asc/find-app.ts` | `findAppByBundleId(token, bundleId, request?)` -> `{ id, name }` or `null`: keeps only the record whose `bundleId` equals the one asked for (Apple's `filter[bundleId]` is not an exact match, so `com.acme.tasks2` is never taken for `com.acme.tasks`); two exact records stop the run; `request` defaults to `ascRequest` and tests pass a fake |
| `scripts/asc/print-app-record.ts` | CLI: `node scripts/asc/print-app-record.ts --variant preview` (or `--bundle-id <id>`) prints `{"id","name"}` or exits 2 (no record: a human step) |
| `scripts/asc/beta-notes.ts` | `setWhatsNew(token, buildId, text)` and its pure payload builders |

Imports follow the repo rule for Node code: relative with the `.ts` extension (Node type stripping ignores tsconfig `paths`, so `@/` does not resolve in scripts); parent-relative imports are allowed in `scripts/` only. `in-app-purchases` ships the same three client modules for its product script; they are one unit (one canonical copy once promoted).

## Error codes

Apple advises to **prefix-match** `errors[].code`, never to drive logic from `detail`:

| Code prefix | Status | Meaning | Action |
|---|---|---|---|
| `NOT_AUTHORIZED` | 401 | wrong key or issuer id, revoked key, or clock skew (`iat` in the future) | stop: check the ids against the key file name (without reading it) and that the clock is on network time |
| `FORBIDDEN_ERROR` | 403 | key role below Admin, an individual key, or a missing agreement | stop: a team key with the Admin role, or accept the agreement |
| `NOT_FOUND` | 404 | wrong id or path | fix the request |
| `ENTITY_ERROR` | 409/422 | invalid payload | fix the payload; `detail` may be shown to the developer |

## Verified

On 2026-10-14 the templates passed TypeScript 6.0, the canonical ESLint config, Prettier and Jest in the reference app (`find-app` and the processing wait run on fakes, the JWT round trip on a generated key; no test reaches the network). Earlier, on the source project, the client against the live API with a throwaway key returned `401 NOT_AUTHORIZED` parsed into `errors[0].code`, and every endpoint and `filter[...]` parameter above was found in Apple's documentation JSON. Not run: any call with a real key.
