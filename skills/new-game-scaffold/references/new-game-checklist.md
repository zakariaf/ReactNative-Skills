# The new-game checklist

Everything between "the next game is chosen" and "the game ships", in order, with the skill that
builds each part and the check that proves it. A game is a module in `src/games/<game-id>/` of the one
Expo app; when multi-package, it is also its own white-label app in
`apps/<game-id>/` (see `white-label-apps.md`). It provides the `GameModule` members of the game kit
(game-rules-engine owns `src/core/game/`) and nothing else.

## Contents

- Before code: the design notes
- Step 0: scaffold the game
- The build order
- Proving the game is complete
- Steps only a human can do
- Release

## Before code: the design notes

Write these down with the developer before any file exists. Each answer becomes one field of the
game's entry in `contracts/games.json`, and the complete check later holds the code to it:

| Question | Field | Default when the design is silent |
|---|---|---|
| How does the game run: turn by turn, simulate-then-replay (a shot plays out), or real time? | `class` | `turn-based` |
| Which pan gesture moves the game: none (taps only), a swipe, a drag, an aim? | `panMode` | `none` (real-time games steer with a stick and declare `none`) |
| Does it ship generated level packs, and in what layout? | `levels` | `null` (no packs) |
| A daily level? An endless run (difficulty 100, never won)? | `daily`, `endless` | both `false`; a daily-only or endless-only game declares `levels: null` (no packs; its LevelsSpec holds only that mode, and its `contracts/levels.json` entry has `packCount` 0) |
| A hint: does a solver prove the next move? | `hints` | **no default**: the rules decide |
| One continue after a loss? | `continue` | **no default**: the rules decide |
| Every way of losing, in kebab-case words for what happened | `loseReasons` | `[]` (a game that cannot be lost) |

Hints and continue have no default on purpose: a declaration that promises a hint or a continue the
rules lack ships a button that does nothing (and a store text that lies). Ask.

Also agree: the game id (kebab-case, permanent: `ids-and-names.md`), the display name, and, when the
app has approved copy (`contracts/copy-source.json`, i18n-strings-and-catalogs), whether the game's
texts are in it yet.

## Step 0: scaffold the game

```sh
node ${CLAUDE_SKILL_DIR}/scripts/scaffold-game.mjs . --game lights-out --name "Lights Out" \
  --hints none --continue once --levels 3x30 --daily --lose-reason out-of-moves          # plan
node ${CLAUDE_SKILL_DIR}/scripts/scaffold-game.mjs . --game lights-out --name "Lights Out" \
  --hints none --continue once --levels 3x30 --daily --lose-reason out-of-moves --write  # write
node ${CLAUDE_SKILL_DIR}/scripts/check-game-scaffold.mjs . --game lights-out             # scaffold stage
```

The plan prints one line per file (`new`, `same`, `edit (+ ...)`, `keep`, or `FAIL ... [conflict]`)
and the placeholder table every games skill's templates use
(`__GAME_ID__=lights-out __GAME_PASCAL__=LightsOut __GAME_CAMEL__=lightsOut __GAME_CONST__=LIGHTS_OUT`).
It writes the entry in `contracts/games.json` (with `contracts/games.schema.json` the first time) and
the game's name and lose keys in every catalog of `src/i18n/catalogs/`. It writes no code: the game
folder appears with its first real file, the rules template of game-rules-engine (git stores no
empty folder, so the scaffold does not pretend).

`npm run new-game -- --game lights-out ...` runs the same generator once
`scripts/games/new-game.ts` exists (copy `templates/scripts/games/` and add
`"new-game": "node scripts/games/new-game.ts"` to `package.json`; quality-gates owns the shared
script list, so add it there when the app keeps one). Commit the start on its own:
`feat(lights-out): declare the game`.

## The build order

Each layer is tested before anything depends on it (test-first, one behaviour per commit; tdd-workflow):

| # | Part | Skill | Proof |
|---|---|---|---|
| 1 | The kit `src/core/game/` (once per app) and fast-check pinned exactly | game-rules-engine | game-rules-engine's checker |
| 2 | Rules: types, tuning, `create`, `listMoves`, `applyMove`, `outcome`, engine, persistence, stats, the bot and example states (copy the template with the scaffold's placeholder table) | game-rules-engine | game-rules-engine's checker with `--game <id>` |
| 3 | Real-time games: the fixed-step sim in `sim/` and the `RealtimeSpec` in `<id>-realtime.ts`, joined to the module as `realtime` | realtime-game-loop | its checker |
| 4 | Bot simulations `test/sims/<id>/*.sim.test.ts`: winnable, the difficulty curve inside its bands, every run ends; before any level pack is generated | game-balance-and-bots | `npm run test:sim` |
| 5 | Levels: solver (or witness), par, the level plan, generated packs, daily salt and difficulty; the game's `contracts/levels.json` entry states the same pack layout, `daily` and `endless` as `contracts/games.json` (a daily- or endless-only game: `packCount` 0, `levelsPerPack` 0) | level-generation-and-solvers | its checker |
| 6 | The canvas surface `canvas/<id>-surface.ts`: layout, draw, timeline, palettes; a pixel golden named after the game | skia-canvas-rendering, golden-and-snapshot-tests | `npm run test:golden` |
| 7 | `canvas/intent-to-move.ts`: hit-testing on the drawn layout, only listed moves, the declared pan mode; 44 pt / 48 dp targets, VoiceOver and TalkBack labels | canvas-gestures-and-hit-testing, accessibility-as-code | their checkers |
| 8 | The module `<id>-game.ts` and its contract test `<id>-game.test.ts` | game-rules-engine | the contract test |
| 9 | Texts: every `<id>.*` key in every catalog, drafts on the review queue | i18n-strings-and-catalogs | `npm run i18n:verify` |
| 10 | Host the game: the binding `<id>-hosted.ts` = `{ ...<CONST>_GAME, Surface }` typed `HostedGame` (the `Surface` is the board component `canvas/<id>-board.tsx` over the canvas surface), one factory `(deps) => createGameHost(<CONST>_HOSTED, { ...deps, options: GAME_HOST_CONFIG['<id>'] })` in the fixed `<gamesDir>/game-registry.ts`, the game screen, pause, undo, hints, continue, saves, results | game-session-host | its checker |
| 11 | How to play: the tutorial or how-to-play page (texts through the catalogs, every state of the screen) | screen-contracts, i18n-strings-and-catalogs | their checkers |
| 12 | Sounds and haptics (optional): move, win and lose feedback that respects the silent switch and the system settings | audio-and-haptics-feedback | its checker |
| 13 | White-label: the app's own icon and splash (light, dark and tinted; Android adaptive) | icons-app-icon-and-splash | its checker |
| 14 | White-label: the app's root `src/app/_layout.tsx`, then the placeholder `index.ts` replaced by the real entry (Intl polyfills first, `expo-router/entry` last; `main` stays `index.ts`), the complete stage's `entry` rule | app-startup-and-bootstrap | `check-game-scaffold.mjs --stage complete` |
| 15 | An E2E flow named after the game that opens it and makes one real move, on a named iOS simulator and a named Android emulator | e2e-maestro | the flow passes on both |
| 16 | Screen parity: every game screen against the approved design baseline | design-visual-parity | its checker |
| 17 | Network and privacy audits after the first prebuild (a game that needs the network uses the ApiClient port, networking-and-server-state; an offline-only app keeps the offline-only profile of privacy-and-store-declarations) | privacy-and-store-declarations | its audits |

## Proving the game is complete

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-game-scaffold.mjs . --game lights-out --stage complete
npm run verify
```

The complete stage is a completeness gate: it never prints SKIP or NOT APPLICABLE. It fails until
every part exists (each `part-missing` line names the skill that builds it), the evidence exists
(sims, a golden, an E2E flow), the registry hosts the game (`createGameHost(<CONST>_HOSTED, ...)`
with the binding imported from `<id>-hosted`), the loaded module agrees with the declaration (class,
pan mode, hints, continue, levels, packs, daily, endless), `contracts/levels.json` states the same
pack layout, the rules produce exactly the
declared ways of losing, every key the game uses is in every catalog, no template placeholder is left
and, for a white-label app, the app starts its real root and no outward-facing placeholder is left
(`white-label-apps.md`). Then:

- [ ] Rules coverage 95/95/95/90 and the module's contract test green (game-rules-engine).
- [ ] Sims inside their bands; every shipped level proven solvable.
- [ ] The golden and the flow were looked at (open every PNG; watch the flow on both platforms once).
- [ ] Drafted translations listed as review pending in the report (never a gate).

## Steps only a human can do

Ask in one message (shape: `examples/developer-request.md`), each with the one action and the
default that applies meanwhile; keep building with the defaults:

| Step | What a human does | Until then |
|---|---|---|
| Name | Approves the display name | the scaffold's `--name` in every language |
| Store records (white-label) | Creates the App Store Connect app (bundle id) and the Google Play app (package), both permanent | the build runs; nothing uploads |
| Privacy and support | Gives the privacy-policy host and path and the support address | `example.com` / `support@example.com`; the complete stage fails `ship-placeholder` |
| Ads (when the app shows ads) | Creates the AdMob apps (iOS and Android) and the ad units | Google's sample ids (test ads only); the complete stage fails on each |
| Products (when sold) | Creates each in-app product `<bundle id>.<suffix>` in both stores | purchases cannot be tested |
| Privacy answers | Fills the App Privacy questionnaire (App Store Connect) and the Data safety form (Play Console) from the declarations privacy-and-store-declarations prepares | nothing can be submitted for review |
| Age rating | Answers the age-rating questionnaire (App Store Connect) and the IARC content-rating questionnaire (Play Console); a game with cartoon or fantasy violence says so | nothing can be submitted for review |
| Store listing | Approves the listing texts per language, the screenshots and the promotional assets (the release skills prepare them) | no listing, so no release |
| app-ads.txt (when the app shows ads) | Publishes `app-ads.txt` on the developer website listed in both stores, after the first release (privacy-and-store-declarations, admob-ads-and-consent) | ad fill stays limited |
| Play-test | Plays a TestFlight and a Play internal-testing build | listed as not blocking |
| Native review | Reads the drafted translations | listed as review pending, never a gate |

## Release

Release only after the blocking human steps (ios-release-testflight, android-release-play,
eas-build-and-submit). Uploads, store-console changes and pushes are outward-facing: stop and ask
first. A report never cites a failing complete stage as passed: list the open placeholders as open
human steps.
