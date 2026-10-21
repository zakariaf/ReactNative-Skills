# The callable contract

What every client-facing function looks like on the wire and inside: the envelope, the order of checks in the wrapper, the error mapping table, App Check and replay protection, auth, and the log line. The templates `functions/src/lib/define-callable.ts` and `functions/src/lib/callable-failure.ts` implement exactly this.

## Contents

- Why one wrapper
- The envelope
- The order of checks
- The error mapping table
- App Check and replay protection
- Auth
- Structured logs
- Changing the contract

## Why one wrapper

A callable written by hand forgets one of six things sooner or later: App Check, auth, parsing, the error mapping, the log line, the limits. `defineCallable()` makes them impossible to forget, and the checker (`check-functions.mjs`) reads the wrapper's own `onCall` for App Check, auth and parsing, then each wrapper call for its input schema and replay protection. A function that is not a client call (a Pub/Sub, scheduler or Firestore trigger) does not use the wrapper; it still gets limits and validation of its event payload.

`onCall` is the only client entry point. `onRequest` is for webhooks from other servers (a payment provider, a store notification), where the caller authenticates with a shared secret or a signature instead of a Firebase ID token, and App Check does not apply.

## The envelope

The request data of every callable is one object:

| Field | Type | Why |
|---|---|---|
| `apiVersion` | the literal `1` | A store build in users' hands keeps calling an old shape for months. A new shape gets a new version (or a new function), and the old one keeps working until the last supported build is gone. |
| `requestId` | a UUID made by the client per user action | Idempotency and dedupe: a retry after a dropped connection carries the same id, so a server claim (`create()` on a doc keyed by it) runs the work once. It also joins client and server logs. |
| `payload` | the function's own schema | Parsed with valibot after the envelope; one schema per function, shared with the client when the repo has a shared package (see "When multi-package" in SKILL.md). |

The success response is `{ ok: true, value }`. A failure is thrown as an `HttpsError` whose `details` is `{ kind, params? }`; the client adapter (owned by `firebase-rnfb`) turns it back into `{ ok: false, error: { kind, params } }` with a `switch` on `kind`. Failures travel as `HttpsError` rather than as a `{ ok: false }` body because the status code is what monitoring, retries and the Firebase console count, and the SDK hands `details` to the client unchanged.

## The order of checks

`runCallable()` does these in order and returns at the first failure, so no work happens for a caller that should not get any:

1. App Check: enforced by the SDK before the handler runs (`enforceAppCheck: true`). A missing or invalid token never reaches the handler.
2. Auth: `request.auth === undefined` returns `unauthenticated`. Anonymous users have `request.auth` and pass; the decision "anonymous may do this" is the function's, made explicitly in its handler if it differs.
3. Replay: when `consumeAppCheckToken` is on and `request.app.alreadyConsumed` is true, return `app-check-failed`. The SDK does not reject a consumed token by itself (verified in firebase-functions 7.4.0 on 2026-10-21 by reading `CallableOptions.consumeAppCheckToken` in `lib/v2/providers/https.d.ts`: "requests will not be automatically rejected ... the request.app.alreadyConsumed property will be set to true").
4. Parse: the envelope, then the payload. A failure is `invalid-input` with no echo of the input (it may hold user text).
5. The handler, which returns a typed result; an unexpected throw becomes `internal` and logs only the error's name.

## The error mapping table

One exhaustive `switch` in `callable-failure.ts` (`httpsCodeFor`), with a test per kind. Adding a kind is a compile error until it has a code.

| Kind | HttpsError code | Client shows | Typical cause |
|---|---|---|---|
| `unauthenticated` | `unauthenticated` | sign-in prompt or silent anonymous sign-in, then retry | no Firebase user yet |
| `app-check-failed` | `permission-denied` | "update the app" or generic retry | replayed or consumed token |
| `invalid-input` | `invalid-argument` | a bug report path; never a user error message | client and server schemas out of step |
| `quota-exceeded` | `resource-exhausted` | the limit and when it resets (`params.limit`, `params.resetsAt`) | daily quota used |
| `service-paused` | `failed-precondition` | a calm "paused, try later" state | kill switch off (budget alert) |
| `unavailable` | `unavailable` | retry with backoff | provider down or rate limited |
| `internal` | `internal` | generic error, report sent | anything unexpected |

The SDK itself answers a missing or invalid App Check token, and an invalid ID token, with `unauthenticated` before the handler runs, so the client treats `unauthenticated` without `details.kind` as "the platform refused the call". The message string is the kind, never prose: the client never shows or parses it.

## App Check and replay protection

- `enforceAppCheck: true` on every callable. The wrapper sets it; the checker fails an `onCall` without it (`missing-app-check`).
- `consumeAppCheckToken: true` on every callable that costs money (a paid model or media provider, an outgoing email or SMS, a batch job). Each limited-use token then buys one call, so a token lifted from one device cannot be replayed in a loop. The checker treats any callable that binds a secret as cost-bearing.
- The client must request limited-use tokens for those calls. In React Native Firebase this is `httpsCallable(functions, name, { limitedUseAppCheckTokens: true })` (the option exists in `@react-native-firebase/functions` 26.4.0 and 27.0.0, read from the package types and native modules on 2026-10-21; re-verify with `npm pack @react-native-firebase/functions@<version>` and `grep -r limitedUseAppCheckTokens package/lib/types`). The client side belongs to `firebase-rnfb`.
- Consuming a token needs the runtime service account to hold the role "Firebase App Check Token Verifier" (for 2nd gen with default settings, the default compute service account). The developer grants it in the Google Cloud console; ask before changing IAM. Without it every consuming call fails.
- Replay protection adds a network round trip to App Check per call and spends attestation quota faster, so use it only where a call costs money or is security critical (Firebase's App Check docs, read 2026-10-21; it is in beta and Node.js only).

## Auth

- `request.auth` is required. Anonymous auth counts as signed in, which is what lets a first-run user call a function with a per-user quota.
- Use `request.auth.uid` as the key for every per-user doc (quota, claim, cache). Never take a uid from the payload.
- Custom claims (`request.auth.token.<claim>`) are fine for roles; entitlements that change often (a subscription) are read from a server-written doc instead, because an ID token keeps old claims for up to an hour.

## Structured logs

- One line per call from the wrapper: function name, `uidHash` (a truncated SHA-256 of the uid), outcome (`ok` or the failure kind) and duration. That is enough to count failures per kind and per user without storing who the user is.
- Never log the payload, task titles, list names, model prompts or outputs, email addresses or the raw uid. Cloud Logging keeps logs for weeks and is read by more people than the database.
- Use `firebase-functions/logger` (structured JSON in Cloud Logging), not `console.log` with string concatenation.

## Changing the contract

- A new field in `payload` that old clients do not send: make it optional with a default, same `apiVersion`.
- A breaking shape: bump `apiVersion` and accept both versions in the schema (`v.variant('apiVersion', [...])`) until the oldest supported build moved on; or add a new function name.
- A new failure kind: add it to `CallableFailure`, the table above, the mapping test and the client's `switch` in the same change.
