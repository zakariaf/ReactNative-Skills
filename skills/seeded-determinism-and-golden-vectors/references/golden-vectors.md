# Golden vectors

A golden vector is a committed row `(key, version) → fingerprint + summary`, computed by an independent
oracle and asserted exactly by a test. It is to a seeded generator what a golden image is to a screen,
with one difference that matters: a changed row is one line in a review, so a wrong regeneration is
visible.

## Contents

- Vectors, snapshots and pixel goldens
- The vectors file
- The fingerprint: canonical JSON v1
- Which rows to pin
- The independent oracle
- Filling rows: the update script
- Before the first release: replacing the template rows
- CI verifies, never blesses
- Reading a vectors diff
- Labels over metrics
- A Python oracle for a generator

## Vectors, snapshots and pixel goldens

| | Golden vectors (this skill) | Data snapshots and pixel goldens (golden-and-snapshot-tests) |
|---|---|---|
| Pins | a pure generator's output per key | rendered text, boards, screens |
| Expected values from | an independent oracle | the code itself, accepted by a human with `jest -u` |
| Stored as | a JSON table next to the generator | `.snap` files, PNG baselines |
| Changed by | never for a shipped row; new rows filled by a reviewed script | `run-goldens-rebaseline`, one file at a time |

Both share one rule: a gate never regenerates what it checks.

## The vectors file

`src/features/<feature>/<feature>.vectors.json`, next to the generator:

```json
{
  "generator": "daily-focus",
  "fingerprint": "fnv1a32/canonical-json-v1",
  "oracle": "scripts/oracles/daily-focus-oracle.ts",
  "rows": [
    { "key": "2026-09-26", "version": 1, "fingerprint": "4b2e58bb",
      "summary": "item-01 item-07 item-11", "note": "historical key users have seen" }
  ]
}
```

| Field | Meaning |
|---|---|
| `generator` | the contract id |
| `fingerprint` | the fingerprint algorithm; a new spec is a new name, never an edit |
| `oracle` | the repo-relative path of the file that computes the rows (`scripts/oracles/<feature>-oracle.ts`, or another language such as `.py`), never a command line; `check-golden-vectors.mjs` reads it, follows a script oracle's local imports and fails if any of them reaches `src/` |
| `rows[].key` · `version` | the input: a civil date (or a text key such as a share code's body) and the generator version that must reproduce it |
| `rows[].fingerprint` | 8 hex digits of the output's canonical JSON |
| `rows[].summary` | what the user sees, in one line: the part a reviewer reads |
| `rows[].note` | why the row exists ("leap day", "cutover day") |

JSON, not TypeScript: the oracle, the update script, the checker and the test all read it, and a
reviewer reads its diff.

## The fingerprint: canonical JSON v1

`src/core/rng/fingerprint.ts` (`FINGERPRINT_ALGORITHM = 'fnv1a32/canonical-json-v1'`):

- `null`, `true`/`false`, safe integers and strings as `JSON.stringify` writes them;
- arrays in order; plain objects with keys sorted by UTF-16 code units; no whitespace;
- floats, `-0`, `NaN`, `undefined` values, `Map`, `Set`, class instances and every other type throw;
- the fingerprint is FNV-1a 32 over the canonical string's UTF-16 code units, as 8 lowercase hex digits.

`toString()` and plain `JSON.stringify` are not canonical (key order follows construction; floats print
long). The fingerprint catches any change; the summary tells the reviewer whether a user would notice.
32 bits is plenty for this job: the chance that a changed output keeps its fingerprint is 1 in 2^32
per row. Keep fingerprinted strings to plain text (ids, ASCII): an oracle in another language must
reproduce `JSON.stringify`'s escaping exactly.

## Which rows to pin

`check-golden-vectors.mjs` requires (rule `vectors-cover`):

- at least three rows, and at least one per version;
- for a date-keyed generator, for each cutover: the day before at the old version and the cutover day
  at the new version;
- for a date-keyed generator, a year-end and new-year pair (`2026-12-31`, `2027-01-01`) and a leap day
  (`2028-02-29`).

A text-keyed generator has no calendar boundaries; pin the shortest and longest code bodies, one body
at every version (a reviewer then sees what each version makes of the same code), and every character
class the codes use.

Also worth a row: the first key the feature ever served, a historical key users have already seen
(so a regression that rewrites the past fails loudly), and one row per mode or parameter band.
Rows are cheap; pick them for the bugs they would catch.

## The independent oracle

The expected values come from code that shares nothing with the implementation under test:

- written from the spec (the generator's comments, the draw-order table, the canonical JSON rules),
  not by copying the TypeScript;
- in another language (Python) or another style: the template's `scripts/oracles/<feature>-oracle.ts`
  uses BigInt arithmetic where the app uses 32-bit integer tricks, a different loop shape, and a
  hand-written canonical JSON for its one output shape;
- importing nothing from `src/`, directly or through a helper it imports (the checker follows every
  local import, tsconfig alias and workspace package, never `node_modules`), and not reading the
  generator's source (rule `oracle-independent`). In a workspaces repo, keep it off the repo's shared
  packages too: the checker runs once per app and treats only the app's own `src/` as app code, so
  an oracle and a generator that both import `@acme/shared` pass while sharing its bugs;
- carrying its own copy of the data tables (catalog, salt): a typo in the app's catalog then shows up
  as a mismatch instead of being copied into the expected values.

When a second implementation seems impossible (a solver that takes an hour), write a slow brute-force
oracle that only handles the small keys you pin, or compute small rows by hand and say so in the row's
`note`. Never point `oracle` at the generator (the checker rejects it): rows produced by the
implementation under test prove "nothing changed", never "this is right".

## Filling rows: the update script

`scripts/oracles/update-<feature>-vectors.ts` is the only writer of the vectors file:

1. Add a row by hand with `key`, `version` and `note`.
2. Run `node scripts/oracles/update-<feature>-vectors.ts` from the repo root.
3. It fills the missing `fingerprint` and `summary` from the oracle and **refuses to change a filled
   row**: if the oracle disagrees with a committed row it prints `changed row refused: …` and exits 1.
   A shipped output never changes; a change is a new version (`versioning-and-regeneration.md`).
   The script cannot see a row whose values were deleted first, so `check-golden-vectors.mjs` holds
   the line: every filled row of the committed vectors file (git `HEAD`, or the base branch in CI)
   must still be there with the same fingerprint and summary (rule `vectors-frozen`).
4. Read the diff: only new rows. Commit with the `Gate-Change:` trailer git-commits-and-reporting
   defines. The canonical `quality-gates.json` already lists `**/*.vectors.json` and
   `contracts/seeded-generators.json` in `gatedPaths`; keep both there (quality-gates owns the list).
   Vectors inside installed agent skill folders stay ungated.

## Before the first release: replacing the template rows

The template ships seven filled rows so that its tests and both checkers pass the moment it is
copied. Those rows belong to the template salt (`0x2f6b4c1d`) and catalog (`item-01 … item-12`).
When you set the feature's own salt and catalog, the update script refuses every one of them
(`changed row refused: …`, exit 1) and `vectors-match` fails, which is right: they are no longer the
feature's output. Before the generator first ships, and only then:

1. Set the new salt in the generator, in the oracle and, in decimal, as the contract's `salt`; set the
   new catalog in the generator and the oracle; replace the generator test's `/^item-\d{2}$/` id check.
2. In `<feature>.vectors.json`, delete each row's `fingerprint` and `summary`; keep `key`, `version`
   and `note`. Add the rows the feature needs.
3. Run `node scripts/oracles/update-<feature>-vectors.ts`, read the summaries, run the tests and both
   checkers.

This refill passes `check-golden-vectors.mjs` even after the template rows were committed, because
the checker exempts exactly the template's seven rows (and the template salt) while every committed
row is still one of them. Until both are replaced it prints a reminder:
`<id>: template values still in use (...)`. From then on a committed row is never refilled: the
update script's refusal or a `vectors-frozen` failure means a shipped output changed, and the fix is
to restore the version that made it. (A row committed but never released can be changed by comparing
with the last release; checkers.md, "Before anything shipped".)

## CI verifies, never blesses

Two Jest tests run on every `npm test`:

- `src/features/<feature>/<feature>-vectors.test.ts`: the generator reproduces every row (rule
  `vectors-test` requires it);
- `scripts/oracles/<feature>-oracle.test.ts`: the oracle agrees with every committed row, so a hand
  edit of the JSON fails too.

No CI job, git hook, agent hook or gate script (`test`, `verify`, `check:*`, `prepare`, …) runs the
update script (rule `no-auto-bless`), whether it names the command, calls the package script with any
runner (`npm run`, `pnpm`, `yarn`, `bun`, `npx --no --`), or reaches it through another package script.
That covers EAS Workflows (`.eas/workflows/*.yml`, Expo's own CI) next to GitHub Actions and the other
common CI files, and the git hooks kept in `package.json` (`simple-git-hooks`, `lint-staged`, husky 4's
`husky.hooks`) next to lefthook and `.husky/`; `references/checkers.md` lists every file the checker
reads. A pipeline that regenerates its own expectations passes by construction. An oracle in another
language runs in CI in its verify mode (`python3 scripts/oracles/<feature>-oracle.py`), never with
`--fill`.

## Reading a vectors diff

- A changed `fingerprint` in a pull request that was meant to be a refactor is a defect until proven
  otherwise. Ask which draw moved: a reordered loop, an extra `nextInt`, a catalog edit, a changed
  salt, a different `seeded-draws` helper.
- A changed row is never fixed by editing the JSON or re-running the update script with the row's
  values deleted (`vectors-frozen` fails both against the committed rows). Restore the version that
  made it; ship the improvement as a new version.
- A deleted row is a change too: the row was the proof that the shipped output still reproduces.
- A new row with a surprising summary (`item-01` three days running) is worth a look at the seeding:
  an unmixed seed shows up exactly like that.

## Labels over metrics

When generated content carries a label (difficulty, size class, "busy day"), separate the two:

- the **metric** is computed (a solver's move count, an item count) and pinned in the row's summary;
- the **label** is a frozen threshold table over the metric (`[0, 8) easy, [8, 15) medium, …`).

Test that the mapping is monotonic (a higher metric never maps to an easier label) and pin the
thresholds. A calibration is measured, never "proven"; and content that shipped is never re-labelled,
because a user who was told "hard" was told that. A new table is a new version.

## A Python oracle for a generator

The same oracle in another language, using the core functions from the oracle in
`seeded-rng-and-seeds.md` (this one computed the template's rows on 2026-10-03; the TypeScript oracle
and the generator agree with it). `examples/starter-pack-share-code/starter-pack-oracle.py` is the
complete form: its own core functions, a verify mode for CI and a `--fill` mode that fills new rows
and refuses to change a filled one (its contract entry names
`"regenerate": "python3 scripts/oracles/starter-pack-oracle.py --fill"`).

```python
import json
SALT = 0x2F6B4C1D
CATALOG_V1 = ['item-%02d' % i for i in range(1, 13)]

def draw_sample(items, count, state):                    # partial Fisher-Yates from the front
    out = list(items)
    for i in range(count):
        j, state = next_int(state, len(out) - i)
        out[i], out[i + j] = out[i + j], out[i]
    return out[:count]

def canonical(value):                                    # canonical JSON v1 for this output shape
    keys = sorted(value)                                 # ASCII keys: code-unit order
    return '{' + ','.join(json.dumps(k) + ':' + json.dumps(value[k], separators=(',', ':')) for k in keys) + '}'

def row(key, version, note):
    ids = draw_sample(CATALOG_V1, 3, seed_rng(daily_seed(key, SALT)))
    out = {'key': key, 'version': version, 'itemIds': ids}
    return {'key': key, 'version': version, 'fingerprint': '%08x' % fnv1a32(canonical(out)),
            'summary': ' '.join(ids), 'note': note}

print(json.dumps(row('2026-09-26', 1, 'historical key users have seen'), indent=2))
```
