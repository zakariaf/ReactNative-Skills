# The RevenueCat webhook: authentication, idempotency, events and the entitlement record

How the server learns about every subscription change and turns it into the one record that server
decisions read. Facts read on RevenueCat's "Webhooks" and "Event types and fields" pages and the REST
API v1 "Customers" page on 2026-10-21 (re-verify: open those pages and compare the event table and
the retry paragraph; the REST shape with `GET /v1/subscribers/<id>` on a sandbox user).

## Contents

- The flow
- Authenticating a delivery
- Idempotency by event id
- Delivery, retries and timing
- Event types
- Payload fields the handler reads
- Deriving the record from REST state
- The record and resolvePlan
- Transfers, anonymous ids, TEST and sandbox events
- The sync endpoint
- With Firebase
- When the server is something else

## The flow

`handleRevenueCatWebhook(request, deps)` in `templates/server/src/subscriptions/` does, in order:

1. **Authenticate:** compare the Authorization header with the configured value in constant time;
   a wrong or missing header is 401 and nothing else happens.
2. **Parse:** a body without `event.id` and `event.type` is 400.
3. **Ignore** `TEST` events and events whose only users are anonymous SDK ids (200, logged).
4. **Claim the event id** in a ledger (create-if-absent). A duplicate is 200 without writing.
5. **Re-fetch** every affected user from `GET /v1/subscribers/{app_user_id}` and derive the record.
6. **Write** the entitlement record of each user, with `sourceEventId`; 200.
7. If RevenueCat's REST API or the write failed: release the claim and answer 500, so RevenueCat
   retries the same event id.

## Authenticating a delivery

- In the RevenueCat dashboard (Integrations -> Webhooks) the developer sets an **Authorization header
  value**; RevenueCat sends it as the `Authorization` header of every POST. Use a long random value
  (`Bearer <32+ random bytes, base64url>`), stored as a server secret, never in the repo.
- Compare it in constant time: hash both sides with SHA-256 and compare with
  `crypto.timingSafeEqual`. Hashing gives both buffers one length, so `timingSafeEqual` neither
  throws nor leaks the length; `===` leaks timing and is what `webhook-unauthenticated` reports.
- The webhook is a plain HTTPS endpoint, not a callable: no App Check and no end-user auth (the
  caller is RevenueCat). The Authorization check is its only gate, so it runs first.
- **Optional HMAC signing** (an integration setting): RevenueCat then also sends
  `X-RevenueCat-Webhook-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` computed over
  `"<t>.<raw body bytes>"` with a signing secret shown once at creation. Verify over the raw bytes
  exactly as received (not re-serialised JSON), compare in constant time, and reject `t` older than
  about 5 minutes. It is recomputed on every retry. Add it on top of the Authorization check when the
  server can read the raw body; the checker accepts either as long as `timingSafeEqual` is used.

## Idempotency by event id

- Every event has a unique `event.id`; retries reuse the same `id` and `event_timestamp_ms`.
- The ledger's `claim(event.id)` must be atomic create-if-absent: Firestore `doc(id).create()` (fails
  with `ALREADY_EXISTS`, code 6), SQL `INSERT ... ON CONFLICT DO NOTHING` and check the row count,
  Redis `SET key value NX`. A read-then-write is not atomic: two concurrent retries both pass it.
- Claim before writing; on failure release (delete) the claim before answering 500. A crash between
  the claim and the write leaves the claim: the next event for that user, or the sync endpoint,
  re-derives the same state, because the record comes from REST state, not from the event.
- Keep ledger entries for at least the retry window (about 80 minutes); a TTL of 30 days is a
  sensible default for support questions.
- `webhook-not-idempotent` reports a handler whose claim is keyed by anything but the event id (a
  user id plus type collides across renewals; a timestamp processes retries twice).

## Delivery, retries and timing

- Success is HTTP **200** only; anything else is a failure. RevenueCat retries up to **5** times
  with exponential backoff (about 2.5, 5, 10, 20 and 40 minutes, with jitter; about 80 minutes in all).
- RevenueCat disconnects after **60 s**. Answer fast: the re-fetch is one REST call per user; heavier
  work goes to a queue after the answer.
- Most webhooks arrive within 5 to 60 seconds; cancellation events usually within 2 hours of the
  user cancelling.
- Delivery order is not documented as guaranteed. Deriving from REST state makes order irrelevant:
  a late `EXPIRATION` after a `RENEWAL` re-reads the renewed state and keeps Premium.

## Event types

The `event.type` values on 2026-10-21:

| Type | Meaning | The handler |
|---|---|---|
| `TEST` | sent from the dashboard to test the endpoint | log, 200, no write |
| `INITIAL_PURCHASE` | a new subscription | re-fetch, write |
| `RENEWAL` | renewed, or a lapsed user resubscribed | re-fetch, write |
| `CANCELLATION` | auto-renew turned off, **or a refund** (`cancel_reason: CUSTOMER_SUPPORT`) | re-fetch: `cancelled-active` until expiry, or `refunded` |
| `UNCANCELLATION` | auto-renew turned back on before expiry | re-fetch, write |
| `NON_RENEWING_PURCHASE` | a purchase that does not renew | re-fetch, write |
| `SUBSCRIPTION_PAUSED` | Play: pauses at the end of the period | re-fetch, write |
| `EXPIRATION` | access ended (`expiration_reason`) | re-fetch: `expired`, or `billing-retry` |
| `BILLING_ISSUE` | a charge failed; `grace_period_expiration_at_ms` may be set | re-fetch: `grace` while the grace period lasts, else `billing-retry` |
| `PRODUCT_CHANGE` | monthly <-> annual and other changes | re-fetch, write |
| `SUBSCRIPTION_EXTENDED` | the period was pushed back | re-fetch, write |
| `REFUND_REVERSED` | a refund was reversed | re-fetch, write |
| `TRANSFER` | purchases moved between app user ids | re-fetch **both** sides |
| `TEMPORARY_ENTITLEMENT_GRANT` | RevenueCat granted up to 24 h during a store outage | re-fetch, write |
| `INVOICE_ISSUANCE`, `VIRTUAL_CURRENCY_TRANSACTION`, `EXPERIMENT_ENROLLMENT`, `PURCHASE_REDEEMED`, `PRICE_INCREASE_CONSENT_REQUIRED`, `PRICE_INCREASE_CONSENT_APPROVED`, `SUBSCRIBER_ALIAS` (deprecated) | billing, experiments, web redemption, price-increase consent | re-fetch and write is harmless; nothing else is needed for the entitlement |

Cancel and expiration reasons: `UNSUBSCRIBE`, `BILLING_ERROR`, `DEVELOPER_INITIATED`, `PRICE_INCREASE`,
`CUSTOMER_SUPPORT` (a refund), `UNKNOWN`, and `SUBSCRIPTION_PAUSED` (expiration only).

## Payload fields the handler reads

The body is `{ "api_version": "1.0", "event": { ... } }`. The handler reads only `event.id`,
`event.type`, `event.app_user_id`, `event.transferred_from`, `event.transferred_to` and
`event.environment` (`SANDBOX` or `PRODUCTION`). Other fields exist (`original_app_user_id`,
`aliases`, `product_id`, `entitlement_ids`, `period_type`, `expiration_at_ms`, `store`,
`grace_period_expiration_at_ms`, `cancel_reason`, `expiration_reason`, `new_product_id`, prices) but
the entitlement comes from REST state. Never log the body: it carries prices, transaction ids and
subscriber attributes.

## Deriving the record from REST state

`GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` with `Authorization: Bearer <secret
key>` returns `{ subscriber: { entitlements, subscriptions, ... } }` (it creates the customer when
missing: 201 instead of 200). `entitlementFromSubscriber` reads:

- `subscriber.entitlements.<entitlementId>`: `expires_date`, `grace_period_expires_date`,
  `product_identifier`.
- `subscriber.subscriptions.<product_identifier>`: `refunded_at`, `billing_issues_detected_at`,
  `unsubscribe_detected_at`, `grace_period_expires_date`, `store`, `is_sandbox`.

| REST state at server time | Status | Plan |
|---|---|---|
| no entitlement | `none` | free |
| `refunded_at` set | `refunded` | free |
| billing issue and grace period still running | `grace` | premium until `graceUntilMs` |
| expired with a billing issue (no grace left) | `billing-retry` | free |
| expired | `expired` | free |
| live and `unsubscribe_detected_at` set | `cancelled-active` | premium until `expiresAtMs` |
| live (or `expires_date` null: a non-expiring purchase) | `active` | premium |

REST failures: 5xx and 429 are `unavailable` (answer 500 so RevenueCat retries), other non-2xx are
`rejected` (also 500 and logged: usually a wrong secret key).

## The record and resolvePlan

`EntitlementDoc { entitlementId, status, productId, store, isSandbox, expiresAtMs, graceUntilMs,
updatedAtMs, sourceEventId }`, one per user (with Firebase: `users/{uid}/entitlement/main`, written
only by server code; firestore-rules-and-emulator-tests denies every client write). Every quota and
premium-only endpoint calls `resolvePlan(doc, serverNowMs)`: it re-checks the times, so an expiry
with no event still ends Premium, and a missing or malformed record is free. No server code reads a
plan, a Premium flag or `customerInfo` from the request (`client-entitlement-for-quota`).

## Transfers, anonymous ids, TEST and sandbox events

- `TRANSFER`: re-fetch and write every id in `transferred_from` and `transferred_to`; the old user
  loses Premium, the new one gains it.
- An app user id starting `$RCAnonymousID:` means the app configured the SDK without the backend user
  id. The handler skips it (200, logged as `anonymous-only`); fix the app (references/sdk-and-adapter.md).
- `TEST` is logged and ignored.
- `environment: SANDBOX` covers TestFlight, sandbox testers and StoreKit/Test Store purchases. Keep
  them (testers on the production backend need Premium too) and record `isSandbox` on the record.

## The sync endpoint

After a successful purchase the app calls a server endpoint (`syncEntitlement`, authenticated as
the user, rate limited) that runs the same re-fetch and derivation for the caller's own user id, so
the quota unlocks without waiting for the webhook. It writes `sourceEventId: sync:<ms>`. It never
takes a plan or a product from the request.

## With Firebase

The handler and its ports are server-agnostic; with Cloud Functions (2nd gen) the shell is
`examples/firebase-revenuecat-webhook.ts`:

- `onRequest({ secrets: [...], maxInstances, timeoutSeconds: 50 }, handler)` from
  `firebase-functions/v2/https` (firebase-functions 7.4.0, firebase-admin 14.5.0, verified to compile
  on 2026-10-21; re-verify with `npm view firebase-functions version`). Answer 405 for anything but
  POST.
- The Authorization value and the REST secret key are `defineSecret(...)` secrets
  (cloud-functions-backend owns secrets and limits).
- Ledger: `getFirestore().collection('webhookEvents').doc(eventId).create(...)`; `ALREADY_EXISTS`
  (code 6) is the duplicate. Writer: `doc('users/<uid>/entitlement/main').set(doc)`.
- Copy the templates to `functions/src/subscriptions/` and set the contract's `serverDirs` to
  `["functions/src"]` and `webhookFiles` to the handler's path there. With `"module": "NodeNext"` in
  the functions `tsconfig.json`, add `.js` to the templates' relative imports.

## When the server is something else

Any runtime with Node's `crypto` works: an Express route passes `req.get('authorization')` and
`req.body`; an edge runtime without `node:crypto` uses `crypto.subtle` (SHA-256 digests) and a small
constant-time byte comparison of its own named `timingSafeEqual(a, b)` (the name the checker looks
for), and keeps the same order. Name its folder in `serverDirs`.
