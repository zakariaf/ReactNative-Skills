# The checkers

Both scripts are zero-dependency Node (22.18 or newer, verified on 2026-10-03 with Node 26.4; re-verify
with `node --version`), take the repo root as an optional positional argument, print one
`FAIL <file>:<line> [<rule>] <message> Fix: <fix>` line per problem and end with `RESULT: PASS` or
`RESULT: FAIL (<n> problems)`. Exit 0 pass, 1 problems, 2 bad input.

## Contents

- How the runtime checks load app code
- check-determinism.mjs
- check-golden-vectors.mjs
- The contract: contracts/seeded-generators.json
- What is committed is frozen; new cutovers start in the future
- Layout and options
- When multi-package
- Expected SKIP and NOT APPLICABLE lines, and notes
- Troubleshooting

## How the runtime checks load app code

Both checkers import the app's TypeScript directly with Node's type stripping and a module hook that
resolves `tsconfig.json` `paths` (`@/*`), extensionless imports and platform files. Only pure modules
load: a module that imports React Native, Expo, a store or a service fails to load, which is exactly
the purity a seeded module needs (rule `generator-pure`). `.tsx` files cannot load. Nothing is
compiled or bundled; no `node_modules` package is needed for the core or a pure generator.

## check-determinism.mjs

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-determinism.mjs . [--core-dir src/core] [--contract <file>] [--path <glob>]...
```

| Rule | What it proves |
|---|---|
| `rng-golden` | `src/core/rng/sfc32.ts` matches the PractRand reference for 50 draws, the seeding of five seeds, FNV-1a, the murmur3 finaliser, unbiased `nextInt` (rejection path included), `nextUnit`, every pinned golden, and keeps its `'worklet'` directive |
| `draws-golden` | `seeded-draws.ts` draws the pinned results and consumes exactly the documented draws, in order, for lists of 1 to 12 items |
| `fingerprint-golden` | `fingerprint.ts` gives the pinned fingerprints, sorts keys by code unit and rejects floats, `-0`, `NaN`, `undefined` and non-plain objects |
| `date-key-golden` | `date-key.ts` gives the pinned day numbers and weekdays, the leap-year boundaries, `NaN` for malformed keys, and agrees with `Date.UTC` from 1900 to 2400 |
| `daily-seed-golden` | `daily-seed.ts` gives the five pinned seeds and agrees with FNV-1a for 40 days and six salts |
| `golden-pins` | each present core module has its test, and the test pins the golden values as literals in code (a value left only in a comment pins nothing) |
| `wall-clock` | no `Date.now`, `new Date`, `Date()`, `Date.parse`, `Date.UTC`, `performance.now` or clock-service import on a seeded path; test files there may build fixed instants with `Date.UTC(…)` and `new Date(<arguments>)` |
| `ambient-random` | no `Math.random`, called or destructured (`const { random } = Math`); no `getRandomValues`/`getRandomBytes`/`randomUUID`/`randomBytes`/`randomInt`/`randomFill` on any object named `*crypto` (`crypto`, `QuickCrypto`, expo-crypto's `Crypto`); no `expo-crypto`, `expo-random`, `react-native-quick-crypto`, `react-native-get-random-values`, `uuid` or `nanoid` (subpaths such as `nanoid/non-secure` included), loaded by `import`, `import()` or `require()` |
| `foreign-prng` | no PRNG package (`seedrandom`, `pure-rand`, `random-js`, `chance`, faker, `fast-check` outside tests), by `import`, `import()` or `require()` |
| `inexact-math` | no implementation-approximated `Math` function (`sin`, `exp`, `log`, `pow`, `hypot`, … 22 in all) and no `**`; an exactly specified member outside the shared allow-list (`ceil`, `trunc`, `sign`, `fround`, `clz32`, the constants) gets its own message with a rewrite, because the ESLint `DETERMINISTIC` block keeps the same list; destructuring (`const { exp } = Math`) counts (tests exempt) |
| `locale-dependent` | no `Intl.*`, `toLocale*` or `localeCompare` (tests exempt) |
| `unmixed-seed` | no `dailySeed(...)`/`hashSeed(...)` value, or a variable holding one, used with `%`, `&`, `>>` or `/` |
| `contract-paths` | every generator `module` in the contract exists under the root and every `"paths"` glob matches a file; otherwise the scan would silently skip that code |

Seeded paths: `<core>/rng/**`, `<core>/dates/**`, `<src>/games/*/{rules,levels,sim,geom}/**`, the
contract's `"paths"`, each generator module, every `--path`, and **every local file a seeded file
imports**, at any depth. The scan follows value imports, re-exports, `import()` and `require()`
through relative paths, `tsconfig.json` `paths` aliases and workspace packages (when the root is one
app of a workspaces repo, also that repo's other packages; see "When multi-package"), never into
`node_modules`; a type-only import (`import type`, `typeof import(…)`) loads nothing and is not
followed. A file reached this way is scanned with the full rules and each problem names the chain:
`(reached from src/features/daily-focus/daily-focus-generator.ts via src/features/daily-focus/daily-focus-weights.ts -> src/lib/easing.ts)`.
The walk uses the shared ignores (node_modules, native folders, build output) and skips every folder
that holds a `SKILL.md`, so installed skills and their planted fixtures stay silent. Nothing seeded at
all is exit 2.

## check-golden-vectors.mjs

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-golden-vectors.mjs . [--contract <file>] [--generator <id>]... [--committed-ref <ref> | --committed-dir <dir>] [--today YYYY-MM-DD]
```

| Rule | What it proves |
|---|---|
| `contract-shape` | each generator entry has the keys below with the right types; ids are unique kebab-case |
| `generator-pure` | the module is a `.ts` file that loads in plain Node and exports the functions and constants the contract names; `generate` is synchronous |
| `salt-frozen` | the exported salt equals the recorded salt, no two generators share a salt, and the recorded salt equals the committed contract's (the template salt excepted while the committed rows are the template's) |
| `version-cutover` | the recorded table is 1..n with version 1 `from: null`; a date-keyed table has strictly later civil-date cutovers, a text-keyed one `from: null` everywhere; the code's table equals the record; a date row's key routes to the version the table gives and the output stamps it; a text row generated with its version stamps it, and a call without a version throws or returns the version the key carries (never the newest); every committed version is still there with the same `from`, and the key kind is unchanged; every committed generator is still registered (a rename is compared, a removal needs a `"retired"` entry); a cutover appended since the committed contract starts after today |
| `vectors-file` | the vectors file exists, names the generator, the fingerprint algorithm and its oracle, and every row has a real key, a known version, 8 hex digits, a summary and a note |
| `vectors-match` | each row's output, fingerprinted by the checker's own canonical JSON, and its summary, equal the row |
| `vectors-frozen` | every filled row of the committed vectors file is still there with the same fingerprint and summary, however the current rows were refilled (the template's seven rows excepted) |
| `vectors-cover` | 3+ rows, a row per version, both sides of each cutover, a year-end/new-year pair, a leap day |
| `repeatable-run` | the same row twice, and again after another key ran, gives identical output |
| `runtime-ambient` | while the generator or its `summarize` runs, nothing calls `Math.random`, `Date`, `performance.now`, `crypto`, `Intl`, `localeCompare`, `toLocale*` or an implementation-approximated `Math` function (`exp`, `sin`, `pow`, … the same 22 as `inexact-math`). Traps are installed for each call and removed after it; the checker's own canonical JSON and fingerprints run outside them. Catches code no text scan reads: a package from `node_modules`, a function passed in. `**` is an operator and cannot be trapped; check-determinism sees it |
| `oracle-independent` | `oracle` is a repo-relative file path (not a command), the file exists and is not the generator; a script oracle imports nothing from `src/`, directly or through any local file it imports (relative, tsconfig alias or workspace package; the chain is printed), and neither it nor those files read the generator's source |
| `vectors-test` | a test beside the generator imports the vectors file and runs the generator |
| `outcome-version` | the outcome file the contract names contains the version field (SKIP until it exists) |
| `no-auto-bless` | nothing that runs unattended runs the regenerate command: gate scripts (`test`, `verify`, `check:*`, `prepare`, `post*`, `eas-build-*`, …); EAS Workflows (`.eas/workflows/*.yml`, Expo's own CI) and `eas.json`; GitHub workflows and composite actions, GitLab CI, CircleCI, Bitrise, Azure Pipelines, Buildkite, Bitbucket Pipelines, Codemagic, Travis, Jenkins; git hooks (lefthook, husky files, `.pre-commit-config.yaml`, the `simple-git-hooks`, `lint-staged` and husky 4 `husky.hooks` keys of `package.json` and their own config files); agent hooks (the `hooks` of `.claude/settings.json` and `.claude/settings.local.json`; a `permissions` entry that names the command runs nothing and is not flagged). By name, or through a package script that runs it, called with `npm`/`pnpm`/`yarn`/`bun` (with or without `run`), `npx --no --`, `npm-run-all`/`run-s`/`run-p` or `npm:<name>`, through any chain of scripts (the chain is printed); workspace flags count (`-w`/`--workspace`, `--prefix`, `--filter`, `-C`, `yarn workspace <name>`). In YAML files the values of file and branch filters (`paths:`, `branches:`, `tags:`, lefthook's `glob:`, pre-commit's `files:`/`exclude:`, GitLab's `changes:`) are not commands and are not read. Inside a workspaces repo the workspace root's files and scripts are read too |

## The contract: contracts/seeded-generators.json

```json
{
  "paths": ["src/features/daily-focus/catalogs/**"],
  "generators": [
    {
      "id": "daily-focus",
      "module": "src/features/daily-focus/daily-focus-generator.ts",
      "generate": "generateDailyFocus",
      "summarize": "summarizeDailyFocus",
      "keyKind": "date",
      "salt": 795560989,
      "saltExport": "DAILY_FOCUS_SALT",
      "versionsExport": "DAILY_FOCUS_VERSIONS",
      "versions": [{ "version": 1, "from": null }],
      "vectors": "src/features/daily-focus/daily-focus.vectors.json",
      "outcome": { "file": "src/data/daily-focus/daily-focus-outcome-repository.ts", "versionField": "generatorVersion" },
      "regenerate": "node scripts/oracles/update-daily-focus-vectors.ts"
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `paths` | extra globs of seeded helpers for `check-determinism` |
| `id` | kebab-case name, also the vectors file's `generator` |
| `module`, `generate`, `summarize` | the generator file, its `generate(key, version?)` export and an optional `summarize(output)` export |
| `keyKind` | `"date"` (routed by cutover dates) or `"text"` (a share code or typed seed: every version `from: null`, the caller passes the version the key carries; `examples/starter-pack-share-code/`) |
| `salt`, `saltExport` | the shipped salt (decimal; JSON has no hex) and the constant that holds it |
| `versions`, `versionsExport` | the recorded cutover table and the constant that holds it in code |
| `vectors` | the vectors file |
| `outcome` | `{ file, versionField }` of the stored outcome, or `null` when nothing is stored. The default `file` follows persistence-and-migrations' layout, `src/data/<feature>/<feature>-outcome-repository.ts` (the port that declares the outcome type); once the table exists, point it at whichever file declares the stored row |
| `regenerate` | the hand-run command that fills new rows (`node scripts/oracles/update-<feature>-vectors.ts`, or `python3 scripts/oracles/<feature>-oracle.py --fill`) |
| `$comment`, `note` | free text, ignored |

A top-level `"retired"` list records generators that were removed on purpose (versioning-and-
regeneration.md, "Retiring a version or a generator"):

```json
"retired": [
  { "id": "daily-focus", "migration": "src/data/migrations/0007-drop-daily-focus-outcomes.ts",
    "note": "Daily focus removed in 3.0; outcomes dropped by migration 7 (approved by the developer)." }
]
```

`id` is the removed generator (never reused), `migration` the file that drops or rewrites its stored
outcomes (`null` only when the committed entry stored none), `note` why and who approved it.

`"generators": []` declares an app with no seeded generator: the vectors checker prints NOT APPLICABLE
(unless the committed contract still registers a generator that is not retired). The contract is
app-owned data; the checkers stay strict and the facts live in the repo.

## What is committed is frozen; new cutovers start in the future

The checker compares the working tree with a **committed baseline**: by default the contract and each
vectors file at git `HEAD` (`git show HEAD:<path>`); `--committed-ref <ref>` names another revision,
and `--committed-dir <dir>` (relative to the root) a folder holding the app as committed, for a
checkout without git history. With no baseline (not a git repository, or no commit yet) it prints
`frozen checks: no committed baseline (...)` and these comparisons do not run; a contract or vectors
file the baseline does not hold yet (a new generator) has nothing frozen. Against the baseline:

- **Every committed generator is still registered.** An entry whose id is gone fails
  (`version-cutover`) unless the contract's `"retired"` list names it, with a migration file that
  exists whenever the committed entry stored outcomes. `"generators": []` does not hide a committed
  generator. A new id that keeps the committed entry's module, vectors file or salt is treated as a
  rename: a note says so, and the entry is compared with the committed one.
- **Its cutovers, key kind and salt are frozen.** Every committed version must still be there with
  the same `from` (`version-cutover`: "a committed cutover never moves or disappears"), the key kind
  must not change, and the salt must equal the committed one (`salt-frozen`). Moving a cutover into
  the past or deleting a version would otherwise pass as soon as code, contract and refilled rows
  agree, while keys users already saw switch versions on update.
- **Its committed rows are frozen.** Every filled row of the committed vectors file must still be in
  the vectors file with the same fingerprint and summary (`vectors-frozen`). Editing a catalog in the
  generator and the oracle together, deleting the affected rows' values and rerunning the update
  script leaves generator, oracle, rows and tests in agreement; only the committed rows still show
  what users saw.
- **The template is the one exception.** The template salt `795560989` may change, and the
  template's seven rows (template salt and `item-01 … item-12` catalog) may change or go, while every
  committed row is still a template row: that is Workflow step 6. Once a committed row is anything
  else, the template salt is frozen like any other. The checker cannot tell whether a template
  generator has shipped, so it prints `<id>: template values still in use (...)` as long as the salt
  or the catalog is the template's.
- **A version it does not record yet starts in the future.** A version appended to a date-keyed
  generator fails when its `from` is on or before `--today` (default: the machine's local date), or
  devices that already showed a key would show something else after the update.

Before a commit, `HEAD` is the base, so the default catches all of this on the developer's machine. In
CI the checked-out commit already holds the change; fetch the base branch and compare with it:

```sh
git fetch --depth 1 origin main
node ${CLAUDE_SKILL_DIR}/scripts/check-golden-vectors.mjs . --committed-ref origin/main
```

Only edits are flagged: a committed version is never rechecked against today, so time passing never
turns a planned cutover into a failure. A text-keyed generator has no cutover dates, so the today rule
does not apply to it; its committed versions, salt and rows are frozen all the same.

**Before anything shipped.** Committed is not always released: a row or cutover committed last week may
never have reached a user. To change one that no released build has served, compare with the last
release instead (`--committed-ref <release-tag>`); when nothing has been released, with the commit
before the generator was registered (`git log --reverse --format=%H -S '"id": "<id>"' -- contracts/seeded-generators.json | head -n 1`
names the commit that added it; pass `<hash>~1`, or, when that commit has no parent, `--committed-dir`
an empty folder, and the run says that nothing was compared). Say why in the `Gate-Change:` trailer.
Never use this to change what a release served: that output is what the key means.

## Layout and options

Paths come from check-lib's `resolveLayout`: `src/` and `contracts/` by default, moved by an optional
`rn-skills.config.json` at the repo root (`srcDir`, `coreDir`, `contractsDir`; `coreDir` defaults to
`{srcDir}/core`) and by `tsconfig.json` `paths` for aliases. `--core-dir` and `--contract` override per
run. Neither checker reads any other key of `rn-skills.config.json`.

## When multi-package

Run each checker once per app, with the app folder as the root:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-determinism.mjs apps/mobile
node ${CLAUDE_SKILL_DIR}/scripts/check-golden-vectors.mjs apps/mobile
```

The contract's paths (`module`, `vectors`, `outcome.file`, `paths`) are relative to the app folder
that holds `contracts/`, and the app's own `tsconfig.json` aliases (`@/*`) resolve from there. Do not
run from the repo root with `--contract apps/mobile/contracts/…`: the paths would resolve against the
repo root. check-determinism then reports `contract-paths` for every module and glob it cannot find,
and check-golden-vectors reports the missing module and vectors file.

The checkers find the workspaces repo around the app folder (the nearest parent `package.json` whose
`workspaces` list it) and look past the app folder where it matters:

- **check-determinism** follows a seeded file's imports of the repo's other packages
  (`import { rankWeight } from '@acme/shared'`) into them and scans what it reaches with the full
  rules, labelled relative to the app folder: `FAIL ../../packages/shared/src/easing.ts:3 [inexact-math] …`.
  A package's own `tsconfig.json` aliases are not read; use relative imports inside packages.
- **check-golden-vectors** reads the workspace root's CI files, git hooks, agent hooks and
  `package.json` scripts and hooks for `no-auto-bless` as well as the app's, so
  `npm run vectors:update --workspace apps/mobile` in a root workflow, or
  `npm --prefix apps/mobile run vectors:update` in a root `.husky/pre-commit`, fails.
- The committed baseline is read with `git -C <app folder>`, so `HEAD` and `--committed-ref` work the
  same from inside a workspace.

The templates put the core inside the app (`apps/mobile/src/core/`). If an app moves it into a shared
package, also run check-determinism on that package, with the package folder as the root
(`check-determinism.mjs packages/core --core-dir src`), so its goldens are checked where it lives.

## Expected SKIP and NOT APPLICABLE lines, and notes

- `SKIP src/data/<feature>/<feature>-outcome-repository.ts [outcome-version] not yet created (persistence-and-migrations creates it)`:
  the outcome table is not written yet. A pass; the definition of done lists it.
- `NOT APPLICABLE: contracts/seeded-generators.json declares no seeded generators ("generators": [])`.

Notes are informational lines; they never change the result:

- `frozen checks: no committed baseline (...)`, `frozen checks: <path> does not exist (...)`: nothing to
  compare with (no git, or not committed yet). In CI, make sure the baseline is fetched.
- `<id>: template values still in use (...)`: Workflow step 6 is not done; it must be before the first
  release.
- `<id>: compared with <old id> in <baseline> (same module): treated as a rename`.
- `<id>: retired (<note>); <baseline> still records it`.

## Troubleshooting

| Output | Cause and fix |
|---|---|
| `[generator-pure] cannot be imported in plain Node … Cannot find package 'react-native'` | the generator imports a platform module; move the platform read to the caller and pass the value in |
| `[generator-pure] … ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` | a pure module imports TypeScript from `node_modules`; seeded code imports only `src/core` |
| `[runtime-ambient] … called Date.now` (or `Math.exp`) but check-determinism is clean | code no text scan reads made the call: a package from `node_modules`, a function passed into the generator, a module loaded by a computed path; pass the value in, or replace the package with the seeded core |
| `[inexact-math] … (reached from <generator> via a -> b)` | a helper the generator imports, not a seeded path itself, uses inexact maths; fix it there (integer tables, `+ - * /`, `sqrt`), or stop importing it |
| `[contract-paths] the generator module … does not exist under the root` | a typo, a renamed file, or the checker run from another folder than the app's; run it with the app folder as the root |
| `[version-cutover] version 2 now starts …, but … records …` or `… is gone` | a committed cutover was edited; restore it and append a new version with a future date (to cancel a cutover no release shipped, compare with the last release: `--committed-ref <release-tag>`) |
| `[version-cutover] generator <id> recorded in … is gone` | a committed generator's entry was deleted or renamed away; restore it, or (feature removed, migration written, developer approved) add a `"retired"` entry |
| `[vectors-frozen] <key> at version <n> was … and is now …` or `… is gone from the rows` | a committed row was refilled or deleted; restore the generator version and oracle that made it and put the row back; ship the change as a new version |
| `[salt-frozen] the salt is …, but … records the shipped salt …` | a committed salt changed in code and contract together; restore it (a new salt is a new version) |
| `[vectors-match]` after a refactor | a draw moved; restore the version (never refill the row) |
| `[vectors-match]` on every template row after setting your own salt | expected before the first release: delete the rows' `fingerprint` and `summary` and refill them with the update script (golden-vectors.md, "Before the first release") |
| `[oracle-independent] the oracle reaches src/… through a -> b -> src/…` | a helper the oracle imports re-exports app code; copy what the oracle needs into it, written from the spec |
| `[oracle-independent] "oracle" is a command` | name the oracle's file (`scripts/oracles/<feature>-oracle.py`); the command belongs in `regenerate` |
| `[version-cutover] … on or before today` | the new version's cutover has passed or is today; pick a date at least one release cycle ahead (versioning-and-regeneration.md) |
| `[wall-clock] new Date without arguments reads the clock` in a test | the test reads the real date; build the instant from fixed values (`new Date(Date.UTC(2026, 8, 26))`) |
| `ERROR [bad-input] nothing to check` | no seeded code at the default paths; copy the templates or pass `--path` / `--core-dir` |
