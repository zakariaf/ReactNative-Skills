# Regenerate, never store; versioned cutovers

Seeded content is a function of `(key, generatorVersion)`. Store the key, the version and what the
user did; regenerate the content. Once users have seen output for a key, that output is what the key
means: an improvement is a new version that serves keys from a future cutover date, and every old
version stays callable.

## Contents

- What to store
- Replaying with the stored version
- What counts as a change
- Shipping a new version, step by step
- Choosing the cutover date (store releases and OTA updates)
- Text keys and share codes
- Retiring a version or a generator
- Pitfalls

## What to store

| Store | Never store |
|---|---|
| the key (`date_key`, a share code) | the generated items, layout or text |
| `generatorVersion` (the version that made what the user saw) | "the latest version" implied by absence |
| the outcome: what the user did (completed ids, score, time) | aggregates that can be recomputed (streaks, totals: dates-streaks-and-statistics) |

Storing the content doubles the source of truth: the stored copy and the generator drift, a migration
must rewrite blobs nobody can validate, and a backup carries kilobytes of data that is a function of a
date. `examples/daily-focus-outcomes/` shows the shape in persistence-and-migrations' layout:

| File | Holds |
|---|---|
| `src/data/daily-focus/daily-focus-outcome-repository.ts` | the `FocusOutcome` type (`dateKey`, `generatorVersion`, `completedIds`) and the synchronous repository port |
| `src/data/daily-focus/daily-focus-outcome-schema.ts` | the row schema (`date_key`, `generator_version`, `completed_ids`) and the mapping to and from an outcome |
| `src/features/daily-focus/daily-focus-replay.ts` | `focusForOutcome(outcome)`, which regenerates what the user saw, and `startOutcome(today)` |

The data layer maps rows only; regenerating is feature code, so `src/data/` never imports a feature.
persistence-and-migrations owns the table, its migration and the SQLite and fake adapters.
`check-golden-vectors.mjs` checks that the outcome file the contract names contains the version field
(rule `outcome-version`; a SKIP until the file exists). The contract template names the repository
port; once the table exists, point `outcome.file` at whichever file declares the stored row.

## Replaying with the stored version

```ts
// writing: stamp the version the generator actually used
const focus = generateDailyFocus(today);                 // routed by the cutover table
saveOutcome({ dateKey: today, generatorVersion: focus.version, completedIds: [] });

// reading, a year later, after version 2 shipped
const seen = generateDailyFocus(outcome.dateKey, outcome.generatorVersion);   // version 1 again
```

The generator signature `generate(key, version = versionFor(VERSIONS, key))` makes both calls the same
function. A generator whose output does not carry its `version` cannot be replayed safely; the checker
requires the field (rule `version-cutover`).

## What counts as a change

Anything that can change one output for one key:

- the catalog or table a version draws from (an edit, a reorder, an added entry);
- a count (3 picks to 4), a draw order, an extra draw, a different draws helper;
- the salt, the seed derivation, the fingerprint spec;
- a core module (`sfc32.ts`, `daily-seed.ts`, `seeded-draws.ts`): these never change at all;
- a "pure refactor" that reorders two draws or iterates a `Set` in another order.

The vectors catch every one of them (`vectors-match`); the fix is never to refill the row.

## Shipping a new version, step by step

1. Copy `generateV1` to `generateV2` and make the change only in `generateV2` (a new catalog constant,
   not an edit of `CATALOG_V1`).
2. Append `{ version: 2, from: '<future date>' }` to the module's versions table and add `case 2` to
   the switch. Version 1 stays byte for byte.
3. Append the same entry to the generator's `versions` in `contracts/seeded-generators.json`. The salt
   stays unless the change is the salt (then say so in the commit).
4. Extend the oracle with version 2, from the written spec (`examples/daily-focus-cutover/daily-focus-oracle.ts`).
5. Add rows `{ "key", "version", "note" }`: the day before the cutover at version 1, the cutover day
   at version 2, a year-end/new-year pair and a leap day at version 2. Keep every version 1 row
   (version 1 stays callable for any key, so its rows stay valid).
6. Run `node scripts/oracles/update-<feature>-vectors.ts`; it fills only the new rows.
7. Read the diff: new rows only, no changed row, the contract only grew (no committed cutover moved,
   no salt changed, no row changed or deleted: `check-golden-vectors.mjs` fails each of them against
   what is committed).
8. Run the tests, then both checkers until `RESULT: PASS`.
9. Commit with a `Gate-Change:` trailer naming the generator, the version and the cutover date.

`examples/daily-focus-cutover/` is this procedure applied to the template: the generator, the vectors
file with the new rows, the oracle and the contract entry.

## Choosing the cutover date (store releases and OTA updates)

There is no server to arbitrate, so "every device agrees" holds only between devices that run a build
containing the new version. A store release reaches users over days to weeks (staged rollout, review,
users who update late), and an EAS Update reaches devices on their next launches; some devices never
update. Choose the cutover so that, by that date, almost every active device runs a build that knows
version 2:

- at least one full release cycle after the build ships to 100 % (a few weeks is typical);
- never a date that has passed, or is today, when the build ships: devices that already showed the
  key would show something else after updating (`check-golden-vectors.mjs` fails a version that the
  committed contract does not record yet when its cutover is today or earlier, and any later edit of a
  committed cutover; checkers.md, "What is committed is frozen; new cutovers start in the future");
- a device still on the old build after the cutover computes version 1 for new keys; that is the
  accepted cost. If the content is shared between users (a daily challenge with a leaderboard), show
  the shared feature only on builds that know the current version (ota-updates covers runtime
  versions, channels and rollouts).

## Text keys and share codes

A generator keyed by text (a share code, a seed the user types) has no date to route on. Put the
version in the key (`'v2:7KQ2'`) or in the share payload, register the generator with
`"keyKind": "text"` and every version with `"from": null`, and pass the version explicitly on every
call. `examples/starter-pack-share-code/` is the whole shape:

```ts
// sharing: a new code carries the newest version this build knows
const code = formatShareCode(body);                          // 'v2:7KQ2'

// receiving: the version comes from the code, never from "the latest"
const parsed = parseShareCode(code);                         // { version: 2, body: '7KQ2' } or null
const pack = parsed === null ? null : generateStarterPack(parsed.body, parsed.version);
```

```json
{ "id": "starter-pack", "keyKind": "text",
  "versions": [{ "version": 1, "from": null }, { "version": 2, "from": null }],
  "regenerate": "python3 scripts/oracles/starter-pack-oracle.py --fill" }
```

- The generator's `version` parameter has no default. `generator-versions.ts` agrees:
  `assertVersionTable(VERSIONS, { keyKind: 'text' })` accepts `from: null` on every entry, and
  `versionFor` throws for such a table, so nothing can route a code to the newest version by accident.
- `parseShareCode` returns `null` for a version this build does not know (a newer app made the code):
  the screen says "update the app to open this pack" instead of generating something else.
- `check-golden-vectors.mjs` generates every row with its version, requires the output to stamp it,
  and fails when a call without a version returns a different version than the row's (rule
  `version-cutover`). A generator that reads the version out of the full code (`'v2:7KQ2'` as the key)
  passes too, because it returns the version the key carries.
- Version 2 of a share-code generator ships like any other version (new catalog constant, new switch
  case, new oracle branch, new rows), minus the cutover date: codes made before the update keep
  saying `v1`.

## Retiring a version or a generator

**Versions are never retired.** Keep every version that a stored outcome, a share code or a replay can
still reference; the cutover table is 1..n with no gaps, so a removed version would leave keys with no
generator. `check-golden-vectors.mjs` fails a version that the committed contract records and the
current one no longer has (`version-cutover`), and its committed rows (`vectors-frozen`). Versions are
a few lines each; keep them.

**A whole generator can be retired** when its feature is removed. It is a data decision, not a
refactor, so stop and ask the developer first:

1. Write the migration that drops or rewrites the feature's stored outcomes (persistence-and-
   migrations, run-migration), and the developer approves it.
2. Remove the generator, its oracle, vectors and tests, and its entry in `generators`.
3. Add it to the contract's top-level `"retired"` list: `{ "id", "migration", "note" }`, where
   `migration` is the file from step 1 (`null` only when it stored no outcomes) and `note` says why and
   who approved it. The id is never reused.
4. Commit with a `Gate-Change:` trailer.

Without the `"retired"` entry the checker fails the missing generator against the committed contract,
even when `"generators"` is now empty. Renaming an id is not a retirement: an entry that keeps the
committed module, vectors file or salt is compared with the committed one, rows and all.

## Pitfalls

- **"Just fix the catalog typo" in version 1.** Every historical key that drew the typo changes.
  Ship version 2 with the fix and a future cutover.
- **Storing the generated list "for speed".** Regeneration is microseconds; a stored copy is a second
  source of truth that a later version will contradict.
- **A cutover date equal to the release date.** Users who already saw today's content see different
  content after the update. Pick a future date.
- **Deleting old rows from the vectors file when version 2 ships.** They are the proof that version 1
  still reproduces history; the update script refuses to change them and the checker requires a row
  per version.
- **Stamping `version: LATEST` on a new outcome.** Stamp `output.version`, the version that actually
  ran for that key.
