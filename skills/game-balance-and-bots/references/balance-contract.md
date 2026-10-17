# The balance contract: report, fingerprint and bands

A game is "balanced" when its latest sim report satisfies its bands file. This reference defines both
files, how the report is tied to the code it measured, and how bands are set and approved.

## Contents

- The sim report
- The fingerprint
- The bands file
- Endless mode
- Setting bands from the first run
- Approval: a human check that never blocks
- How the check judges

## The sim report

`reports/sim/<game-id>.json` (git-ignored with the rest of `reports/`; written by the sim in
`beforeAll`; identical bytes on a rerun). A cell of the Pig example's report:

```json
{
  "policy": "holdAt20",
  "difficulty": 0,
  "runs": 100,
  "wins": 84,
  "capHits": 0,
  "winRate": 0.84,
  "medianMoves": 18,
  "p10Moves": 12,
  "p90Moves": 25,
  "medianScore": 41,
  "payoffPerRun": 13.79,
  "twistPerRun": 1.91,
  "lossReasons": { "pig.lose.bust-streak": 10, "pig.lose.out-of-turns": 6 },
  "firstPayoffShare": [0.88, 0.98, 1, 1, 1, 1, 1, 1, 1, 1]
}
```

The file around the cells holds `gameId`, `rulesFingerprint`, `seedsPerCell` and `maxMoves`.

| Cell field | Meaning |
|---|---|
| `runs`, `wins`, `winRate` | Runs played (one per seed), runs won, their share (4 decimals) |
| `capHits` | Runs still playing at `maxMoves`: a stuck or endless game. Must be 0. |
| `medianMoves`, `p10Moves`, `p90Moves` | How long runs last (moves; ticks for real-time games). p10 catches levels that end absurdly early. |
| `medianScore` | The game's score (`scoreOf`: the number the HUD and the result screen show) at the end of a run |
| `payoffPerRun`, `twistPerRun` | Average number of payoff and twist events per run |
| `lossReasons` | Lost runs by the outcome's reason key, one `<game-id>.lose.<reason>` per way of losing (sorted keys) |
| `firstPayoffShare[k-1]` | Share of runs whose first payoff happened at or before move k, k = 1…10 (real-time games: within k seconds, `payoffStepTicks` in bots-and-sims.md) |

Percentiles use the lower-interpolation rule (`sorted[floor(p/100 × (n-1))]`), so they are always a
real run's value.

## The fingerprint

`rulesFingerprint(gameId)` is a sha256 over every source file that can change a bot result, sorted by
repo-relative path, each hashed as `"<path>\n<bytes>\n"` (`fingerprintFiles(gameId)` lists them):

- `src/games/<id>/rules/**`, `levels/**` (except the generated `levels/pack-*.json`), `sim/**`,
  `geom/**`, `testing/**`
- `test/sims/<id>/**`
- the files of `src/core` that those files import, followed through the core's own imports (a source
  scan of every `from '…'` and `import '…'` specifier, through the `@/` alias or a relative path,
  resolved like TypeScript: as written, `.ts`, `.tsx`, `/index.ts`). That is the sim's import
  closure: the PRNG, the kit, the balance harness, and any core geometry or fixed-step code the rules
  and sims really use.

Core files nothing in the closure imports do not count. Later build steps add core files the sims
never reach (canvas helpers, particles, a level-table type), and the report stays fresh; once a rules
or sim file imports one of them, it joins the fingerprint (fixtures `pass-core-growth` and
`bad-core-import-changed`).

`.ts`, `.tsx` and `.json` files count; unit tests (`*.test.ts`) and snapshots do not; sim files
(`*.sim.test.ts`) do, because they choose seeds and players; `balance-bands.json` does not, so
changing or approving a band never makes the report stale.

The level tables `src/games/<id>/levels/pack-*.json` do not count either. They are outputs, not
inputs: level-generation-and-solvers writes them from the rules and the level plan, and the bots never
read them. The build order runs the sims first and generates the tables after them, so the report
stays fresh when the tables appear. Everything else in `levels/` (the plan, the solver, the table
file) still counts, so a change there, or in `rules/`, after the tables were generated makes the
report stale (fixtures `pass-packs-after-sims`, `bad-rules-changed-after-report` and
`bad-level-plan-changed-after-report`). A tuning change regenerates the tables and reruns the sims in
the same commit.

`check-balance.mjs` recomputes the fingerprint with an independent JavaScript port and fails with
`report-stale` when it differs: the numbers describe code that no longer exists. Rerun
`npm run test:sim`. The writer's folders (`SIM_LAYOUT` in `test/sims/write-sim-report.ts`) and the
checker's (`gamesDir`, `coreDir`, `simsDir` in `rn-skills.config.json`) must agree.

The fingerprint only protects what it covers, so game logic must not reach outside it: a value import
from a file in those five folders to anywhere else in the app (`../canvas/`, `@/games/<id>/words/`,
`@/services/…`, `@/stores/…`) fails `fingerprint-scope`. Keep word lists, tables and generators under
`rules/` or `levels/`; the clock and storage reach the game through the host, never through the
rules. Type-only imports are fine (they cannot change a number).

## The bands file

`test/sims/<game-id>/balance-bands.json`:

| Field | Meaning |
|---|---|
| `gameId` | The game folder name |
| `status` | `"proposed"` until a person has play-tested and accepted the numbers, then `"approved"` |
| `approvedOn` | `"YYYY-MM-DD"` when approved, else `null` |
| `seedsPerCell` | Runs per cell; at least 100 (the check refuses fewer) |
| `maxMoves` | The move cap for every run (ticks for real-time games) |
| `grid` | Policy → level difficulties to run (whole numbers 0..99; the lower bound of each tuning row), e.g. `{ "random": [0,25,50,75], "holdAt20": [0,25,50,75], "lookahead": [25] }` |
| `bands[]` | `{ policy, difficulty, metric, min, max, why }`: a number that must stay inside `[min, max]`; `why` says in plain words what it protects |
| `curve` | `{ policy, metric, direction: "up" \| "down", minStep }`: along the policy's difficulties, the metric moves in `direction` by at least `minStep` per level |
| `skillGap` | `{ difficulty, metric, order: [...policies], better: "higher" \| "lower", minStep }`: each policy in `order` beats the previous one by at least `minStep` |
| `firstPayoff` | `{ policy, difficulty, withinMoves (1-10), minShare }`: the kill test (fun-and-kill-test.md); seconds for real-time games |
| `twist` | `{ policy, difficulty, minPerRun }`, or `null` for a game with no twist event |
| `endless` | Only for a game with an endless mode: `{ policy, difficulty: 100, bands: [{ metric, min, max, why }] }` (next section); absent or `null` otherwise |
| `notes` | Plain words for the reviewer: where the numbers came from and why |

Metrics a band, curve or gap may use: `winRate`, `medianMoves`, `p10Moves`, `p90Moves`, `medianScore`,
`payoffPerRun`, `twistPerRun`. Every policy and difficulty a rule names must be in the grid.

Good defaults for a game with runs of a minute or a few: the reasonable player wins 60-90 % of the
easiest level and 8-50 % of the hardest; random wins at most about half of the easiest ("naive play
should lose"); the reasonable player's win rate drops by at least 0.1 per row (0.08 when the measured
steps are close to 0.1); random < reasonable < lookahead by a clear win-rate step at the second row;
the first payoff within 3 moves (a placement or a press) or 2 moves (a single tap such as a roll) in 90
% of reasonable runs on the easiest level; at least one twist per reasonable run. The template file
holds the template game's own measured bands (Lights Out, three rows sampled at 0/34/67: a short
puzzle whose first row is a warm-up a reasonable player always wins, 0.9-1.0); a new game sets every
band from its own first run. For a game whose levels are never won (a pure score game), use
`medianScore` or `medianMoves` for the curve and the gap instead of `winRate`.

## Endless mode

A game with an endless mode plays it as `create(freshSeed, 100)`: the tuning's endless row, never won,
only survived. Its win rate is 0 by definition, so it must never be a step of the win-rate curve: put
100 in the grid and the curve silently gains a last step "down to 0", which hides a cliff and says
nothing about the endless run.

So the grid lists level difficulties only (0..99), and the endless run gets its own block (the Pig
example's):

```json
"endless": {
  "policy": "holdAt20",
  "difficulty": 100,
  "bands": [
    { "metric": "medianMoves", "min": 45, "max": 100, "why": "An endless run outlasts a level (median 70 rolls measured) and still ends." },
    { "metric": "medianScore", "min": 90, "max": 180, "why": "A reasonable endless run banks more than any level target (median 132 measured)." },
    { "metric": "twistPerRun", "min": 4, "max": 10, "why": "Busts keep biting in the endless run (7.01 per run measured), so pushing your luck stays a choice." }
  ]
}
```

- The sim plays the grid, then this one extra cell (`policy` at difficulty 100), and writes it into
  the same report; the template sim already does so when the block exists.
- The endless bands judge how long a run lasts (`medianMoves`, `p10Moves`, `p90Moves`), how far it
  gets (`medianScore`) and whether the twist still matters (`twistPerRun`, `payoffPerRun`); never
  `winRate`. Every endless run must still end (no cap hits): pressure rises, or a budget runs out,
  until the run is lost (Pig: 20 turns).
- `check-balance.mjs` validates the block (`difficulty` 100, a grid policy, band fields;
  `bands-invalid`), refuses 100 inside the grid, reports a missing endless cell
  (`report-cell-missing`), capped endless runs (`cap-hit`), a won endless run (`endless-won`) and a
  band outside its range (`band-violated`).

## Setting bands from the first run

1. Copy the template bands, keep `status: "proposed"`, and run `npm run test:sim` once. The band
   assertion may fail; the report is written anyway.
2. Read every cell (`cat reports/sim/<id>.json`). First fix what is broken, not what is unbalanced:
   cap hits, a replay difference, a first payoff that never comes, a twist that never happens.
3. Tune the game (tuning-playbook.md) until the curve and gap hold and the numbers match the game's
   intent (a calm puzzle wins more; a siege loses more).
4. Write the bands around the final numbers with a margin that allows small rule changes (about ±0.1
   on rates, ±25 % on move counts), each with a `why`, and write `notes` in plain words: what the
   first run showed, what changed, what the numbers now are.
5. Rerun: the sim and `check-balance.mjs` pass.

Never widen a band, lower `minStep`, cut `seedsPerCell` or edit the report to make a check pass. A
band changes only when the game's intent changes, and then the reviewer hears about it (the bands file
is the design record of the game's difficulty).

## Approval: a human check that never blocks

Bots measure pace, not joy, so a person's play-test is the final judge, but it is a human check, not a
gate: nothing waits for it. Tell the reviewer, in the evidence report, what the bots found per level
in plain words (bots-and-sims.md, "Reporting the numbers") and ask for a play-test of the first levels
on an iPhone and an Android phone (touch, screen size and, for real-time games, refresh rate differ).
Until it is done, every report lists "Play-test <game> on an iPhone and an Android phone" under
"Human checks (not blocking)" (git-commits-and-reporting), and `check-balance.mjs --release` passes
with proposed bands, printing `HUMAN CHECK (not blocking) … [bands-unapproved]` for the release report
instead of a problem. When the person agrees the pace feels right, set `"status": "approved"` and
`"approvedOn"`. If the play-test disagrees with the bots ("level 1 is too easy"), the person wins:
retune toward their feel and move the bands with them.

## How the check judges

`check-balance.mjs` reads the report and the bands with its own JavaScript port of
`parseBands`/`bandProblems`, so a bug in the TypeScript harness cannot hide a failure. It checks, per
game: the report exists and has the right shape, its fingerprint matches the code, it ran the bands'
seeds and cap, every grid cell exists without cap hits, and every band, the curve, the skill gap, the
first payoff and the twist hold; with an endless block, the endless cell exists, is never won, has no
cap hits and stays inside its own bands. Each problem line names the file and line (the band in the
bands file, or the cell in the report) and the fix.
