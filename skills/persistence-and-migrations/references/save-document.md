# Appendix: one validated save document

For small app state that is read whole and changed whole (settings, onboarding, counters, an
entitlement, a game's progress), one versioned JSON document can replace a handful of tiny tables.
It lives in the same app database, in two slots (`current` and `backup`), validated with a strict
valibot schema on every load and before every write, and upgraded only by pure, frozen steps. Choose
it with `"mode": "document"` (the document is the app's only data) or `"both"` (tables for the lists,
a document for the small state) in `contracts/persistence.json`; the checker then adds these rules.

## Contents

- When a document, when tables
- Two version numbers
- The files
- The v1 document (Tasks app)
- The slots and their tables
- Codec and checksum
- The load plan and its outcomes
- The single writer and the backup moments
- Protected sections and resets
- Document migrations, step by step
- Frozen document fixtures
- Startup: hydrate and peek
- What the document tests prove
- What check-persistence adds

## When a document, when tables

| Use a document when | Use tables when |
|---|---|
| a few dozen fields, read at startup, shown together | lists that grow without bound (tasks, notes, messages) |
| every change rewrites a small object anyway | changes touch one row of many |
| no queries beyond "give me the state" | filters, sorting, counts, joins |
| under a few tens of kilobytes (a p95 write well under 5 ms) | anything larger |

A document that grows a list (a history, a log) belongs in a table: move it with a migration of both
kinds (a table step, and a document step that drops the field).

## Two version numbers

`PRAGMA user_version` versions the tables, including `document_slots` (the tables' migrations).
`schemaVersion` inside the JSON versions the document and changes with features. They move
independently: a document change needs no table migration, and a table change does not touch the JSON.

## The files

All in `src/data/document/` (templates in this skill):

| File | Holds | Frozen once shipped |
|---|---|---|
| `schema/document-primitives.ts` | `COUNT`, `DATE_KEY`, `KEBAB_ID`, `LANGUAGE_TAG`, `HOUR` | yes (a v2 adds primitives, never edits) |
| `schema/document-sections-v1.ts` | `SETTINGS_V1`, `ONBOARDING_V1`, `STATS_V1`, `PREMIUM_V1` | yes |
| `schema/app-document-v1.ts` | `APP_DOCUMENT_V1`, `AppDocumentV1` | yes |
| `schema/app-document.ts` | `LATEST_DOCUMENT_VERSION`, `LATEST_DOCUMENT_SCHEMA`, `AppDocument` | no: the one place that names the latest |
| `schema/default-app-document.ts` | `DEFAULT_SETTINGS`, `DEFAULT_STATS`, `createDefaultAppDocument(appId)` | no: always the latest shape |
| `document-store.ts`, `sqlite-document-store.ts`, `fake-document-store.ts` | the slot port and its adapters | |
| `document-tables.ts` | `DOCUMENT_SLOTS_DDL` and the slot statements | the DDL, once pasted into a migration |
| `document-codec.ts` | `validateAppDocument`, `encodeAppDocument`, `decodeSlot` | |
| `document-load-plan.ts` | `planLoad`, `lastWriteCount`, `LoadOutcome` | |
| `document-service.ts` | `createDocumentService` (writer results, quarantine queue, `didLastWriteFail`), `keepPremiumUnlessRevoked` | |
| `reset-document.ts` | `resetAllProgress`, `resetStatistics` | |
| `migrations/document-migrations.ts` | `DOCUMENT_MIGRATIONS`, `runDocumentMigrations`, `migrateDocumentToLatest` (both return a `Result`) | the list is append-only |
| `fixtures/` | frozen JSON documents, `DOCUMENT_FIXTURE_CHECKSUMS`, their test | yes |
| `hydrate-document.ts`, `peek-current-document.ts` | the startup load and the read-only peek | |

Code outside `schema/` imports only `app-document.ts` types (`AppDocument`, `AppSettings`), never a
`-vN` file, so a version bump changes one file.

## The v1 document (Tasks app)

```ts
SETTINGS_V1 = strictObject({ theme: picklist(['system','light','dark']), language: nullable(LANGUAGE_TAG),
  reminderHour: HOUR, soundEnabled: boolean(), reduceMotion: picklist(['system','on','off']) })
ONBOARDING_V1 = strictObject({ completed: boolean(), seenTips: array(KEBAB_ID) })
STATS_V1 = strictObject({ tasksCompleted: COUNT, streak: strictObject({ lastDate: nullable(DATE_KEY),
  length: COUNT }), bestStreak: COUNT, days: record(DATE_KEY, COUNT) })   // days pruned to 30
PREMIUM_V1 = strictObject({ owned: boolean(), ownedSinceMs: nullable(COUNT),
  lastCheckedAtMs: nullable(COUNT), revokedAtMs: nullable(COUNT) })      // protected
APP_DOCUMENT_V1 = strictObject({ schemaVersion: literal(1), appId: KEBAB_ID,
  settings, onboarding, stats, premium })
```

- `strictObject` everywhere: an unknown key is an error, so a typo in a step cannot slip through.
- `appId` stops a document from another app or flavor (a debug import, a restored file) from loading:
  it decodes as damaged.
- All-time counts are stored (`tasksCompleted`, `bestStreak`) because `days` is pruned; counting
  the record's keys would stop at 30.
- `language: null` means "follow the device"; the app's languages are the i18n layer's.

## The slots and their tables

The tables come from one of the app's own table migrations: paste `DOCUMENT_SLOTS_DDL` as a literal
into `src/data/migrations/v000N-create-document-slots.ts` and append it to `MIGRATIONS`.
`document_slots(slot 'current'|'backup', schema_version, app_version, written_at_ms, write_count,
checksum, payload) STRICT` and `document_quarantine(id, quarantined_at_ms, slot, reason, schema_version,
payload) STRICT`. `DocumentStore.write({ current, backup })` upserts both in one transaction;
`quarantine(slot, reason, atMs)` copies the row (never moves or deletes it) and keeps the newest 10.

## Codec and checksum

`encodeAppDocument(doc, meta)` writes `JSON.stringify(doc)` with its `fnv1a32` checksum (8 hex
characters over UTF-16 code units; detects bit rot and a hand edit that is still valid JSON).
`decodeSlot(record, appId)` never throws and never writes, in this order: a version above the latest is
`newer`; a checksum mismatch is `damaged: checksum`; broken JSON is `damaged: json` (parsed through
`attempt`, no swallowing catch); an older version runs `migrateDocumentToLatest`, whose failure kind
(`document-step-missing`, `document-not-an-object`, `document-step-threw`) becomes the damaged reason;
the latest schema validates (`damaged: schema <path>: <message>`); another app id is `damaged: app-id`.
A property test proves every valid document survives encode then decode unchanged.

## The load plan and its outcomes

`planLoad({ current, backup, appId })` is pure: both rows in; a document, an outcome and planned writes
out. The writes run through the service after startup's reload decisions.

| Situation | Outcome | Writes | Tell the user |
|---|---|---|---|
| both missing | `fresh` | both slots | nothing |
| `current` decodes | `loaded` / `migrated` | both slots (refreshes the backup) | nothing |
| `current` (or else `backup`) is newer | `newer-version` | none; the session plays the default document in memory | "please update", at every launch |
| `current` damaged or missing, `backup` decodes | `restored-from-backup` | quarantine `current`, then both from the backup | "A backup copy was restored." |
| both damaged | `reset-after-damage` | quarantine both, then fresh | "Your data couldn't be loaded." |

A file from a newer build at the table level never reaches the plan: `openAppDatabase` already runs
that session in memory (the document then loads `fresh` into memory and writes go nowhere). A property
test feeds the plan any two rows a phone could hold (good, bit-rotted, hand-edited, another app's,
another version's, missing) and proves it always yields a valid document and a known outcome.

## The single writer and the backup moments

`createDocumentService(deps, plan, writeCountBase)` with `deps = { store, clock, errorLog, appVersion,
isStrict }`; stores call `update(recipe, { refreshBackup })` and nothing else writes
(`write-outside-service`). Each update runs `keepPremiumUnlessRevoked(doc, recipe(doc))` (the guard),
then, unless the plan is read-only, `validateAppDocument`, `encodeAppDocument` and one transaction for
`current` (and `backup` when refreshed). What became of the write is one of four results:

| Result | When | Memory | Disk | `update()` |
|---|---|---|---|---|
| `rejected` | the document is invalid | keeps the last valid document | nothing written; logged (thrown in strict builds) | `false` |
| `held` | a quarantine copy of a damaged slot is still pending | the new document | nothing written: the copy must land first | `false` |
| `refused` | the store threw (SQLITE_FULL, an I/O error) | the new document | nothing written; logged with the raw error | `false` |
| `written` | the transaction committed | the new document | current (and backup) written | `true` |

- **Never a crash loop.** A refused write is recorded and returns; it never throws. Startup writes
  (the plan's quarantines and write-both) run on every launch, so a throw there would stop every
  launch while the disk stays full. `hydrateDocument` therefore never throws for a data reason either.
- **`didLastWriteFail()`** is true after a refused or held write and false again once a write lands;
  the UI may read it to say changes are not being saved. **`update()` returns whether the change
  reached the disk:** most callers ignore it, but one that must not go on before the change is on disk
  (finishing a purchase, in-app-purchases) reads it.
- **The backup stays due.** A backup refresh that did not land (refused or held) makes every later
  write include the backup until one lands, so a reset or an entitlement change always reaches it.
- **The quarantine copy comes first.** A damaged slot's quarantine copy is the only copy of that
  payload, so while one is pending (`createQuarantineQueue`) every slot write is held and the copy is
  retried first.
- The write counter keeps rising across launches (`lastWriteCount` of both rows), including refused
  attempts.

An invalid document is never written and never becomes the one in memory: strict builds (development,
preview) throw so tests and end-to-end runs fail loudly; production logs it and keeps the last valid
document. The backup is refreshed from a validated document only at defined moments: at startup after a
good load or migration (the plan's write-both), after a reset or an import, after an entitlement
change, and at the app's own milestones (a completed onboarding, a finished session). Per-change writes
touch `current` only, so a bad run of writes can never overwrite the last good copy.

## Protected sections and resets

`contracts/persistence.json` `document.protectedSections` (`["premium"]`) are guarded for every
writer: an entitlement turns off only when the change carries `revokedAtMs` (the purchase flow's dated
revocation, in-app-purchases), never because a refresh returned nothing. Resets spread `...doc` and
replace only what they clear: `resetAllProgress` clears every progress section (here the statistics;
a game adds its levels and daily results) and keeps settings, onboarding and Premium; `resetStatistics`
clears statistics. First-run state (onboarding done, tips seen) survives a reset by default, as
settings-and-preferences says: the person deleted their progress, not their knowledge of the app.
Clearing it is a product decision the confirmation text names (`onboarding: fresh.onboarding`).
Both are written with `refreshBackup: true`, so a later backup restore cannot undo them.

## Document migrations, step by step

`examples/document-v2/` adds `settings.textScale` (100 to 200 percent):

1. Failing test first: `migrations/v1-to-v2.test.ts` (the minimal v1 fixture becomes exactly the v2 JSON;
   the full one validates; a fast-check property over valid v1 settings always validates). Update the
   pinned first-launch test (`schema/default-app-document.test.ts`) in the same change.
2. `schema/document-sections-v2.ts`: only the changed sections, built on the frozen v1 ones.
3. `schema/app-document-v2.ts`: `{ ...APP_DOCUMENT_V1.entries, schemaVersion: v.literal(2), settings: SETTINGS_V2 }`.
4. `schema/app-document.ts`: `LATEST_DOCUMENT_VERSION = 2`, `LATEST_DOCUMENT_SCHEMA = APP_DOCUMENT_V2`, the type.
5. `schema/default-app-document.ts`: the new field's first-launch value.
6. `migrations/v1-to-v2.ts`: the pure step (`{ from: 1, migrate }`, literal values, guarded reads of
   unknown JSON, `import type` only), appended to `DOCUMENT_MIGRATIONS`. The runner stamps `schemaVersion`.
7. Fix what the compiler reports (reducers, selectors, screens).
8. Freeze `app-document-v2.minimal.json` (the default) and `app-document-v2.full.json` (the full v1
   migrated, then the new field filled), add both to `FIXTURES`, record their checksums.
9. Run the document tests and `check-persistence`; land it as one reviewed change.

## Frozen document fixtures

Two per version, written by that version and frozen: `app-document-vN.minimal.json` (the default
document) and `app-document-vN.full.json` (every section filled). The checksum is
`fnv1a32(JSON.stringify(json))`, so formatting may change and content may not; the template values
(`582156a1`, `f98df6f5`) were recomputed by an independent Python implementation. The test proves
each fixture is unchanged, decodes to `ok` through today's migrations, and survives an encode/decode
round trip.

## Startup: hydrate and peek

`hydrateDocument({ store, clock, errorLog, appVersion, isStrict, appId })` runs after `openAppDatabase`
and before the first render: read both slots, plan, create the service, apply the planned writes, and
return `{ document, outcome }`. It never throws for a data reason, a full disk included.
`peekCurrentDocument(errorLog)` is a read-only peek at the current payload (for example its language)
before startup's reload decisions.

## What the document tests prove

| Test | Proves |
|---|---|
| `document-load-plan.test.ts` | every branch, and a property over any two rows: a valid document and a known outcome, never a throw |
| `document-codec.test.ts` | each damage reason, a newer version, strictness, and an encode/decode round-trip property |
| `document-service.test.ts` | counter, backup moments, strict and production builds, the Premium guard (and its property), read-only, a refused write logged and reported, the backup staying due, startup on a full disk, writes held behind a pending quarantine copy, `update()`'s answer |
| `hydrate-document.test.ts` | first launch, relaunch, a newer build's document, a refused startup write |
| `schema/default-app-document.test.ts` | the pinned first-launch document, strict at every depth, a settings property |
| `fixtures/document-fixtures.test.ts`, `migrations/document-migrations.test.ts` | frozen fixtures and the step chain |
| `test/sqlite/sqlite-document-store.test.ts` | the slots on real SQL |

## What check-persistence adds

| Rule | Means |
|---|---|
| `missing-file` | a document file or reset module is missing |
| `schema-strict` | `v.object`, `v.looseObject` or `v.any` in `document/schema/` |
| `schema-version` | `app-document-vN.ts` without `schemaVersion: v.literal(N)`, or `LATEST_*` not the highest N |
| `migration-chain` | a missing `vK-to-vK+1.ts`, its registration or its test; no table migration creates `document_slots` |
| `migration-pure` | a document step imports runtime code or reads time or randomness |
| `fixture-missing`, `fixture-frozen`, `fixture-untested` | as for the database fixtures, per document version |
| `validate-before-write` | the service writes before validating, `update()` lacks the guard, or ignores `isReadOnly` |
| `protected-reset` | a document reset writes a protected section |
| `quarantine-not-delete` | a `DELETE FROM document_slots` |
| `write-outside-service` | `store.write({ current ... })` or `UPSERT_SLOT_SQL` outside `src/data/document/` |
| `transaction-write` | the slot store's `write` is not one transaction |
| `pragmas` | a document table is not STRICT |
