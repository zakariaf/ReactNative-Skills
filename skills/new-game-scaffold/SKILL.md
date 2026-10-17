---
name: new-game-scaffold
description: Starts a new game by script - contracts/games.json entry, catalog keys, a white-label app when multi-package - and proves it complete. Use when adding or starting a new game or checking one is complete. Not for rules (game-rules-engine).
---

# New game scaffold

Turns "the next game is chosen" into a declared, named, translated starting point written by a script,
then walks the game through the build order of the games skills and proves, with a second script, that
the finished game has every part, agrees with its declaration and (when it is its own white-label app)
carries no placeholder a store would see. The game lives in `src/games/<game-id>/` of the one Expo
app; when multi-package, one game can also be one app in `apps/<game-id>/`.

## Rules that must hold

1. **Start every game with `scaffold-game.mjs`, never by copying another game's folder.** Why: a copied
   game keeps the other game's ids, catalog keys, saved-run namespace and settings in corners; the
   script fills every id form from one id and never overwrites a file.
2. **The game id is kebab-case, starts with a letter, and never changes after release; every
   identifier derives from it by one rule** (folder, `identity.id`, catalog namespace `<id>.`, saved
   runs, `<Pascal>` types, `<CONST>_` constants). Why: the id is inside every saved run on every
   device, and a leading digit is not a valid Android package part.
3. **The game's design notes are data in `contracts/games.json`, and the code must agree with them:**
   class, pan mode, levels and pack layout, daily, endless, hints, continue, every way of losing. Hints
   and continue have no default; a daily-only or endless-only game declares `levels: null` (its
   `contracts/levels.json` entry has `packCount` 0). Why: a declaration that promises a hint or a
   continue the rules lack ships a dead button; the complete check loads the module and compares it
   with the entry, and holds `contracts/levels.json` (level-generation-and-solvers) to the same pack
   layout.
4. **Every catalog of the app carries the game's keys:** `<id>.name`, one `<id>.lose.<reason>` per
   declared way of losing and every `<id>.*` key the game's code names, the same keys in every locale,
   no empty text; approved copy (`contracts/copy-source.json`) wins and retired keys are gone. Why: a
   missing key is a broken screen in one language, found by a player.
5. **Never overwrite.** `--write` writes nothing when any value conflicts; a game or app that exists is
   completed with `--add-missing`, which adds absent files, keys and entries and never changes a value.
   Why: an existing game holds decisions nobody wants silently reset.
6. **No template placeholder is left** (`__GAME_ID__`, `__GAME_PASCAL__`, `__GAME_CAMEL__`,
   `__GAME_CONST__`, any `__UPPER_SNAKE__`) in the game folder or its app, nor in the game's sims,
   board golden and E2E flows; generated native folders, build output and Pods are never scanned. Why: a placeholder compiles in a string and ships.
7. **Build the parts in the documented order, each with its own skill, and finish with
   `check-game-scaffold.mjs . --game <id> --stage complete`.** It never skips: every part, the
   evidence (sims, a pixel golden, an E2E flow), the hosted binding `<id>-hosted.ts` registered as
   `createGameHost(<CONST>_HOSTED, ...)` in `<gamesDir>/game-registry.ts`, the declared ways of losing
   and, for a white-label app, its real root and entry (polyfills, then `expo-router/entry`) instead of
   the placeholder entry. Why: nobody reads every file of a game; the gate proves nothing is missing and names the
   skill for each missing part.
8. **The game module loads headless** (pure TypeScript through `<id>-game.ts`). Why: bots, solvers,
   goldens and this check run it in Node; a React Native import in its graph breaks all of them.
9. **`npm run new-game` and the skill write identical bytes** (`scripts/games/new-game.ts` forwards to
   the installed generator); a declared `new-game` script runs a file that exists. Why: two generators
   drift.
10. **When multi-package, every white-label app lists the same dependency set at the same versions.**
    Why: native modules autolink per app and `expo install --check` sees only the app's own list; a
    drift crashes at launch or compiles two copies of one native module.
11. **When multi-package, an app's config is one composer statement, its per-app values live in
    `app-settings.ts` (read only by `app.config.ts`, never `null`), its native folders are ignored
    anchored, its Metro cache is keyed on `EXPO_PUBLIC_*`, and its fonts are byte-for-byte copies.**
    Why: native settings come only from the composer and plugins; `null` reached the device as `{}`;
    an unkeyed cache shipped development transforms in a production export (verified on SDK 57).
12. **When multi-package, store ids derive from one prefix and account-bound values stay documented
    placeholders until a human supplies them;** the complete stage fails `ship-placeholder` on each by
    name, and no option turns one into a pass. Why: a placeholder bundle id, privacy link or sample ad
    id in a store build is a rejected review or ads nobody is paid for.

## Workflow

1. **Design notes first.** Read [references/new-game-checklist.md](references/new-game-checklist.md)
   ("Before code"). Agree with the developer: the id ([references/ids-and-names.md](references/ids-and-names.md)),
   the name, class, pan mode, levels and packs, daily, endless, hints, continue, the ways of losing.
   Ask for hints and continue; never assume them.
2. **Plan the start:** `node ${CLAUDE_SKILL_DIR}/scripts/scaffold-game.mjs . --game <id> --name "<Name>"
   --hints none|solver --continue none|once [--levels 3x30] [--daily] [--endless] [--pan-mode swipe]
   [--class realtime] [--lose-reason <slug>]...` Read the plan (compare
   [examples/lights-out/scaffold-plan.txt](examples/lights-out/scaffold-plan.txt)). A `conflict` means
   the game exists: use `--add-missing`. When multi-package and the game is its own app, add `--app`
   after reading [references/white-label-apps.md](references/white-label-apps.md); a `deps-lockstep`
   failure is fixed first with dependency-management.
3. **Write it:** the same command with `--write` (white-label: then `npm install`). Once per repo,
   copy `templates/scripts/games/` and add `"new-game": "node scripts/games/new-game.ts"` to
   `package.json`.
4. **Check the start:** `node ${CLAUDE_SKILL_DIR}/scripts/check-game-scaffold.mjs . --game <id>` until
   `RESULT: PASS`; for a white-label app also `npx expo config --json` in `apps/<id>` per variant,
   `npx tsc --noEmit -p apps/<id>` and `npx eslint --max-warnings 0 apps/<id>`. Commit on its own.
5. **Build the game in order** (the table in the checklist): kit and rules (game-rules-engine, using
   the placeholder table the scaffold printed), real-time sim (realtime-game-loop), bot sims
   (game-balance-and-bots), levels (level-generation-and-solvers), canvas surface and golden
   (skia-canvas-rendering), intent function (canvas-gestures-and-hit-testing), the module, texts
   (i18n-strings-and-catalogs), the hosted binding and its registry factory (game-session-host),
   how-to-play, sounds and haptics (optional), for a white-label app its icon and splash
   (icons-app-icon-and-splash) and root (app-startup-and-bootstrap), the E2E flow on a named iOS
   simulator and a named Android emulator (e2e-maestro), screen parity (design-visual-parity). Each
   step test-first with its own check.
6. **Prove it complete:** `node ${CLAUDE_SKILL_DIR}/scripts/check-game-scaffold.mjs . --game <id> --stage complete`;
   fix every line ([references/checker.md](references/checker.md)) and rerun until `RESULT: PASS`,
   then `npm run verify`. A white-label app before the human steps ends with exactly its
   `ship-placeholder` lines: that is the finished state before those steps, never a pass.
7. **Report and hand over:** what a player can now do, the open human steps with the placeholder each
   replaces (one message shaped like [examples/developer-request.md](examples/developer-request.md)),
   the non-blocking ones (play-test, native review), what could not be verified without a device.
   Uploads and store-console changes are outward-facing: stop and ask first.

## Definition of done

- [ ] The game was started by `scaffold-game.mjs` with its real hints and continue, and its entry in
      `contracts/games.json` says what the rules do.
- [ ] `check-game-scaffold.mjs . --game <id>` passed before any game code was written.
- [ ] Every part exists and was built test-first by its skill; `npm run verify` is green.
- [ ] White-label: the app type-checks, lints and `npx expo config --json` works for every variant;
      the open placeholders are listed in the report as human steps.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-game-scaffold.mjs . --game <id> --stage complete` prints `RESULT: PASS`
      (white-label before the human steps: only `ship-placeholder` lines, reported as open steps).

The scaffold stage may print `SKIP src/i18n/catalogs [catalog-missing-key] not yet created
(i18n-strings-and-catalogs creates it)` in an app without catalogs; an app with no game prints
`NOT APPLICABLE: the app has no game (...)`. The complete stage never skips.

## Anti-patterns

- **`cp -R src/games/<other> src/games/<new>` and search-and-replace.** Old ids, keys and tuning
  survive; scaffold, then copy the rules template with the printed placeholder table.
- **Declaring `hints: solver` or `continue: once` "for later".** The complete check fails the mismatch;
  declare what the rules do today and change both together.
- **Renaming a game id after release.** Every saved run and statistic is keyed on it; keep the id and
  change only the display name.
- **Moving files aside so `--write` works.** Use `--add-missing`; it lists what it keeps.
- **A lose reason only in code** (`'<id>.lose.board-full'` with no declaration and no catalog text).
  Declare it, then add its text to every catalog.
- **Importing a screen, a store or `react-native` into `<id>-game.ts`.** The module stops loading
  headless; the session host attaches the surface.
- **Treating the scaffold stage as done.** It proves the start only; the game is done at
  `--stage complete`.
- **White-label: installing a package in one app only, editing `ios/` or `android/`, importing
  `app-settings.ts` from app code, or writing `null` into it.** Install in every app; change the
  composer or a plugin; read `expo.extra` through the typed reader; leave the key out.
- **White-label: inventing a real-looking ad id or privacy link "for now", or calling the
  `ship-placeholder` lines a pass.** Keep the documented placeholders; report them as open steps.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/new-game-checklist.md](references/new-game-checklist.md) | Design notes, step 0, the build order with skills and proofs, proving completion, human steps, release | Workflow steps 1, 5 and 6 |
| [references/ids-and-names.md](references/ids-and-names.md) | The id and its four forms, identifiers inside and outside the game, store ids | Step 1 |
| [references/white-label-apps.md](references/white-label-apps.md) | When multi-package: the apps block, every skeleton file and why, lockstep, store ids and placeholders | Step 2 with `--app`, or when an app rule fails |
| [references/checker.md](references/checker.md) | Both scripts: options, config keys, every rule with its fix, SKIP and NOT APPLICABLE, troubleshooting | Steps 4 and 6 |
| `templates/contracts/games.json` | The declaration file with no game yet; the generator starts a new one from it | Step 3 (the generator writes it) |
| `templates/contracts/games.schema.json` | The declaration's JSON schema, every field explained | When editing an entry by hand |
| `templates/scripts/games/` | `new-game.ts` (the npm script), `find-generator.ts` and its test | Step 3, once per repo |
| [examples/lights-out/scaffold-plan.txt](examples/lights-out/scaffold-plan.txt) | A real dry run for Lights Out (levels, a daily, one way of losing) | Step 2 |
| [examples/lights-out/games.json](examples/lights-out/games.json) | The declaration that run writes | Step 2 |
| [examples/white-label/games.json](examples/white-label/games.json) | A white-label declaration: the apps block and a real-time game with an endless run | Step 2 with `--app` |
| [examples/white-label/app-settings.ts](examples/white-label/app-settings.ts) | The settings file the generator writes for that app, placeholders included | Step 2 with `--app` |
| [examples/developer-request.md](examples/developer-request.md) | The one message asking for the human-only steps, each with its default | Steps 1 and 7 |
| `scripts/scaffold-game.mjs` | Generator: plan (default), `--write`, `--add-missing`, `--app`; never changes an existing value | Steps 2 and 3 |
| `scripts/check-game-scaffold.mjs` | Checker: `--stage scaffold` (default) and `--stage complete` | Steps 4 and 6, and at the end |
| `scripts/lib/` | `games-contract.mjs` (id, layout, declaration), `game-catalogs.mjs`, `json-text.mjs`, `scaffold-plan.mjs`, `app-skeleton.mjs` (the white-label renderer), `game-checks.mjs`, `app-checks.mjs`; `app-modules.mjs` and `ship-placeholders.mjs` are synced (do not edit here) | When changing a script |
| `scripts/selftest.mjs` | Proves both scripts on the fixtures, building each base with the generator itself | After changing a script or a template |
| `scripts/check-lib.mjs` | Shared script library, synced (do not edit here) | Never by hand |
| `assets/shared.json` | Declares the synced files | When adding a shared file |
| `tests/bases/` | `app/` (a small app), `monorepo/` (white-label: an existing app, shared fonts, the apps block), `complete-game/` (loadable stand-ins of every part of a finished game) | When a base changes |
| `tests/fixtures/` | `scaffold-game/`, `scaffold-game-app/`, `check-game-scaffold/`, `check-game-complete/`, `check-game-app/`, `check-game-app-complete/`: good, pass-*, bad-* (one per rule) and error-* cases; `check-example-lights-out/` and `check-example-white-label/` hold the examples to the checker | When adding a rule or changing an example |

## Related skills

- `game-rules-engine` - the kit, the rules, the bot and the module the scaffold's id names.
- `level-generation-and-solvers` - solvers, packs and the daily level the declaration announces.
- `game-balance-and-bots` - the bot simulations the complete stage requires.
- `realtime-game-loop` - the `sim/` and the `<id>-realtime.ts` spec of a real-time game.
- `skia-canvas-rendering` and `canvas-gestures-and-hit-testing` - the surface, its golden and the intent function.
- `game-session-host` - the hosted binding `<id>-hosted.ts` and its factory in `game-registry.ts`.
- `i18n-strings-and-catalogs` - writing and translating the game's texts; the approved copy.
- `e2e-maestro` - the game's flow on iOS and Android.
- `dependency-management` - lockstep installs across white-label apps.
- `app-variants-and-environment` - the single app's identity, variants and Metro cache key.
- `app-startup-and-bootstrap` - a white-label app's root layout, which replaces the placeholder entry.
- `icons-app-icon-and-splash`, `audio-and-haptics-feedback`, `design-visual-parity` - per-app icon and splash, game feedback, screen parity.
- `privacy-and-store-declarations` - audits, the privacy answers, age rating and app-ads.txt.
- `ios-release-testflight`, `android-release-play`, `eas-build-and-submit` - shipping once the human steps are done.
