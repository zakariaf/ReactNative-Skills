# When a gate fails

Every custom rule message names the rule and the fix. Read the whole output, fix the code, the test
or the translation, never the gate, and rerun.

## Contents

- The procedure
- Fix by failure
- When a limit trips
- The never list
- When the gate itself looks wrong

## The procedure

1. **Read the whole output.** Messages say what to use instead (for example "Use the seeded RNG
   (src/core/rng) or an injected random source").
2. **Fix the code, the test or the translation,** not the gate (table below).
3. **Rerun the step that failed** (`npm run -s lint`, `node scripts/quality/check-quality-gates.ts`,
   ...), then `npm run -s check:fast`, then `npm run verify` before the push.
4. **A flaky test:** reproduce it with the printed seed (`npx jest --ci --randomize --seed=<n> -i
   <file>`, or fast-check's `seed` and `path`) and make it deterministic (an injected clock, seeded
   random numbers, fake timers for UI timers only). Retries are not a fix.

## Fix by failure

| Failure | Fix |
|---|---|
| Prettier | `npm run format` (the edit hook normally prevents this) |
| ESLint limit (`max-lines`, `complexity`, ...) | split by responsibility (next section) |
| ESLint restricted API | use the replacement the message names (the clock port, the seeded generator, the app's text component, a dialog, the port) |
| `tsc` | fix the types; never `as unknown as`, `any` or `!` to silence it |
| Failing test | fix the code; change the test only when the requirement changed, and say so in the commit; never add its path to `testPathIgnorePatterns` or narrow `testMatch` |
| Coverage below a threshold | never add a `!` glob or an ignore pattern to `jest.config.js` (`jest-scope` and the guardrail fail it); test the uncovered behaviour (not assertion-free tests: Stryker and `jest/expect-expect` catch those); a native adapter, Skia or frame-callback module or composition file gets `// device-only: covered by <check>` in its first 6 lines instead (unit-and-component-tests owns the policy); never a fake or a pure helper |
| Golden or screenshot diff | find the cause; update the golden only when the change is intended (`jest --selectProjects golden -u <file>` by hand), then `Gate-Change:` (golden-and-snapshot-tests) |
| `check:unused` (knip) | delete the dead code or dependency, or add the missing dependency; an ignore entry only for a tool contract, with the developer, a reason in `contracts/knip-ignores.json` and a `Gate-Change:` trailer |
| `i18n:verify` | fix the catalog or the key (i18n-strings-and-catalogs) |
| `export:audit` | the production bundle does not build: read Metro's error (a missing module, an asset, a platform file, a variant variable) |
| `audit:licenses` | remove the dependency, or ask the developer for an exception with the exact licence (dependency-management) |
| `check:deps` | follow the line it prints: delete an expired release-age block, review and approve an install script, `npx expo install <pkg>@<spec>` for drift. A `WARN` for an Expo patch younger than the release age is not a failure: install it on the due date it names |
| The guardrail | restore the gate to its expected value; never edit `quality-gates.json` to match. A local `lefthook-local.yml` or `.claude/settings.local.json` switch: delete it |
| `commit-msg` | rewrite the message, add the trailer the check asks for (git-commits-and-reporting) |
| `test:sim` | fix the game's tuning or rules, never the band (game-balance-and-bots) |
| `npm ci` fails at `prepare` with `not a git repository` (exit 128), or hooks appear in an enclosing repository | `prepare` is still the old bare `lefthook install`: restore the canonical `node scripts/hooks/install-git-hooks.ts` with `templates/scripts/hooks/` (it skips without `.git` and below the git top level). Never `lefthook install \|\| true`, which hides a real install failure on a developer machine; `LEFTHOOK=0` does not skip it |
| `prepare` is the canonical script and says `skipped`, yet a `lefthook.yml` or a `prepare-commit-msg` hook appeared in the enclosing repository after `npm install` in a nested app (or `npm ci --prefix <app>`) | lefthook's own postinstall, approved by `"lefthook@2.1.14": true`, ran `lefthook install` from the folder npm started in (it skips only with `CI` set). Delete the stray file and hook, then deny the script in the nested app's `package.json` (`"lefthook": false`) and run `npx lefthook validate` and the guardrail from the enclosing root (gates-overview.md, "lefthook's own postinstall bypasses that guard"). Never deny it in an app at the git top level |
| `npm install` fails in `prepare` with `sh: lefthook: command not found` (exit 127), or the guardrail says `could not run npx --no -- lefthook dump` | lefthook's install script is denied, so npm 11.17 made no `.bin/lefthook` link: restore the canonical `"lefthook@2.1.14": true` in `allowScripts` at a git top level and run `npm ci` (a nested app that denies it on purpose runs those from the enclosing root) |
| `Cannot find module 'scripts/...'` from a script or a hook | the owner skill named in `check-gate-wiring.mjs`'s SKIP line has not run: install its files; never stub the target or remove the step |
| This skill's `check-gate-wiring.mjs` | restore the file or value it names from `templates/` or `assets/` |
| This skill's `check-bypasses.mjs` | remove the suppression, ignore comment, bypass flag or stale exception it names |

## When a limit trips

The limits (250 code lines per file, 40 per `.ts` function, 80 per component, complexity 10, cognitive
15, depth 3, 3 parameters, 3 nested callbacks, JSX depth 5, one component and one class per file) are
typescript-and-lint-rules' table; its splitting guide is the full method. In short: split by
responsibility, never by line count, and never compress code, join lines or move logic into JSON to
get under a limit.

- A long function: extract the steps into named pure functions, or a sibling module with its own
  test when they form their own responsibility.
- High complexity: a lookup table (an `as const` object keyed by a union) or an exhaustive `switch`.
- Deep JSX: extract a child component into its own file with a `<Component>Props` type.
- A long file: split by responsibility, never into `part-1.ts` / `part-2.ts`.
- Too many parameters: one `readonly` options object.
- Large static data (word lists, tables) belongs in `.json`, which has no line limit.

## The never list

Never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, a reason-less `@ts-expect-error`, an istanbul,
c8, v8 or Stryker ignore comment, `--no-verify`, `git commit -n`, `LEFTHOOK=0`, `lefthook uninstall`,
`core.hooksPath`, `--passWithNoTests` outside `check:fast` and the pre-commit `test-related` job,
`jest -u` or `--update` in a script, `--max-warnings` above 0, `--quiet` or `--rule` on ESLint, or a
`min-release-age-exclude` outside a dated block: `check-bypasses.mjs` finds every one of these. Never
add `skip:`, `only:` or a new `exclude:` to `lefthook.yml` or a `lefthook-local.yml`, `disableAllHooks` to
either Claude Code settings file, an `|| true` on a hook command, an ignore entry without a reason, a
lower threshold, a new `!` glob in `collectCoverageFrom`, a new `testPathIgnorePatterns`,
`coveragePathIgnorePatterns` or `modulePathIgnorePatterns` entry, a narrower `testMatch`, or a weaker
`quality-gates.json` value: `check-gate-wiring.mjs` finds those (`jest-scope` reads the literal values
of `jest.config.js`; a computed one is left to the guardrail, which compares the resolved scope). `.skip`, `.only` and focused tests are ESLint errors (`jest/no-disabled-tests`,
`jest/no-focused-tests`), and `jest.retryTimes` is unit-and-component-tests' test-code check.

## When the gate itself looks wrong

A false positive, a rule that contradicts a requirement or a platform decision, or a tool bug: stop
that line of work and send the developer one note (`assets/gate-question.md`) with the gate, the file
and line, the exact message, why it looks wrong, and the smallest proposed change. Continue with other
work if possible. Change the gate only after the developer agrees, in one commit that also updates
`quality-gates.json`, with a `Gate-Change:` trailer.
