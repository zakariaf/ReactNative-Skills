# check-lib v2 and the shared script libraries

The reference for every skill script in this repository. `check-lib.mjs` and the helpers in `lib/`
are canonical here (`tools/shared/scripts/`) and synced into each skill that declares them in
`assets/shared.json` (`node tools/sync-shared.mjs`); never edit a synced copy. Everything is Node ESM
with zero dependencies (`node:` built-ins only), Node 22.18 or newer.

Contents: 1 Output contract · 2 check-lib API · 3 Layout and rn-skills.config.json · 4 Repo scans ·
5 Self-tests and the overlay fixture format · 6 PNG helpers · 7 The lib/ helpers · 8 Compatibility
notes · 9 Converting full-copy fixtures · 10 Self-tests of this folder

---

## 1. Output contract

Every checker prints, in this order:

```
SKIP <file> [<rule>] <message>                      a rule whose target is not yet created (notYetCreated)
FAIL <file>:<line> [<rule>] <message> Fix: <fix>    one line per problem
<name>: <n> <unit> checked, <m> problems[, <k> skipped]
NOT APPLICABLE: <repo fact>                         instead of the summary, when a repo fact proves the check does not apply
ERROR [bad-input] <message> Fix: <fix>              bad input or environment
RESULT: PASS | RESULT: FAIL (<m> problems)          always the last line
```

Exit `0` pass (SKIP lines and NOT APPLICABLE included) · `1` problems · `2` bad input or environment.
Nothing to check is exit 2 (never a silent pass). The repo root is an optional **positional**
argument; a guessed `--root` is answered with the positional form. `--help` prints usage and exits 0.

---

## 2. check-lib API

### Exit codes and errors

| Export | Use |
|---|---|
| `EXIT` | `{ PASS: 0, FAIL: 1, BAD_INPUT: 2 }` |
| `RESULT_PATTERN` | `/^RESULT: (PASS\|FAIL \((\d+) problems\))$/` |
| `resultLine(n)` | `'RESULT: PASS'` or `'RESULT: FAIL (<n> problems)'` |
| `UsageError(message, fix)` | thrown for bad input; `run()` prints `ERROR [bad-input] … Fix: …` and exits 2 |
| `fail(message, fix)` | `throw new UsageError(message, fix)` |
| `toPosix(path)` | backslashes to `/` |

### Arguments

`parseArgs(argv, spec)` → `{ options, positionals }`.

```js
const SPEC = {
  name: 'check-routes',                       // usage line: node check-routes.mjs ...
  summary: 'Checks that every route file renders a screen from src/features/.',
  usage: '[repo-root] [options]',
  options: {
    'routes-dir': { type: 'string', value: 'dir', help: 'Routes folder (default: from resolveLayout)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
    only: { type: 'string', multiple: true, value: 'rule', help: 'Check only these rules' },
  },
  positionals: { min: 0, max: 1 },
  details: 'Rules: route-thin, route-default-export, ...',
};
const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
```

`--help`/`-h` prints `helpText(spec)` and exits 0. Unknown options and wrong positional counts throw
`UsageError` (exit 2). A script that declares a `--root` option and no positionals also takes the
root positionally (older scripts); new scripts use a positional root.

### Reporting

```js
const report = createReporter({ name: 'check-routes', json: options.json });
report.problem({ file, line, rule, message, fix });   // needs rule + message
report.skip({ file, rule, message });                 // printed, not counted
report.note('text');                                  // an informational line
return report.finish({ checked: files.length, unit: 'files' });       // returns the exit code
return report.notApplicable('expo-router is not in package.json');    // exit 0, RESULT: PASS
```

`finish()` sorts problems by file and line; with nothing checked, no problem and no skip it throws
`UsageError('nothing to check: 0 <unit> found')`. `notApplicable()` after a problem is a crash (a bug).
`formatProblem(entry)` and `formatSkip(entry)` give the single lines. `run(async () => …)` wraps
`main`: a returned number is the exit code; `UsageError` → `ERROR [bad-input]`, exit 2; any other
exception → `ERROR [crash] <stack>`, exit 2.

### Files

| Export | Use |
|---|---|
| `globToRegExp(glob)` | `**`, `*`, `?`, `{a,b}`, `[abc]`, `[!abc]`; `dir/**` also matches `dir` |
| `matchGlob(rel, glob)` | a glob without `/` matches any path segment (gitignore style); with `/` it is anchored at the walk root |
| `DEFAULT_IGNORES` | `node_modules`, `.git`, `.DS_Store`, `EXPECT.txt` |
| `walk(root, options)` | sorted relative posix paths. Options: `ignore`, `include`, `defaultIgnores` (false drops DEFAULT_IGNORES), `pruneDirsContaining: ['SKILL.md']` (a folder below the root that holds one of these files is skipped whole) + `onPrune(relDir)`, `followSymlinks`, `onSymlink(rel)`. A missing root → `UsageError` |
| `AGENT_SKILL_FOLDERS` | `skills`, `.claude`, `.agents`, `.cursor`, `.codex`, `.windsurf`, `.roo`, `.cline`, `.continue`, `.kiro` |
| `REPO_SCAN_IGNORES` | see §4 |
| `repoScanIgnores(root)` | REPO_SCAN_IGNORES + each workspace's output folders (from package.json `workspaces`) |
| `isRepoScanIgnored(rel, root?)` | for git paths; with `root` also workspace folders and SKILL.md folders |
| `walkRepo(root, options)` | **the walk for every repo scan**: `repoScanIgnores(root)` + `options.ignore`, SKILL.md pruning on |
| `requireDir(path, what)` / `requireFile(path, what)` | absolute path, or `UsageError('nothing to check: …')` |

### Layout (see §3)

`LAYOUT_DEFAULTS`, `LAYOUT_KEYS`, `PROJECT_CONFIG_FILE` (`'rn-skills.config.json'`),
`parseJsonc(text)`, `readProjectConfig(root)`, `readTsconfigPaths(root, file = 'tsconfig.json')`,
`resolveAlias(spec, aliases)`, `readWorkspaces(root)`, `resolveLayout(root, overrides)`.

### Incremental adoption

`notYetCreated(root, { file, owner })` → `null` when `file` exists, else
`'not yet created (<owner> creates it)'`. Report it as a SKIP:

```js
const file = join(layout.i18nDir, 'catalogs', 'en.json');   // repo-relative
const reason = notYetCreated(root, { file, owner: 'i18n-strings-and-catalogs' });
if (reason) report.skip({ file, rule: 'catalog-key', message: reason });
// SKIP src/i18n/catalogs/en.json [catalog-key] not yet created (i18n-strings-and-catalogs creates it)
```

`file` must be repo-relative (no `..`, no leading `/`) and `owner` non-empty, else it throws (a bug in
the checker). Ship gates (release, store artifact, completeness) never skip. A definition of done
lists every SKIP line a passing run may print.

### Text

`isBinary(buffer)` (a NUL in the first 8000 bytes), `readText(path)` (null for binary),
`lineOf(text, index)` (1-based), `sha256(bufferOrString)`, `maskComments(source)` (comments become
spaces, newlines kept; strings, templates and regex literals kept).

### Pinned packages (a skill that truly needs packages)

| Export | Use |
|---|---|
| `toolingEnvVar(skill)` | `'design-review'` → `'DESIGN_REVIEW_TOOLING_DIR'` |
| `resolveToolingDir({ given, envVar, skill, scriptsDir })` | `--tooling` value, else the variable (`envVar`, or `toolingEnvVar(skill)`), else the skill's `scripts/` |
| `packageInstallFix({ scriptsDir, envVar, skill, option = '--tooling', repoDir })` | the fix text naming both installs; `repoDir` defaults to `.skill-tooling/<skill>` (skill defaults to the folder that holds `scriptsDir`) |
| `importPackage(name, toolingDir, { what, fix })` | `import()` of the package from `<toolingDir>/node_modules`, or `UsageError` with the fix |

### Temporary folders

`makeTempDir(prefix = 'check-lib-')` returns the folder's **real path** (on macOS `/var` is a symlink to
`/private/var`; a checker comparing its root with a module-derived path would otherwise differ),
`removeTempDir(dir)`.

---

## 3. Layout and rn-skills.config.json

`resolveLayout(root, overrides = {})` returns a frozen object of **repo-relative posix folders**:

```js
const layout = resolveLayout(root, { routesDir: options['routes-dir'] });
// {
//   root: '/abs/repo', mode: 'single' | 'monorepo',
//   srcDir: 'src', routesDir: 'src/app', featuresDir: 'src/features', uiDir: 'src/ui', themeDir: 'src/theme',
//   coreDir: 'src/core', servicesDir: 'src/services', storesDir: 'src/stores', dataDir: 'src/data',
//   apiDir: 'src/api', i18nDir: 'src/i18n', configDir: 'src/config',
//   testDir: 'test', mocksDir: '__mocks__', scriptsDir: 'scripts', e2eDir: '.maestro', contractsDir: 'contracts',
//   aliases: [{ pattern: '@/*', targets: ['src/*'] }], tsconfig: 'tsconfig.json' | null,
//   origin: { srcDir: 'default' | 'config' | 'override' | 'detected', ... },
//   workspaces: [{ dir: 'apps/mobile', name: '@acme/mobile', layout: { srcDir: 'apps/mobile/src', ... } }],
//   config: { ...rn-skills.config.json },
// }
const routes = join(layout.root, layout.routesDir);
```

Precedence per key: `LAYOUT_DEFAULTS` < `rn-skills.config.json` < `overrides` (undefined values are
ignored). `{srcDir}` in a default (or a config value) is the resolved `srcDir`, so
`{ "srcDir": "app-src" }` moves `featuresDir` to `app-src/features` too. When `routesDir` is not set
and `src/app` does not exist but `app/` does, `routesDir` is `app` (`origin.routesDir: 'detected'`).

**tsconfig aliases.** `readTsconfigPaths(root)` reads `tsconfig.json` with comments and trailing
commas, follows `extends` one level for relative files (a string or a list; package configs such as
`expo/tsconfig.base` are not read), and resolves `paths` targets the way TypeScript does (against
`baseUrl` when set, relative to the file that sets it; else against the folder of the file that holds
`paths`). `resolveAlias(spec, aliases)` → candidate paths (longest prefix wins) or null.

**Workspaces.** `readWorkspaces(root)` expands package.json `workspaces` (an array, or yarn's
`{ packages: [...] }`; `*`, `**`, `!exclude`) to `[{ dir, name, manifest }]`, only folders with a
package.json, sorted; `[]` for a single-app repo. With workspaces, `mode` is `'monorepo'` and every
workspace gets its own layout (its folders prefixed with its dir, its own tsconfig aliases).

**rn-skills.config.json** (optional, at the repo root; a malformed file is exit 2):

```json
{
  "srcDir": "app-src",
  "routesDir": "app",
  "e2eDir": "e2e/maestro",
  "contractsDir": "qa/contracts",
  "workspaces": { "apps/mobile": { "routesDir": "apps/mobile/app" } },
  "screensContract": "qa/contracts/screens.json"
}
```

Layout keys must be repo-relative folders (no `..`, no leading `/`). Workspace keys are relative to
the workspace folder. Any other key (here `screensContract`) is kept in `layout.config` for the skill
that documents it; a skill documents every key it reads.

---

## 4. Repo scans

```
REPO_SCAN_IGNORES = [
  'skills/**', '.claude/**', '.agents/**', '.cursor/**', '.codex/**', '.windsurf/**', '.roo/**',
  '.cline/**', '.continue/**', '.kiro/**',            agent skill folders (installed skills hold planted bugs)
  '.skill-tooling/**',                                pinned tooling installs
  'node_modules', 'Pods', '.expo', '.turbo', '.git',  at any depth
  'ios/**', 'android/**', 'build/**', 'out/**', 'dist/**', 'web-build/**', 'coverage/**'   the root app's output
]
```

Patterns with `/` are anchored at the root, so `scripts/build/` and `src/ios/` are still scanned.
Workspace output folders (`apps/mobile/ios/**`, `packages/ui/build/**`, …) come from package.json
`workspaces` through `repoScanIgnores(root)`, never from `apps/*` literals. `walkRepo(root, opts)`
adds both and prunes every folder below the root that holds a `SKILL.md`, wherever it lives:

```js
const files = walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['**/*.d.ts'] });
```

Every scanning checker keeps a `pass-`/`good` fixture with planted findings under `.agents/skills/`
and `skills/` (and a vendored folder holding a SKILL.md) that must stay silent.

---

## 5. Self-tests and the overlay fixture format

### runSelftest

```js
// scripts/selftest.mjs
import { runSelftest } from './check-lib.mjs';
await runSelftest(import.meta.url, [
  { script: 'check-routes.mjs', fixtures: '../tests/fixtures/check-routes', args: (dir) => [dir] },
]);
```

Case kinds by folder name (`SELFTEST_CASES` holds each kind's exit code; `selftestCaseKind(name)` →
`'good' | 'pass-' | 'bad-' | 'error-' | null`): `good/` (exit 0, RESULT: PASS; EXPECT.txt optional) · `pass-<case>/`
(exit 0 + every EXPECT.txt line) · `bad-<case>/` (exit 1 + every line; a suite needs one) ·
`error-<case>/` (exit 2 + every line). Each non-empty, trimmed EXPECT.txt line must appear in the
output. `--help` of every checker must exit 0 with a `Usage:` line. When every good/pass/bad case
stops with the same exit-2 error, the environment is not ready: the self-test says so once (exit 2).

Suite fields: `script`, `fixtures` (relative to the selftest file, or absolute), `args(dir, context)`
(`context = { name, kind, source, suiteDir, argsTxt }`; `dir` is the case folder, the working
directory is the case folder too), and for overlay suites `base`, `extends`, `ops`, `argsFile`,
`legacyOps`, `renames` (each overrides SUITE.json). `runSelftest(url, suites, { timeoutMs = 120000,
base })`: `base` is a default base for suites that have none.

**ARGS.txt** (words; `{dir}` is the case folder): `argsFile: 'replace'` (default for overlay suites,
DECISIONS §7) replaces `args(dir)` for every case kind; `'append'` adds the words after `args(dir)`;
`'error-only'` (default for suites that are not assembled — the pre-v2 rule) uses it for error-*
cases only. The file name is matched exactly (`args.txt` is not `ARGS.txt`, even on macOS).

Command line: `node scripts/selftest.mjs [--case <glob>]... [--materialize <dir>]`. `--case bad-*`
runs only matching cases. `--materialize <dir>` (a new or empty folder) writes every assembled case to
`<dir>/<NN>-<suite>/<case>/` and runs nothing.

### The overlay format

A suite folder is **assembled** when it holds `SUITE.json`, or a `base/` folder (which is then the
base), or when the JS suite passes `base`/`extends`/`ops`/`legacyOps`/`renames`. Otherwise its cases
are complete trees and run in place, as before.

```
tests/
  bases/app/                      optional shared base trees (tests/bases/<name>/)
  fixtures/check-routes/
    SUITE.json                    { "base": "good" }
    good/                         a complete tree (or an overlay, see "extends")
    bad-route-fat/
      EXPECT.txt                  [route-thin] src/app/(tabs)/index.tsx:4
      mutation.json               ordered ops
    bad-missing-layout/
      EXPECT.txt
      DELETE.txt                  src/app/_layout.tsx
    pass-no-router/
      EXPECT.txt                  NOT APPLICABLE: expo-router is not in package.json
      ARGS.txt                    . --strict
      overlay/package.json        an overlay file: replaces good's package.json
```

**SUITE.json keys** (unknown keys are a problem):

| Key | Meaning |
|---|---|
| `base` | a folder or a list of layers copied in order; default: the suite's `base/` folder when it has one, else `"good"` |
| `extends` | a case name (usually `"good"`): every other case starts from that case's assembled tree |
| `ops` | ops applied to the base once, before any case (for example `png` ops) |
| `argsFile` | `"replace"` (default) · `"append"` · `"error-only"` |
| `legacyOps` | `"all"` or `"first"`: the replace / json-delete behaviour of the older assemblers (§8) |
| `renames` | extra hygiene renames (`{ "dot-npmrc": ".npmrc" }`), or `false` for none |

Suite-level files besides SUITE.json: `CASES.json` (below) and the case folders; the suite folder's own
other files are ignored by runSelftest.

**Base layers** — a string or an object; strings and `from` resolve against the suite folder, or
`@skill/<path>` (the skill folder), `@tests/<path>` (`<skill>/tests`), or an absolute path (JS):

```json
{
  "base": [
    "@tests/bases/app",
    { "templates": true, "firstLinePath": true, "fill": { "__FEATURE__": "tasks", "__FEATURE_PASCAL__": "Tasks" } },
    { "from": "@skill/templates/eslint.config.mjs", "to": "./" },
    { "from": "@skill/templates/tooling", "to": "scripts/tooling", "include": ["*.mjs"], "exclude": ["*.test.mjs"] },
    { "from": "@tests/bases/optional-extras", "optional": true }
  ]
}
```

`to` (default `.`) places a folder or file; a `to` ending in `/` keeps a file's name. `fill` replaces
placeholders in text files and paths. `firstLinePath: true` places each text file at the repo path
its first line names (`// src/features/tasks/tasks-screen.tsx`, `# .maestro/smoke.yaml`; a shebang
line is skipped), so the shipped templates are exactly what the checkers test; files without such a
line keep their path under `to`. `include`/`exclude` are globs on the layer-relative path. A layer
never contributes `EXPECT.txt`, `ARGS.txt`, `mutation.json`, `DELETE.txt`, `plant.json` or
`SUITE.json` from its root. In a JS suite a layer may be `{ build: async (dir, context) => {} }`
(run once per suite, then copied like a folder).

**CASES.json (one file per case, the preferred form).** A suite folder may hold every case's
mutation in one `CASES.json`, so each case folder keeps only its `EXPECT.txt` (git needs one file to keep
the folder, and the folder name is the case kind):

```json
{
  "$comment": "optional",
  "bad-route-fat": [{ "replace": { "file": "src/app/(tabs)/index.tsx", "find": "return <TasksScreen />;", "with": "return null;" } }],
  "pass-no-router": { "args": ". --strict", "ops": [{ "json": { "file": "package.json", "path": ["dependencies", "expo-router"], "delete": true } }] },
  "bad-other-base": { "base": "@tests/bases/other", "ops": [] }
}
```

An entry is exactly what the case's `mutation.json` would hold (a list of ops, or `{ base, extends, ops }`)
plus an optional `"args"` (the words of `ARGS.txt`, a string or a list of strings; assembly writes it as the
case's `ARGS.txt`) and an optional `"expect"` (the lines of `EXPECT.txt` as a list, or its exact text; assembly
writes it as the case's `EXPECT.txt`). An entry with `"expect"` is a whole case: it needs no case folder, and
runSelftest counts it with the folder cases (`"bad-x": { "expect": ["[rule-x]"], "ops": [...] }`). A former `DELETE.txt` becomes a leading `delete` op, overlay files become `write` ops
(text `content`, small binaries `base64`) and `plant.json` a trailing `plant` op. A `CASES.json` alone makes
a suite assembled (base `good/` unless SUITE.json or the JS suite says otherwise). A key that names no
case folder and has no `"expect"`, a case with both an entry and its own `mutation.json`, both `"args"` and
`ARGS.txt`, or both `"expect"` and `EXPECT.txt`, is a `selftest-assemble` problem (the validator reports the first two as well). Stale ops are labelled
`<case>: CASES.json op <n>`.

**A case folder** holds `EXPECT.txt`, optional `ARGS.txt`, and any of:

- `mutation.json` — a list of ops, or `{ "base": [...], "extends": "<case>" | null, "ops": [...] }`
  (a case's own `base` replaces the suite base and its `extends`; suite `ops` belong to the suite base);
- `DELETE.txt` — one path per line (`#` comments), each must exist; a folder is removed whole;
- overlay files — the files of its `overlay/` folder (the form `fixtures-to-overlay` writes, and the
  only place for a repo file named like a control file, e.g. a data file `mutation.json`), and any
  other loose file of the case folder; both are copied on top of the base at their relative paths;
- `plant.json` — legacy: `{ "<path>": "<text>" | true }` files made at run time (true: a defused
  private-key note).

**Assembly order** per case: (1) the start tree — the extended case's assembled tree (minus its
EXPECT.txt/ARGS.txt), or the base layers + suite ops; hygiene renames applied · (2) DELETE.txt ·
(3) overlay files (loose files, then `overlay/`), renamed (skipped when the case folder is itself a base
layer, as `good` is with `"base": "good"`; a base folder's own `overlay/` is merged at its root) · (4) mutation.json ops (or the case's CASES.json entry), then plant.json · (5) the case's EXPECT.txt and ARGS.txt (or its CASES.json `"args"`).
Assembly happens in a temporary folder that is removed afterwards; case folder names are kept (some
checkers and args functions read `basename(dir)`).

**Every op must apply.** A stale op is a `selftest-assemble` problem naming the case, the op and why:

```
FAIL ../tests/fixtures/check-routes/bad-route-fat [selftest-assemble] check-routes.mjs bad-route-fat: bad-route-fat: mutation.json op 1: "return <TasksScreen />;" not found in src/app/(tabs)/index.tsx; update its mutation.json
```

**Hygiene.** No skill commits a file or folder named `.gitignore` or `metadata.json` (a nested
`.gitignore` is a real ignore rule; installers drop `metadata.json`). Store them as `dot-gitignore`
and `dot-metadata.json`: assembly renames them (`HYGIENE_RENAMES`). Planted secrets are stored
defused and completed at run time, e.g. `write` + `replace` (`"-----BEGIN PRIVATE XKEY-----"` then
`XKEY` → `KEY`), or `{ "plant": { "notes/handover.md": true } }`.

### Op reference (`OVERLAY_OPS`)

Each op is an object with one key (plus an optional `"$comment"`); the flat spelling
`{ "op": "replace", "file": …, "find": …, "with": … }` is accepted too (`path`/`paths` for `delete` and
`mkdir`). Paths are case-relative (no `..`).

| Op | Example | Rule |
|---|---|---|
| `replace` | `{ "replace": { "file": "src/a.ts", "find": "useState(0)", "with": "useState(1)" } }` | `find` must occur **exactly once**; `"all": true` replaces every occurrence (≥ 1); `"count": n` requires exactly n (all replaced); `"occurrence": k` replaces only the k-th; `"regex": true` makes `find` a RegExp source (`with` may use `$1`) |
| `json` | `{ "json": { "file": "package.json", "path": ["scripts", "test"], "value": "jest --ci" } }` | path is a list of keys (array items by index); missing objects are created; written as `JSON.stringify(data, null, indent ?? 2) + "\n"` |
| `json` delete | `{ "json": { "file": "package.json", "path": ["dependencies", "expo-router"], "delete": true } }` | the key must exist; `"value": null` also deletes (legacy); `"literalNull": true` sets JSON null |
| `write` | `{ "write": { "file": "src/b.ts", "content": "export {};\n" } }` | exactly one of `content`, `json`, `lines` (joined with `\n`, final newline), `base64`; creates or overwrites |
| `delete` | `{ "delete": "src/old.ts" }` or `{ "delete": ["a", "b"] }` | each must exist |
| `rename` | `{ "rename": { "from": "a.ts", "to": "b/a.ts" } }` | `to` must not exist unless `"overwrite": true` |
| `copy` | `{ "copy": { "from": "assets/icon.png", "to": "assets/splash.png" } }` | file or folder inside the case |
| `png` | `{ "png": { "files": ["e2e/a.png", "e2e/b.png"], "width": 120, "height": 260, "fill": "#ffffff", "rects": [{ "x": 10, "y": 10, "width": 100, "height": 40, "fill": "#3366ff" }] } }` | a generated PNG (writePng) |
| `reformat` | `{ "reformat": { "file": "levels.json", "indent": 2 } }` | rewrites JSON in `JSON.stringify` layout |
| `mkdir` | `{ "mkdir": "src/empty" }` | empty folders (git cannot store them) |
| `symlink` | `{ "symlink": { "path": "link.ts", "target": "a.ts" } }` | a skill may not commit symlinks |
| `plant` | `{ "plant": { "handover.md": true, "notes.txt": "plain\n" } }` | run-time files; `true` = a defused private-key note |

### Examples

**A suite whose cases differ from good/** (what `fixtures-to-overlay` writes):

```json
// tests/fixtures/check-flows/SUITE.json
{ "base": "good" }
// tests/fixtures/check-flows/bad-first-step/mutation.json
[{ "replace": { "file": ".maestro/flows/smoke.yaml", "find": "- launchApp\n", "with": "- tapOn: \"Start\"\n" } }]
```

**The templates are the good case** (the self-test then proves the shipped templates pass):

```json
// tests/fixtures/check-stores/SUITE.json
{ "base": ["@tests/bases/app", { "templates": true, "firstLinePath": true }] }
```
`good/` then holds only an `EXPECT.txt` (or a one-line `CASE.txt`): git cannot store an empty folder.

**A suite on another suite's base** (`extends`):

```json
// tests/fixtures/check-e2e-setup-slice/SUITE.json
{ "base": "@tests/fixtures/check-e2e-setup/good", "extends": "good" }
```
`good/` is an overlay on the other suite's good/; every other case starts from the assembled good/.
A single case can choose its own start: `{ "base": "@tests/fixtures/check-e2e-setup/good", "ops": [] }`.

**A JS suite with a generated base** (the older build-the-good-repo selftests):

```js
await runSelftest(import.meta.url, [{
  script: 'check-levels.mjs',
  fixtures: '../tests/fixtures/check-levels',
  args: (dir) => [dir],
  base: [
    { templates: true, firstLinePath: true, fill: { __FEATURE__: 'tasks' } },
    { build: async (dir) => writePacks(dir) },
  ],
}]);
```

### Lower-level assembly API

| Export | Use |
|---|---|
| `SUITE_FILE`, `CASES_FILE`, `MUTATION_FILE`, `DELETE_FILE`, `PLANT_FILE` | the control file names (`CASES.json`: a suite's packed case mutations) |
| `OVERLAY_DIR`, `SUITE_BASE_DIR` | `'overlay'` (a case's overlay folder), `'base'` (a suite's base folder) |
| `CASE_LOCAL_FILES` | `['EXPECT.txt', 'ARGS.txt']` |
| `FIXTURE_CONTROL_FILES` | `['mutation.json', 'DELETE.txt', 'plant.json']` |
| `HYGIENE_RENAMES` | `{ 'dot-gitignore': '.gitignore', 'dot-metadata.json': 'metadata.json' }` |
| `OverlayError` | a stale fixture (the message names the case and the op) |
| `applyMutation(dir, ops, label, { legacyOps })` | apply ops to a folder |
| `readSuiteSpec(suiteDir, overrides)` | the merged spec, or null for a suite that is not assembled |
| `assembleSuiteCases({ suiteDir, skillDir, into, spec, only })` | assemble every case into `into`; `[{ name, kind, source, dir, error }]` |
| `assembleSuite(options)` / `assembleSuite(bases, suiteDir)` | assemble into a new temp folder, return its path (drop-in for the older assemblers, §8) |
| `assembleFixtures(mutationsDir, build, { prefix, legacyOps = 'first' })` | the older "build a base, mutate it" form; sync or async |

---

## 6. PNG helpers

```js
writePng(join(dir, 'home.png'), { width: 120, height: 260, fill: '#ffffff',
  rects: [{ x: 10, y: 10, width: 100, height: 40, fill: '#3366ff' }] });
const { width, height, data } = readPng(path);       // data: RGBA bytes, rows top to bottom
const pixel = [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
```

`parseColor('#rgb' | '#rgba' | '#rrggbb' | '#rrggbbaa' | [r, g, b, a?])`, `renderPng(spec)` (also
`paint(x, y) → color` per pixel, or raw `data`), `encodePng({ width, height, data })` (8-bit RGBA,
deflate via node:zlib, CRC via zlib.crc32 with a table fallback), `decodePng(buffer)` (non-interlaced
gray, RGB, palette with tRNS, gray+alpha, RGBA; bit depths 1–16; all five filters; CRC checked),
`pngSize(bufferOrPath)` (IHDR only). Interlaced PNGs throw.

---

## 7. The lib/ helpers

Each is synced per skill (`"from": "scripts/lib/<name>.mjs"`) and imports `../check-lib.mjs`.

**source-scan.mjs** — the lexer (`scanSource`, `makeLineOf`, `matchBracket`, `importsOf`,
`codeLineCount`, `functionsOf`, `paramListsOf`, `typeRegionsOf`, `countParams`), the JSX helpers
(`maskCode`, `findClosing`, `findJsxTags`, `jsxAttributes`, `literalOf`, `findCalls(masked, callee)`,
`findImports`), small helpers (`hasWorkletDirective`, `valueImports`, `balancedParens`, `openingTag`,
`isTestFile`, `readRepoFile`) and resolution:
`resolveImport(fromRel, spec, { root, aliases, extensions, platforms })` →
`{ kind: 'external' | 'local', spec, path, exists }` and `resolveSpecifier(fromRel, spec, options)`
→ path or null. With `root`: tsconfig aliases (with extends) and workspace package names resolve,
and files are probed: as written, `+ .ts .tsx .js .jsx .mjs .cjs .json` and their `.ios/.android/
.native/.web` variants, then `index.*`; `./x.js` also finds `./x.ts`.

**app-modules.mjs** — `enableAppImports(root, { aliases })` → `{ root, exists(rel), load(rel) }`
imports the repo's pure TypeScript through `module.registerHooks` and Node type stripping: tsconfig
aliases, workspace package names (`@acme/core/x` → `packages/core/x` or `packages/core/src/x`),
extensionless relative imports and platform files resolve; `.json` loads as a default export; several
roots may be enabled. A module importing React Native/Expo/Skia (or a `.tsx` file) does not load.
Also `deepFreeze`, `lineOfExport`, `reasonOf`, `errorText`.

**object-literal.mjs** — `extractBlock`, `topLevelEntries`, `childObject`, `callObjectArgument`.
**ts-literal.mjs** — `findConstInitializer`, `parseValue`, `parseObjectEntries`, `LiteralError`
(plain data only; identifiers, spreads, calls and templates are "not literal data").

**plist.mjs** — `readPlist(path)` (XML or binary bplist00, **no plutil needed**), `parsePlistXml`
(UsageError on malformed input), `parseXmlPlist` (plain Error), `parseBinaryPlist(buffer)`,
`plistGet(value, 'A.B')`, `toPlistXml(value)`. Dates are ISO strings, data is base64.

**usage-strings.mjs** — `ATT_KEY`, `USAGE_KEYS`, `appLanguages(appDir, info)` (CFBundleLocalizations,
else the `.lproj` folders, Base left out), `localeFiles(root, dir)`, `stringsValue(path, key,
readPlist)`, `usageStringProblems(appDir, info, { keys, languages, readPlist })` →
`[{ file, key, message }]`, `trackingTextProblems(appDir, info, readPlist, { languages })`.

**ship-placeholders.mjs** — `PLACEHOLDER_RULE` (`'ship-placeholder'`), `PLACEHOLDERS` (`com.example.*`,
Google's sample AdMob app and unit ids `ca-app-pub-3940256099942544~…` / `/…`, `*@example.com`,
`example.com`/`.org`/`.net` and reserved test hosts, unfilled `__UPPER_SNAKE__` tokens), each
`{ id, value, name, matches(text), fix }`; `placeholdersIn(value)`, `placeholderName(value)`,
`placeholdersInText(source)` → `[{ index, value, name, entry }]`, `placeholderProblem({ entry, value,
where, file, line })`, `bundleIdProblem(id, { platform: 'ios' | 'android' })`, `isGoogleSampleAdId(id)`.

**maestro-spawns.mjs** — `maestroSpawnProblems(files, { helpers = ['maestroGlobalArgs'],
requireDriverPort = true, fix })` over `[{ rel, code }]` (comments masked). Flags a spawn of the
Maestro binary (a `maestro/bin/maestro` path, `join(…, '.maestro', 'bin', 'maestro')`, a const bound to
one, or bare `'maestro'`) whose arguments neither call a device helper nor put `--device` (and
`--driver-host-port`) before the command; the per-command `--udid`; fixed driver ports.
`DEFAULT_DEVICE_HELPERS`.

**workspaces.mjs** — `workspacePackages(root)` (from package.json `workspaces`),
`workspacePackageNames(root)` (longest first), `listApps(root)` (the workspaces, or the root itself
with `isRoot: true`), `workspaceOf(rel, workspaces)`, `isExpoApp(root, dir)`.

---

## 8. Compatibility notes

check-lib keeps a few older call forms so a fixture written against them still assembles the same way:

| Older form | Current form |
|---|---|
| `assembleSuite({ templates, baseRepo, suiteDir, prefix, extraCopies })` | the same call works (it defaults to `legacyOps: 'all'`); better: a `SUITE.json` with `"base": [{ "templates": true }, "../base-repo"]` and no assembler code in the self-test |
| `assembleSuite(baseRepo, suiteDir)`, `assembleSuite(bases, suiteDir)` | the same positional call |
| `assembleFixtures(mutations, build)`, `applyMutation(dir, ops, label)` | `assembleFixtures(mutations, build, { legacyOps: 'first' })`; `applyMutation(dir, ops, label, { legacyOps: 'first' })`; placeholder filling becomes base entries with `fill` |
| `plant.json` | works as is in an overlay suite (`true` → a defused key note) |
| `walk(root, { ignore: REPO_SCAN_IGNORES })` | `walkRepo(root, { ignore: [...] })` (workspaces from package.json `workspaces` + SKILL.md pruning) |
| `packageInstallFix({ ..., repoDir })` | omit `repoDir` (default `.skill-tooling/<skill>`), pass `skill` to get `<SKILL>_TOOLING_DIR` |

`legacyOps` exists only for that compatibility. New fixtures use the strict default (a `find` that
occurs twice must say `all`, `count` or `occurrence`; deleting a missing JSON key fails). A rule whose
target file does not exist yet reports `notYetCreated(root, { file, owner })` (SKIP text `not yet
created (<owner> creates it)`); a repo fact that proves the whole check does not apply reports
`report.notApplicable('<repo fact>')`.

**lib notes:** `resolveSpecifier(fromRel, spec, { root })` resolves tsconfig aliases and workspace
packages; `isTestFile` also counts `*.spec.*`, `__tests__/` and a root `__mocks__/`. `workspacePackages(root)`
reads package.json `workspaces` (a repo without the field has none). `usage-strings` takes the app's own
languages (`trackingTextProblems(..., { languages })`). `ship-placeholders` entries are
`{ id, value, name, matches, fix }` with rule id `ship-placeholder`. `maestro-spawns` takes `helpers`,
`requireDriverPort` and `fix`; bare `'maestro'` and `~/.maestro/bin/maestro` are recognised.

---

## 9. Converting full-copy fixtures

```
node tools/fixtures-to-overlay.mjs <skill-dir> --dry-run                 # numbers only
node tools/fixtures-to-overlay.mjs <skill-dir> --verify [--shared-base] [--png-ops]
```

Run it on a scratch copy with the canonical check-lib synced into it. Every converted case is
assembled with check-lib and compared byte for byte with the original before anything is written.
`--verify` runs the skill's self-test before and after and restores the fixtures unless every case's
outcome and printed EXPECT lines are identical. `--shared-base` lets a case (or a whole good/) start
from another suite's good/ when that is much closer. `--png-ops` (needs `--verify`) turns PNG files
into generated `png` ops of the same size and keeps them only when an outcome changes (content
matters). Overlay files are written to each case's `overlay/` folder. A suite is skipped with the reason
when it has SUITE.json, or when a case holds `mutation.json`/`DELETE.txt`/`plant.json` at its root that
good/ does not (an older assembler's case); when good/ holds it too it is data and moves under
`overlay/`. A suite whose overlay form is not smaller is left as it is.

Measured on scratch copies (2026-10-03, check-lib v2 synced in):

| Skill | tests/ before | after | Verify |
|---|---|---|---|
| react-components-and-hooks | 336 files, 334,229 bytes | 83 files, 25,122 bytes | 23 runs identical (the baseline ends FAIL: its good/ plants a decoy under `apps/demo/ios`, which v2 no longer ignores without workspaces) |
| e2e-maestro (`--shared-base`) | 4,511 files, 17,160,835 bytes (1,309 PNGs, 45 `.gitignore`) | 344 files, 609,676 bytes (32 PNGs, 0 `.gitignore`) | 88 runs identical, PASS → PASS |
| e2e-maestro (`--png-ops`) | same | 420 files, 687,408 bytes, 0 PNGs | 88 runs identical, PASS → PASS |
| unit-and-component-tests | 603 files, 525,418 bytes | 174 files, 131,652 bytes (check-test-code kept: not smaller) | 54 runs identical, PASS → PASS (a data file named `mutation.json` moved under `overlay/`) |

---

### Packing overlay cases into CASES.json

```
node tools/fixtures-pack.mjs <skill-dir> --dry-run                   # numbers only
node tools/fixtures-pack.mjs <skill-dir> --verify [--suite <rel>]...
node tools/fixtures-pack.mjs <skill-dir> --expect --verify           # EXPECT.txt too: one entry per case, no folder
```

Moves each assembled case's `mutation.json`, `ARGS.txt`, `DELETE.txt`, `plant.json` and overlay files into the
suite's `CASES.json` (one file per case instead of two to four). It materializes every case before and after
and restores `tests/` unless the trees are byte-identical (`.git/` internals skipped; `ARGS.txt` by words);
`--verify` also compares every case's self-test outcome. A case used as another case's base layer, a case with a
symlink, and a binary overlay file over 4 KB stay as they are. Suites whose cases run in place are left alone:
convert them first (`fixtures-to-overlay`, or a SUITE.json by hand). `--expect` also moves each case's
`EXPECT.txt` into its entry as `"expect"` (its lines, or the exact text when lines would not rebuild the file)
and removes the emptied case folder; `good/` and base layers keep their folders.

Measured 2026-10-17 on 39 already-overlaid skills: tests/ 7,175 -> 3,953 files (-45%), 2,098,033 ->
2,235,455 bytes (escaped text in `write` ops costs about 7%); every case kept, every assembled case
byte-identical, every self-test outcome identical. `CASES.json` is written in a compact layout (an op that
fits in 120 columns stays on one line).

## 10. Self-tests of this folder

```
node tools/shared/scripts/check-lib.selftest.mjs   # 23 tests: globs, walk, repo scans, layout, notYetCreated, the
                                                   # output contract, every case kind, every op, stale ops, extends,
                                                   # ARGS.txt modes, --materialize, --case, older assemblers, PNG,
                                                   # pinned packages, fixture hygiene renames
node tools/shared/scripts/libs.selftest.mjs        # runs lib/*.selftest.mjs
node tools/fixtures-to-overlay.selftest.mjs        # the converter on a synthetic skill (not yet wired into selftest-all)
```
