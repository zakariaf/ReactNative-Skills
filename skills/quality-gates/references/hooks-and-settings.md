# Git hooks and Claude Code hooks

How the hooks are wired, why each part is there, and what was verified. The files are
`templates/lefthook.yml` (copy to `lefthook.yml`) and `assets/claude-settings.json` (merge into
`.claude/settings.json`).

## Contents

- lefthook: pre-commit, commit-msg, pre-push
- The commit-msg hand-off and gated paths
- Claude Code hooks: after every edit, before stopping
- Permissions: deny and ask
- Merging `.claude/settings.json`
- Local overrides that switch a gate off
- How the hooks find the repo root
- Other agents
- Verified behaviour

## lefthook: pre-commit, commit-msg, pre-push

- `pre-commit` jobs run in parallel on the staged files: `no-secrets` (refuses any staged signing
  file, store API key, Play service-account key, Gradle signing properties, PEM, EAS
  `credentials.json` or `.env` file), `format` (Prettier check), `lint`
  (ESLint, no warnings), `typecheck` (the whole-project script: a change in one file can break
  another), `test-related` (`jest --ci --bail --findRelatedTests --passWithNoTests`; a staged file
  with no related test is not a failure here, `verify` runs everything).
- `commit-msg` runs `node scripts/git/check-commit-message.ts {1}` (next section).
- `pre-push` runs `npm run verify`.
- `assert_lefthook_installed: true` makes lefthook fail loudly when the hooks are not installed; the
  root `prepare` script (`scripts/hooks/install-git-hooks.ts`) installs them on every `npm install` /
  `npm ci` at the git top level, and skips with a one-line reason anywhere else.
- Each secret glob appears with and without `**/`: lefthook's matcher needs a `/` before `**/.env*`,
  so without the bare `.env*` a root `.env` slipped through (verified with lefthook 2.1.14).
- `no-secrets` excludes exactly `.env.example` (the one committed env file: the documented keys, no
  values, app-variants-and-environment). Verified 2026-10-04 with lefthook 2.1.14: a staged
  `.env.example` commits, a staged `.env` and `cfg/credentials.json` are refused.
- A job with `skip:`, `only:` or `exclude_tags:`, or an `exclude:` the baseline does not have, no
  longer guards what it says; `check-gate-wiring.mjs` fails each one.
- Android signing material is in the same list as iOS, because every app ships to both stores:
  `*.keystore`, `*.jks`, EAS's local `credentials.json` (it holds the keystore passwords), the Google
  Play service-account key (`*service-account*.json`, the file EAS Submit and the Play API lane read)
  and Gradle's `key.properties` / `keystore.properties` (a bare or local release lane keeps the
  keystore passwords there); iOS: `*.p8`, `*.p12`, `*.mobileprovision`, `AuthKey_*`, `ApiKey_*`.
  Verified 2026-10-10 with lefthook 2.1.14: staged `keys/play-service-account.json`,
  `android/key.properties`, `key.properties` and `android/keystore.properties` are each refused; a
  staged `.env.example` and `src/app.ts` commit. Name the Play key so it matches (for example
  `play-service-account.json`); a key saved under another name is not caught by any glob.

## The commit-msg hand-off and gated paths

The commit-message rules (Conventional Commits header, body, trailers) belong to
git-commits-and-reporting, which creates `scripts/git/` (the hook entry `check-commit-message.ts`, its
rule files, the shared sample list and `requirement-ref.json`) and keeps the hook and its own
`check-commits.mjs` on one rule set. Install it in the same change as `lefthook.yml`; a complete app
prints no SKIP for it. Only in an app adopted step by step, before that skill runs, does
`check-gate-wiring.mjs` print `SKIP scripts/git/check-commit-message.ts [script-target] not yet
created (git-commits-and-reporting creates it)`, and every commit then fails with `Cannot find
module`: loud, as it should be. Never remove the job to get a commit through.

What this skill owns is which files are gates: `gatedPaths` in `quality-gates.json` and the matcher
in `scripts/quality/gated-paths.ts` (`isGatedFile`, `gatedFilesIn`, `gatedPathsOf`). The commit
check asks the matcher, so a staged file matching a gated path needs a `Gate-Change: <reason>`
trailer, and a commit without one must not carry it. Verified 2026-10-04 with a stand-in check built
on the matcher: a staged `knip.json` without the trailer was refused and accepted with it; an app
`*.vectors.json` needed the trailer; a vectors file under `.agents/skills/` did not.

The canonical list also gates paths that other skills own, each because a quiet edit there would
loosen a check: the schema ledger (`contracts/schema-ledger.json`, run-migration), the network and
privacy contracts (privacy-and-store-declarations), the levels contract and generated level packs
(`contracts/levels.json`, `src/games/*/levels/pack-*.json`, level-generation-and-solvers), design
parity's waivers, reference manifest, fixture, mockup, device profiles and the two default devices'
references (`design/parity/{waivers,manifest,fixture}.json`, `design/parity/{mockup,devices}/**`,
`design/parity/iphone-16-pro/**`, `design/parity/android-parity/**`, design-visual-parity; never
`design/parity/**`, which would gate the sign-off ledger that changes with every look, and an app
with other parity devices adds `design/parity/<device>/**` for each), the CI workflows and
Dependabot (`.github/workflows/**`, `.github/dependabot.yml`, ci-pipeline-and-gates) and the pinned
Maestro install and screenshot tolerances (`scripts/e2e/install-maestro.sh`,
`scripts/e2e/screenshot-compare.ts`, e2e-maestro). A glob that matches nothing in an app costs
nothing. New migration steps (`src/data/migrations/v*.ts`) are not gated: adding one is ordinary
work, and a shipped step is pinned byte for byte by the gated ledger instead.

Find every gate change later with
`git log --format='%h %s%n%(trailers:key=Gate-Change)' --grep='^Gate-Change:'`.

## Claude Code hooks: after every edit, before stopping

- **PostToolUse `Edit|Write`** runs `scripts/hooks/after-edit.ts`. It formats the edited file with
  Prettier, runs `eslint --fix --max-warnings 0` on it, and on failure prints the problems to stderr
  and exits 2, so the agent sees them next to the tool result. Files outside the repo and non-code
  files are skipped. About 3 s per edit.
- **Stop** runs `cd "$(git rev-parse --show-toplevel)" && npm run -s check:fast 1>&2 || exit 2`:
  stdout goes to stderr, and a failure exits 2, which keeps the agent working with the errors in
  front of it.
- **Only exit 2 with stderr reaches the agent.** Any other exit is a non-blocking error: the agent
  never sees it, and the user sees only a one-line `hook error` notice carrying the first line of
  stderr (Claude Code hooks reference, "Exit code output", re-verified 2026-10-10).
- **Repeated Stop blocks are capped.** After Stop hooks have continued the turn 8 times in a row,
  Claude Code overrides the next block and ends the turn; the count resets each time the agent calls a
  tool, so a Stop hook that keeps the agent fixing things is not cut short. The cap can be raised with
  the `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` environment variable, and the hook's input carries
  `stop_hook_active: true` while a continuation is already running (hooks reference, re-verified
  2026-10-10). When the turn ends with the gate still red, report the failing gate to the developer
  instead of working around it.
- **A Stop block whose stderr says a file is missing is downgraded.** Claude Code treats a Stop hook
  that exits 2 with nothing on stdout and `No such file or directory` in stderr as a non-blocking
  error (same page). The Stop command sends `check:fast`'s stdout to stderr; if `check:fast` itself
  cannot start (no `node_modules`), run `npm ci` rather than trusting a turn that ended quietly.
- **Hooks change nothing silently beyond formatting.** After the edit hook reformats a file, read it
  again before the next edit of that file.
- **The tools run through `npx --no --`,** which runs the repo's installed copy and refuses to
  download one (verified with npm 11.17: `npm error npx canceled due to missing packages and no YES
  option`). The `--` matters: without it npm reads the tool's flags (`--print-config`) as its own.
- **Start the agent at the repository root.** Hooks and permissions load only from the
  `.claude/settings.json` of the folder the session starts in; there is no parent-folder fallback.

## Permissions: deny and ask

- `permissions.deny` stops the file tools and recognised shell commands from reading signing and
  store keys of both platforms: App Store Connect keys and iOS signing files (`~/.appstoreconnect/**`,
  `*.p8`, `AuthKey_*`, `*.p12`, `*.mobileprovision`) and Android's (`*.keystore`, `*.jks`, EAS's
  `credentials.json`, the Play `*service-account*.json`, `key.properties`, `keystore.properties`).
  Deny rules block in every permission mode, `bypassPermissions` included, but they do not cover
  arbitrary subprocesses (a Node script that opens the file itself), so "never open or print a key"
  still applies to scripts. A team that stores a key under another name adds its rule to both
  `.claude/settings.json` and `quality-gates.json` `claudeSettings` in one gate change, so the rule
  becomes part of the gate (both the guardrail and `check-gate-wiring.mjs` accept rules of the app's
  own without that, as long as every gate rule is still there).
- The deny list also blocks the common hook-bypass commands: `Bash(git commit *--no-verify*)`,
  `Bash(git commit -n*)` (`-n` first, alone or clustered as `-nm "wip"`), `Bash(git commit * -n*)`
  (`-n` later, `git commit -m x -n`) and `Bash(git push *--no-verify*)`. A Bash rule matches the text
  as written, so a cluster with `n` after another letter (`git commit -m x -an`) and a message
  containing ` -n` slip past or trip it; `check-bypasses.mjs` matches every short-flag cluster that
  holds `n` in scripts, hooks and workflows, and lefthook's `assert_lefthook_installed` plus the
  pre-push `verify` still run.
- `permissions.ask` makes every edit to a gate file prompt the developer: the configs
  (`eslint.config.mjs`, `quality-gates.json`, `lefthook.yml`, `knip.json`, `.prettierrc.json`,
  `.npmrc`, `jest.config.js`, `jest.sim.config.js`, `stryker.config.json`, `tsconfig*.json` at the
  root, `src/tsconfig.json`, `.prettierignore`, `babel.config.js`, `jest.setup.ts`), the knip reasons
  (`contracts/knip-ignores.json`), the gate scripts (`scripts/quality/check-quality-gates.ts`,
  `gate-diff.ts`, `gated-paths.ts`, `verify-plan.ts`, `run-verify.ts`, `device-only.ts`,
  `scripts/hooks/**`) and both Claude Code settings files (`.claude/settings.json`,
  `.claude/settings.local.json`). The rules are anchored (`Edit(/tsconfig*.json)`; in project
  settings a leading `/` is the project folder): an unanchored `Edit(**/tsconfig*.json)` also prompted
  for every tsconfig inside installed skills. The other gated paths (frozen goldens, vectors and other
  skills' contracts) are guarded by the `Gate-Change:` trailer rather than a prompt.
- **Which modes prompt** (permission-modes page, re-verified 2026-10-10): explicit `ask` rules prompt
  in the default mode, in `acceptEdits`, in `auto` and in `bypassPermissions`; `dontAsk` and a
  headless run that cannot answer deny the edit instead, which is the intended stop-and-ask. But mode
  behaviour has changed between Claude Code releases, an `Edit` rule matches only Claude's file tools
  and the shell file commands it recognises (not a script that writes the file), and other agents
  have no such rules at all. So the prompt is the first fence, not the only one:
  `check-gate-wiring.mjs`, the guardrail in `verify` and the `Gate-Change:` trailer check catch a gate
  edit that got past it. A team that wants nobody to run unprompted sets
  `"permissions": { "disableBypassPermissionsMode": "disable" }` (managed settings make it binding;
  in project settings a developer can still override it in their own).

## Merging `.claude/settings.json`

The file may already hold keys the gates do not own. Merge, never replace:

- Keep `enabledPlugins` (Expo's official plugin, when the team uses it) and the skill library's
  entries (`permissions.allow` rules that let installed skills' scripts run without prompts).
- The asset carries two optional keys that are not gates (no checker reads them; drop either one if
  the team does not want it):
  - `"enabledPlugins": { "expo@claude-plugins-official": true }` turns on Expo's official Claude Code
    plugin, whose skills are the Expo API reference this library hands off to (expo-router,
    eas-update, ...).
  - `"skillListingBudgetFraction": 0.04` raises the share of the context window Claude Code spends on
    the skill listing from its default 1% to 4%. With this library and Expo's skills installed, the
    default budget drops the descriptions of the least-used skills, so they stop triggering.
    Verified 2026-10-10 in the Claude Code skills docs ("Skill descriptions are cut short"); re-verify
    at https://code.claude.com/docs/en/skills.
- Add every `deny` and `ask` rule and both hooks from `assets/claude-settings.json`.
- The guardrail (`diffContains`) and `check-gate-wiring.mjs` both require every `deny` and `ask` rule
  and every hook of `quality-gates.json` `claudeSettings` to be present, in any order, next to the
  app's own (a `Read(./.env)` deny rule, another PostToolUse hook). Each gate hook must keep its
  matcher, timeout and command byte for byte: an appended `|| true` or a dropped `1>&2` defuses it and
  fails both checks. Extra top-level keys and an `allow` list are fine (an `allow` rule that permits a
  bypass is not).
- Editing `.claude/settings.json` itself triggers the developer's approval prompt (it is in `ask`):
  that is the human step for new hooks and permissions.

## Local overrides that switch a gate off

Two local files can switch a gate off on one machine without anyone seeing it:
`lefthook-local.yml` (lefthook merges it; lefthook recommends git-ignoring it, so it is usually
untracked, but the canonical `.gitignore` does not list it yet, so in a canonical app it can be
committed too) and `.claude/settings.local.json` (Claude Code merges it; the canonical `.gitignore`
ignores it).
`check-gate-wiring.mjs` reads both when they exist (they never reach a fresh clone, so run it on the
developer's machine): a `skip:`, `only:`, `exclude:` or `exclude_tags:` line, a `pre-commit:`,
`commit-msg:` or `pre-push:` section (a local job added to or redefining a gate hook) or
`assert_lefthook_installed: false` in `lefthook-local.yml` (also `.yaml` and the dotted names) is a
`lefthook` problem; `disableAllHooks` or a bypass `allow` rule in `settings.local.json` is a
`claude-settings` problem. The guardrail reads `lefthook dump --format json`, which shows the merged config, and fails any
`skip`, `only`, `exclude` or `exclude_tags` the expected config does not have; it also fails
`disableAllHooks` in either settings file. Verified 2026-10-04: a `lefthook-local.yml` with
`skip: true` on the `lint` job and a `settings.local.json` with `disableAllHooks: true` each failed
the guardrail; removing them made it pass.

## How the hooks find the repo root

The Stop command locates the repository with `git rev-parse --show-toplevel`; `after-edit.ts`,
`run-verify.ts` and `check-quality-gates.ts` resolve the root from their own location
(`scripts/<folder>/` is two levels below it). Both hooks therefore work when the agent's shell has
moved into a subfolder such as `src/features/`, and need nothing from the environment. The repo must
be a git repository (`check:fast` and lefthook need git anyway).

## Other agents

Claude Code is the agent these hooks are written for. Agents without an edit or stop hook (Codex,
Cursor and others) still meet every lefthook job on commit and push; put "run `npm run -s
check:fast` before saying a change is done" in `AGENTS.md`, and treat a red `check:fast` as
unfinished work. The checkers and `verify` work the same for every agent.

## Verified behaviour

Checked on 2026-10-04 in a copy of the reference Expo SDK 57 app with this skill's templates applied
(lefthook 2.1.14, ESLint 9.39.5, TypeScript 6.0.3, Jest 29.7 + jest-expo 57.0.5, knip 6.38.0, npm
11.17, Node 26.4):

- The guardrail passed on the canonical configs (four ESLint probes, both tsconfig programs, the
  Jest thresholds, the npm scripts, `.claude/settings.json`, `knip.json`, `lefthook dump`, `.npmrc`)
  in 16 s, and reported `max-params[1]: expected 3, got 5` for both logic probes after `max-params`
  was raised in `eslint.config.mjs`.
- The PostToolUse command, run from `src/features/`, exited 0 on a clean file and 2 on a file using
  `Math.random`, naming the rule and the file.
- The Stop command, run from `src/features/`, exited 0 on a clean tree (7 s warm) and 2 after a
  `Math.random` was added. On its first run it also caught two limit violations in this skill's own
  new code (`max-params`, `sonarjs/no-duplicate-string`), which were fixed in the templates.
- `lefthook validate` printed `All good`; `lefthook install` synced the three hooks; every
  pre-commit job passed in 2.3 s; the commit-msg job failed with `Cannot find module` until a commit
  check existed.
