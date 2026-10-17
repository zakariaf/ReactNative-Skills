# Writing skill scripts

How a skill script is built on the shared helper `check-lib.mjs`: the contract every checker keeps, the API, how it finds the app's folders and facts, how it scans a repo without judging installed skills, and how it names devices. Read this before writing or changing any script in a skill; the self-test and its fixtures are in the self-tests-and-fixtures reference.

## Contents

- The contract
- A checker, complete
- The check-lib API
- Layout and rn-skills.config.json
- Contracts: the app's facts
- Repo scans
- SKIP, NOT APPLICABLE and ship gates
- Devices are always named
- Scripts that need packages
- Text the validator reads as a project reference
- Checklist

## The contract

- One entry point per file in `scripts/`, Node ESM `.mjs`, Node 22 or newer, importing `./check-lib.mjs` (declared in `assets/shared.json`, synced, never edited). Helpers that are not entry points live in `scripts/lib/`.
- **Invocation:** `node ${CLAUDE_SKILL_DIR}/scripts/<name>.mjs [repo-root] [options]`. The repo root is an optional **positional** argument (default `.`), never `--root`; `parseArgs` answers a guessed `--root` with the positional form. Workflows and definitions of done write every command out in full.
- `--help` prints `Usage:` and exits 0. **Exit codes:** 0 pass, 1 problems found, 2 bad input or environment. **The last line** is always `RESULT: PASS` or `RESULT: FAIL (<n> problems)`.
- Every problem line is `FAIL <file>:<line> [<rule>] <message> Fix: <fix>`: the file, the rule id and the fix, so an agent can act without reading the script.
- **Nothing to check is never a pass:** a missing folder or zero matching files exits 2. Run with no arguments in an empty folder, a script exits fast (0, 1 or 2) with its RESULT line and no side effects: no simulator, build, download or network call.
- Keep output short: problems and one summary line. Long reports go to a file in the app repo whose path the script prints; scripts never write next to themselves (the skill folder may be read-only or shared).
- Zero dependencies: only `node:` built-ins.

## A checker, complete

```js
#!/usr/bin/env node
// check-file-names.mjs: checks that source files under src/ are kebab-case.
// Run: node <this skill>/scripts/check-file-names.mjs [repo-root]
import { join } from 'node:path';

import { createReporter, parseArgs, resolveLayout, run, walkRepo } from './check-lib.mjs';

const SPEC = {
  name: 'check-file-names',
  summary: 'Checks that TypeScript files under the source folder are kebab-case.',
  usage: '[repo-root] [options]',
  positionals: { min: 0, max: 1 },
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'Source folder (default: srcDir from resolveLayout)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  details: 'Rules:\n  file-name-kebab  lowercase words joined by hyphens', // check-skill reads this list: each id needs a bad-* case
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC); // --help: exit 0
  const layout = resolveLayout(positionals[0] ?? '.', { srcDir: options['src-dir'] }); // missing root: exit 2
  const report = createReporter({ name: 'check-file-names', json: options.json });
  const files = walkRepo(layout.root, { include: [`${layout.srcDir}/**/*.ts`, `${layout.srcDir}/**/*.tsx`], ignore: ['**/*.d.ts'] });
  for (const rel of files) {
    const base = rel.split('/').pop();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9-]+)*\.tsx?$/.test(base)) {
      report.problem({ file: rel, line: 1, rule: 'file-name-kebab', message: `"${base}" is not kebab-case`, fix: 'Rename it, for example task-title.ts.' });
    }
  }
  return report.finish({ checked: files.length, unit: 'files' }); // 0 files checked: exit 2
});
```

## The check-lib API

| Export | Purpose |
|---|---|
| `parseArgs(argv, spec)` | Long options (`type` string/boolean, `default`, `multiple` (defaults to `[]`), `value`, `help`), positional limits, automatic `--help` from `name`, `summary`, `usage`, `options`, `details`. Unknown options exit 2 |
| `createReporter({ name, json })` | `problem({ file, line, rule, message, fix })`; `skip({ file, rule, message })` (printed, not counted); `note(text)`; `count`; `finish({ checked, unit })` prints sorted SKIP and problem lines, a summary, the RESULT line and returns the exit code (0 checked, 0 problems, 0 skips: exit 2); `notApplicable('<repo fact>')` prints `NOT APPLICABLE: <fact>` and `RESULT: PASS`, exit 0 |
| `run(main)` | Runs `main`; its return value is the exit code. `UsageError` / `fail(message, fix)` print `ERROR [bad-input] ... Fix: ...`, exit 2; a crash prints `ERROR [crash]` with the stack, exit 2 |
| `walk(root, opts)` | Sorted relative posix paths; `include`/`ignore` globs (a glob without `/` matches any segment, with `/` it is anchored), `defaultIgnores`, `pruneDirsContaining`, `followSymlinks`, `onSymlink` |
| `walkRepo(root, opts)` | **The walk for every repo scan** (section "Repo scans") |
| `REPO_SCAN_IGNORES`, `repoScanIgnores(root)`, `isRepoScanIgnored(rel, root?)` | The scan ignores; the last one filters paths read from git (diffs, logs) |
| `resolveLayout(root, overrides)` | The app's folders (next section) |
| `notYetCreated(root, { file, owner })` | `null` when the repo-relative file exists, else `'not yet created (<owner> creates it)'` for a SKIP |
| `requireDir(path, what)`, `requireFile(path, what)` | An absolute path, or exit 2 with "nothing to check" |
| `readText`, `isBinary`, `lineOf(text, index)`, `maskComments(source)`, `sha256`, `toPosix`, `globToRegExp`, `matchGlob`, `parseJsonc` | Small helpers. `maskComments` blanks JS/TS comments without moving lines, so pattern rules ignore commented-out code |
| `makeTempDir(prefix)`, `removeTempDir(dir)` | A temporary folder's real path (macOS `/var` is a link) |
| `runSelftest`, `applyMutation`, `assembleSuite`, `OVERLAY_OPS` | The self-test runner and the overlay assembly (self-tests-and-fixtures reference) |
| `writePng`, `readPng`, `pngSize` | Generated PNG inputs, so fixtures commit no images |
| `resolveToolingDir`, `importPackage`, `packageInstallFix`, `toolingEnvVar` | Pinned packages (section "Scripts that need packages") |

Exports marked `@deprecated` in check-lib keep old behaviour for skills not yet moved; `check-skill.mjs` (`deprecated-api`) fails a script that uses one.

## Layout and rn-skills.config.json

Never hard-code `src/features/...`. `resolveLayout(root, overrides)` returns repo-relative folders with these defaults: `srcDir: src`, `routesDir: src/app` (or `app` when only that exists), `featuresDir`, `uiDir`, `themeDir`, `coreDir`, `servicesDir`, `storesDir`, `dataDir`, `apiDir`, `i18nDir`, `configDir` under `src/`, and `testDir: test`, `mocksDir: __mocks__`, `scriptsDir: scripts`, `e2eDir: .maestro`, `contractsDir: contracts`, plus `aliases` from `tsconfig.json` `paths` and `workspaces` from `package.json`.

Precedence per key: the defaults, then an optional repo file `rn-skills.config.json`, then the script's options (`{ routesDir: options['routes-dir'] }`; undefined values are ignored). In a monorepo (package.json `workspaces`) every workspace gets its own layout; never find apps through `apps/*` literals. Any other key in the config file (for example `"screensContract": "qa/contracts/screens.json"`) is kept in `layout.config` for the skill that documents it, and the skill documents every key it reads.

## Contracts: the app's facts

When a rule needs facts only the app knows (its screens and testIDs, settings fields, contrast pairs, budgets), the checker reads `join(layout.contractsDir, '<name>.json')`, and the skill ships `templates/contracts/<name>.json` with `templates/contracts/<name>.schema.json`. A missing contract is exit 2 with a fix that names the template; a contract another skill owns is named in SKILL.md with that skill (`check-skill.mjs` rule `contract-documented`). The checker stays strict; only the facts move.

## Repo scans

`walkRepo(root, { include, ignore })` applies `REPO_SCAN_IGNORES` (every agent skill folder: `skills/`, `.claude/`, `.agents/`, `.cursor/`, ...; `.skill-tooling/`; `node_modules`, `Pods`, `.expo`, `.git` at any depth; the root's generated `ios/`, `android/`, `build/`, `out/`, `dist/`, `web-build/`, `coverage/`), each workspace's output folders from package.json, and prunes every folder below the root that holds a `SKILL.md`. Installed skills live inside the app and their fixtures plant bugs on purpose; a scan that reads them fails for nothing. Same-named source folders (`scripts/build/`, `src/ios/`) are still scanned because the patterns with `/` are anchored at the root.

Never write `walk(root, { ignore: REPO_SCAN_IGNORES })`, nor the same through a constant (`const IGNORE = [...REPO_SCAN_IGNORES, 'reports/**']; walk(root, { ignore: IGNORE })`): it misses the SKILL.md pruning and the workspaces (`check-skill.mjs` rule `repo-scan-walk`, which follows constants built from `REPO_SCAN_IGNORES` or `repoScanIgnores()` into any `walk(` call). Extra ignores go in `walkRepo(root, { ignore: [...] })`. A scan that must be wider on purpose (a secret scan that covers installed skills too) keeps `walk()` and says so in a comment on the call's line or the line above: `// repo-scan-walk: deliberate (<why>)`. Every scanning checker keeps a passing fixture with planted findings under `.agents/skills/` and `skills/` (and a vendored folder holding a `SKILL.md`) that must stay silent.

## SKIP, NOT APPLICABLE and ship gates

- **SKIP** (`report.skip`) is for one rule whose target another skill or a later step creates, in an app adopted step by step:

  ```js
  const file = join(layout.i18nDir, 'catalogs', 'en.json'); // repo-relative
  const reason = notYetCreated(layout.root, { file, owner: 'i18n-strings-and-catalogs' });
  if (reason) report.skip({ file, rule: 'catalog-key', message: reason });
  // SKIP src/i18n/catalogs/en.json [catalog-key] not yet created (i18n-strings-and-catalogs creates it)
  ```

  Never SKIP the checker's own target: that is exit 2 (missing) or a problem (it should exist by now). The skill's Definition of done lists every SKIP line a passing run may print (`check-skill.mjs` rule `dod-skips`).
- **NOT APPLICABLE** (`report.notApplicable('<repo fact>')`, exit 0) is for a whole check that a repo fact proves irrelevant: `react-native-google-mobile-ads is not in package.json`, `no src/app routes folder (not an Expo Router app)`. Never for a target that is simply missing.
- **Ship gates** (release, store artifact, completeness) never SKIP and never say NOT APPLICABLE. Their only relaxation is `--rehearsal` (a keyless dry run): it prints `REHEARSAL: not a release gate` first, skips only the signing rule, keeps every other rule strict, and a report never cites it as release evidence.
- SKIP lines and NOT APPLICABLE count as a pass wherever results are read; exit 2 never does.

## Devices are always named

Several sessions share one machine, and a call that picks "the booted simulator" or "the only device" can reach someone else's. In SKILL.md, references, examples and scripts:

| Tool | Write | Never |
|---|---|---|
| Maestro | `maestro --device <id> test flow.yaml` (the device option before the command); in code a binding helper such as `maestroGlobalArgs()` that also gives each run its own driver port | a bare `maestro test` |
| simctl | `xcrun simctl boot "$UDID"`, `xcrun simctl io "$UDID" screenshot shot.png` | the `booted` or `all` device names |
| xcodebuild | `-destination "id=$UDID"`; an archive uses `generic/platform=iOS` | a destination by name or OS |
| adb | `adb -s emulator-5554 shell ...` (the serial before the command) | adb without `-s` |
| emulator | `emulator -avd <project>-<purpose>` | the first AVD in the list |

Tools create their own devices named `<project>-<purpose>` (`tasks-e2e-sim`, `tasks-android-build`) and delete them when done. A sentence that forbids a command and the Anti-patterns section may still name it; the validator's `device-explicit` rule enforces the rest.

## Scripts that need packages

Only when truly needed (image comparison, a browser). Ship `scripts/package.json` and its lock with exact versions (never `^` or `~`), load each package inside `main()` with `await import()` or check-lib's `importPackage`, so `--help` works before the install, and accept `--tooling <dir>`:

```js
const tooling = resolveToolingDir({ given: options.tooling, skill: 'design-review', scriptsDir: SCRIPTS_DIR });
const fix = packageInstallFix({ scriptsDir: SCRIPTS_DIR, skill: 'design-review' });
const { PNG } = await importPackage('pngjs', tooling, { what: 'pngjs 7.0.0', fix });
```

Installs default to `<repo>/.skill-tooling/<skill>` (git-ignored; the variable `<SKILL>_TOOLING_DIR` overrides it), because a plugin cache is wiped on update and a skill folder may be read-only.

## Text the validator reads as a project reference

The validator scans every skill file, scripts included, for paths that leave the skill, runtime variables, implicit devices and dynamic imports. A checker that must itself look for such text builds the pattern from parts so its own source stays clean: `new RegExp(\`-${'destination'}\\b\`)`, `` `${'CLAUDE'}_PLUGIN_ROOT` `` read from a data file, `'/Us' + 'ers/'`. The same trick keeps a scaffolder's own placeholder tokens out of its source (`` `__${word}__` ``).

## Checklist

- [ ] `--help` works; no arguments in an empty folder exits fast with a RESULT line and no side effects.
- [ ] Every problem names file, line, rule and fix; exit codes are 0/1/2; nothing to check is exit 2.
- [ ] The repo root is the optional positional argument; folders come from `resolveLayout()`, every option it reads is documented.
- [ ] App facts come from `contracts/<name>.json`, whose template and schema ship in the skill.
- [ ] Repo scans use `walkRepo()` and a fixture with planted findings under `.agents/skills/` and `skills/` stays silent.
- [ ] SKIP only via `notYetCreated()` for another skill's file, each listed in the Definition of done; NOT APPLICABLE only for a repo fact; ship gates never skip.
- [ ] Every maestro, simctl, xcodebuild, adb and emulator call the script makes or prints names its device.
- [ ] `node:` built-ins only, or exact pins loaded with `await import()`.
- [ ] The script ran on a real app repo with no false findings.
