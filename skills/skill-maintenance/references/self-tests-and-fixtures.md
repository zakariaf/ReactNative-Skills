# Self-tests and overlay fixtures

How a skill proves its checkers: `scripts/selftest.mjs` runs each checker over planted-bug cases with check-lib's `runSelftest`, and each case is a small overlay on a shared base instead of a full copy of a repo. Read this when writing a checker's cases, when a fixture goes stale, or when the fixture budget fails.

## Contents

- The self-test
- Case kinds
- The overlay format
- SUITE.json and base layers
- mutation.json ops
- Patterns that work
- Hygiene, secrets and budget
- Debugging a case

## The self-test

```js
#!/usr/bin/env node
// scripts/selftest.mjs
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-routes.mjs', fixtures: '../tests/fixtures/check-routes', args: (dir) => [dir] },
  { script: 'check-copy.mjs', fixtures: '../tests/fixtures/check-copy', args: (dir) => [dir, '--strict'] },
]);
```

For each suite it checks that `--help` exits 0 with `Usage:`, then runs the checker once per case folder with the assembled case as the working directory; `args(dir, context)` builds the arguments. Several checkers: one suite folder each (`tests/fixtures/<checker>/`). When every good, pass and bad case of a run stops with the same exit-2 error, the self-test reports the environment once (a package is not installed) instead of one failure per case.

Command line: `node scripts/selftest.mjs [--case <glob>]... [--materialize <dir>]`.

## Case kinds

| Folder | Must | `EXPECT.txt` |
|---|---|---|
| `good/` | exit 0, last line `RESULT: PASS` | optional |
| `pass-<case>/` | exit 0 and print every line of EXPECT.txt | required: what a passing run prints (a SKIP line, a NOT APPLICABLE fact, the variant it picked) |
| `bad-<case>/` | exit 1 and print every line | required: the rule id (`[rule-id]` or on its own line) and `file:line` of the planted bug |
| `error-<case>/` | exit 2 and print every line | required: the `ERROR [bad-input] ...` text |

- **One planted bug per rule.** Every rule of a checker has a `bad-*` case that fails for that rule; a suite with no `bad-*` case fails (a check that has only ever passed proves nothing). A case that plants two related bugs lists both rules.
- **EXPECT names the rule.** An EXPECT that says only `FAIL` passes on any failure, a crash included; `check-skill.mjs` (`expect-rule-id`) rejects it.
- An optional `ARGS.txt` (words; `{dir}` is the case folder) replaces the suite's arguments for that case, for every case kind in an overlay suite. The file name is matched exactly.

## The overlay format

A suite is assembled when it holds a `SUITE.json` (or a `base/` folder). Each case then holds only what differs from the base:

```
tests/
  bases/app/                      optional shared base trees
  fixtures/check-routes/
    SUITE.json                    { "base": "good" }
    good/                         a complete small tree (or only EXPECT.txt when the base is the templates)
    bad-route-fat/
      EXPECT.txt                  [route-thin] src/app/(tabs)/index.tsx:4
      mutation.json               ordered ops on the base
    bad-missing-layout/
      EXPECT.txt
      DELETE.txt                  src/app/_layout.tsx
    pass-no-router/
      EXPECT.txt                  NOT APPLICABLE: expo-router is not in package.json
      overlay/package.json        a file copied over the base at its path
```

Assembly order per case: the start tree (the base layers plus suite `ops`, or the assembled `extends` case), then `DELETE.txt` (each path must exist), then overlay files (loose files and `overlay/`), then `mutation.json` ops, then `plant.json`. It happens in a temporary folder; case folder names are kept. **Every op must apply:** a stale fixture fails loudly as `[selftest-assemble]` naming the case and the op, instead of silently testing nothing.

## SUITE.json and base layers

| Key | Meaning |
|---|---|
| `base` | a folder or a list of layers copied in order; default the suite's `base/`, else `"good"` |
| `extends` | a case name: every other case starts from that case's assembled tree |
| `ops` | ops applied to the base once, before any case (generated PNGs, files whose names a skill cannot commit) |
| `argsFile` | `"replace"` (default) · `"append"` · `"error-only"` |
| `renames` | extra hygiene renames (`{ "dot-npmrc": ".npmrc" }`) |

Layers are strings or objects; strings resolve against the suite folder, or `@skill/<path>` (the skill folder), `@tests/<path>`:

```json
{
  "base": [
    "@tests/bases/app",
    { "templates": true, "firstLinePath": true, "fill": { "__FEATURE__": "tasks" } },
    { "from": "@skill/assets/sample-contract.json", "to": "contracts/sample.json" }
  ]
}
```

`firstLinePath: true` places each template at the repo path its first line names, so the shipped templates are exactly what the checker tests: assembling from `templates/` also proves the templates pass their own checker. A JS suite may add `{ build: async (dir, context) => {} }` layers (run once per suite), for example to run a scaffolder.

## mutation.json ops

An ordered list; each op is an object with one key:

| Op | Example | Rule |
|---|---|---|
| `replace` | `{ "replace": { "file": "src/a.ts", "find": "useState(0)", "with": "useState(1)" } }` | `find` occurs exactly once, unless `"all": true`, `"count": n` or `"occurrence": k`; `"regex": true` makes it a RegExp source |
| `json` | `{ "json": { "file": "package.json", "path": ["scripts", "test"], "value": "jest --ci" } }` | path is a list of keys; `"delete": true` removes a key that must exist |
| `write` | `{ "write": { "file": "src/b.ts", "lines": ["export const b = 1;"] } }` | one of `content`, `json`, `lines`, `base64` |
| `delete` | `{ "delete": ["src/old.ts"] }` | each must exist |
| `rename` | `{ "rename": { "from": "a.ts", "to": "b/a.ts" } }` | `to` must not exist unless `"overwrite": true` |
| `copy` | `{ "copy": { "from": "assets/icon.png", "to": "assets/splash.png" } }` | inside the case |
| `png` | `{ "png": { "files": ["shots/home.png"], "width": 120, "height": 260, "fill": "#ffffff" } }` | a generated image |
| `mkdir` | `{ "mkdir": "src/empty" }` | an empty folder (git cannot store one) |
| `symlink` | `{ "symlink": { "path": "link.ts", "target": "a.ts" } }` | a skill may not commit symlinks |
| `plant` | `{ "plant": { "notes/handover.md": true } }` | run-time files; `true` writes a defused private-key note |

## Patterns that work

- **The templates are the good case.** `"base": [{ "templates": true, "firstLinePath": true }]` with a `good/` that holds only `EXPECT.txt`: a template change that breaks the checker fails the self-test.
- **One small base, many cases.** A case is a `mutation.json` of one to three ops; a reader sees exactly what it plants.
- **Generated inputs.** PNGs come from `png` ops or `writePng`, not committed; large inputs are written by ops.
- **Writers and scaffolders.** A script that creates files takes its output folder as an argument; the good case writes into a fresh temporary folder, the refusal cases (name taken, bad name) into the case folder.
- **Real inputs.** Start the base from real, verified files (a real `metro.config.js`, a real route file), then plant one bug; a toy input no real repo looks like proves little.
- **Installed skills stay silent.** A scanning checker's good case plants findings under `.agents/skills/<x>/` and `skills/<x>/`, plus a vendored folder that a `SKILL.md` marks as a skill (written by a suite `ops` entry when the skill may not commit a nested `SKILL.md`).
- **Check the checker on a real repo too.** Before shipping a rule, run it on a real app and read every finding.

## Hygiene, secrets and budget

- No file or folder named `.gitignore`, `metadata.json`, `.git`, `__pycache__` or `__pypackages__` anywhere in a skill: installers drop `.git`, `__pycache__` and every `metadata.json`, and git obeys a nested `.gitignore`. Store `dot-gitignore` and `dot-metadata.json`; assembly renames them back.
- Planted secrets are stored defused and completed at run time (`write` a `-----BEGIN PRIVATE XKEY-----` line, then `replace` `XKEY` with `KEY`; or `plant` with `true`), because push protection blocks real-looking keys.
- Budget: `tests/` at most 1 MB and 600 files, every file at most 256 KB, binaries only from the allow-list. A full copy of a repo per case blows it within a few cases; overlays keep a 30-case suite under 100 files.

## Debugging a case

- `node scripts/selftest.mjs --case bad-route-fat` runs one case.
- `node scripts/selftest.mjs --materialize <empty folder>` writes every assembled case to `<folder>/<NN>-<suite>/<case>/` and runs nothing; run the checker there by hand.
- A case that passes for the wrong reason usually has an EXPECT line that also appears in a different failure; make the line name the rule id and the planted file.
