# Quotas, claims and the kill switch

How a function that spends money stays bounded: per-user quotas counted in server transactions and only on real work, create-if-absent claims for idempotency, a kill switch read before every paid call, a budget alert that turns the switch off, and instance limits as the last ceiling.

## Contents

- Server transactions for quotas
- Count only real work
- Create-if-absent claims
- The kill switch
- The budget notification handler
- Instance limits as a spend ceiling

## Server transactions for quotas

A quota is a read-then-write: read `used`, compare with the limit, write `used + 1`. Two parallel calls that both read `used = 19` with a limit of 20 would both pass without a transaction. The Admin SDK's `runTransaction()` retries the function when the doc changed under it, so exactly one of them takes the last unit. The template `functions/src/lib/daily-quota.ts` keeps one doc per user and UTC day (`<collection>/{uid}/days/{yyyy-mm-dd}`), so a day's count never needs a reset job.

- The quota limit and its window are server constants or a server-read config doc, never client input.
- A Premium user may get a higher limit: read the entitlement from the doc the purchase webhook writes, never from the client.
- The client reads its own usage for display (security rules allow the owner to read, never to write; `firestore-rules-and-emulator-tests` proves it).

## Count only real work

A user should never lose quota to a cache hit, a paused service, a bad input or a provider outage. The order in `summarize-list.ts`:

1. Parse (the wrapper): bad input costs nothing.
2. Cache lookup: a hit returns at once, no quota.
3. Kill switch: paused returns `service-paused`, no quota.
4. Reserve one unit in a transaction: `quota-exceeded` stops here.
5. The paid call.
6. On provider failure, release the unit (`FieldValue.increment(-1)`) and return `unavailable`; on success, write the cache.

Reserve-then-release keeps the count correct under concurrency; counting after success instead lets parallel calls overshoot the limit by up to the instance concurrency. A crash between reserve and release costs the user one unit at most, which is the safe direction.

## Create-if-absent claims

Idempotency and dedupe use a doc whose id is the thing to do once (the envelope's `requestId`, a content hash, a library entry id), written with `create()`, which fails with gRPC code 6 (`ALREADY_EXISTS`) when the doc exists. Unlike `set()` it never overwrites, and unlike a transaction it needs no read first.

```ts
// functions/src/lib/claim-once.ts (shape)
import type { DocumentReference } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

export type ClaimResult = { ok: true } | { ok: false; kind: 'already-claimed' };

const ALREADY_EXISTS = 6;

export async function claimOnce(ref: DocumentReference, data: Record<string, unknown> = {}): Promise<ClaimResult> {
  try {
    await ref.create({ ...data, claimedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === ALREADY_EXISTS) {
      return { ok: false, kind: 'already-claimed' };
    }
    throw error;
  }
}
```

- A retry of the same request finds the claim and returns the stored result (or `queued` while the first one is still running) instead of paying twice.
- Generated shared content (one summary per content hash for every user) is claimed by the first caller; later callers read the result.
- Pub/Sub delivers at least once and may reorder, so every event handler that writes or spends claims the message id (`event.id`) first.
- Test it on the emulator: two parallel `claimOnce` calls on the same ref, exactly one `ok: true`.

## The kill switch

`ops/flags.paidCallsEnabled` (template `functions/src/lib/paid-calls-flag.ts`) is read before every paid provider call, after the cache. It fails closed: a missing doc, a field that is not exactly `true`, or a read error all mean off, so a misconfigured project spends nothing. A 30-second in-memory cache keeps it to one read per instance per half minute.

- Only the budget handler turns it off; only the developer turns it back on (console or a seed script they run). Agents never flip it in a real project.
- Create `ops/flags` with `paidCallsEnabled: true` in each project once, as a developer step; until then paid callables answer `service-paused`.
- Security rules deny all client access to `ops/`.
- Free callables (a health check, reading the user's own data) never read the flag.

## The budget notification handler

Cloud Billing budgets send programmatic notifications to a Pub/Sub topic the developer connects in the console. The message data is base64 JSON with these fields (Google Cloud's "Set up programmatic notifications" page, read on 2026-10-21; re-verify there):

| Field | Meaning |
|---|---|
| `budgetDisplayName` | the budget's name |
| `costAmount` | cost accrued in the current period (filters of the budget applied) |
| `costIntervalStart` | start of the period, e.g. `"2026-10-01T07:00:00Z"` |
| `budgetAmount` | the budget amount |
| `budgetAmountType` | `SPECIFIED_AMOUNT`, `LAST_MONTH_COST` or `LAST_PERIODS_COST` |
| `alertThresholdExceeded` | highest actual-cost threshold crossed (0.9 = 90%); absent when none |
| `forecastThresholdExceeded` | highest forecast threshold crossed; absent when none |
| `currencyCode` | e.g. `"EUR"` |

Attributes: `billingAccountId`, `budgetId`, `schemaVersion` (`1.0`). Notifications arrive several times a day even without new cost, the first one can take hours, delivery is at least once and may be out of order, and the cost figures are estimates that lag real spend by hours. The breaker is therefore a backstop, not the main control: quotas, the kill switch and `maxInstances` are.

```ts
// functions/src/ops/on-budget-alert.ts (shape)
import * as logger from 'firebase-functions/logger';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { FieldValue } from 'firebase-admin/firestore';
import * as v from 'valibot';

import { db } from '../lib/admin.ts';
import { FLAGS_DOC } from '../lib/paid-calls-flag.ts';

const BudgetNotification = v.object({
  budgetDisplayName: v.string(),
  costAmount: v.number(),
  budgetAmount: v.number(),
  currencyCode: v.string(),
  alertThresholdExceeded: v.optional(v.number()),
});

/** The fraction of the budget at which paid calls stop. A server constant, not a message field. */
const PAUSE_AT = 0.9;

export function shouldPause(notification: v.InferOutput<typeof BudgetNotification>): boolean {
  return notification.budgetAmount > 0 && notification.costAmount / notification.budgetAmount >= PAUSE_AT;
}

export const onBudgetAlert = onMessagePublished({ topic: 'budget-alerts', retry: false, maxInstances: 1 }, async (event) => {
  const parsed = v.safeParse(BudgetNotification, event.data.message.json);
  if (!parsed.success) {
    logger.warn('budget-alert-unparsed', { messageId: event.id });
    return;
  }
  if (!shouldPause(parsed.output)) return;
  await db().doc(FLAGS_DOC).set(
    { paidCallsEnabled: false, pausedReason: 'budget', pausedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  logger.warn('paid-calls-paused', { ratio: parsed.output.costAmount / parsed.output.budgetAmount });
});
```

- It never disables billing on the project: that stops every service, Firestore and Auth included, and can delete resources. It only pauses paid calls.
- Setting the flag is idempotent, so duplicates and reordering are harmless; it never sets the flag back to true.
- Test `shouldPause` and the parsing as unit tests; publish a sample message to the Pub/Sub emulator and assert the flag doc for the integration test.
- Creating budgets, thresholds, the topic and its connection is a developer step in the Cloud console (it touches billing). Stop and ask; report the console link they confirm.

## Instance limits as a spend ceiling

`maxInstances` caps how many instances run at once; with the default concurrency of 80 requests per instance (when the function has 1 CPU or more; firebase-functions 7.4.0 `GlobalOptions.concurrency` docs), a callable with `maxInstances: 5` serves at most 400 parallel calls. Without it, 2nd-gen HTTP functions (callables included) scale up to a default of 100 instances (Google Cloud's Cloud Run functions quotas page, read on 2026-10-21), and a loop in a client build or an abusive script scales cost with it. Set a default in `setGlobalOptions` and a lower value on every paid callable (the template uses 10 globally and 5 on `summarizeList`). `timeoutSeconds` bounds each call's billed time; `memory` bounds its price per second.
