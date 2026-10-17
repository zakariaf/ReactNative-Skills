# Ids and names of a game

Every identifier a new game gets, where it is used, and the one form each takes. All of them come
from the game id by one rule; the store values of a white-label app are a human's.

## Contents

- The game id
- Its four forms
- Identifiers inside the game
- Files and names outside the game folder
- Store identifiers (white-label apps)

## The game id

kebab-case ASCII: lowercase letters and digits, words joined by single hyphens, **starting with a
letter** (`lights-out`, `sliding-puzzle`, `arena-chase`). A leading digit would make the Android
package part invalid (Java package parts start with a letter), so `2048-merge` is `merge-2048`. The
generator refuses ids that name a folder, alias or tool of the app: `app`, `apps`, `core`, `game`,
`games`, `kit`, `new-game`, `packages`, `shared`, `test`, `testing`.

**The id never changes after the first release.** It is the folder, `identity.id`, the catalog
namespace and the key of every saved run on every player's device; renaming it orphans their saves and
statistics. Choose it before the scaffold, the way you would choose a database table name.

## Its four forms

| Form | Example | Used for |
|---|---|---|
| kebab (the id) | `lights-out` | folder `src/games/lights-out/`, `identity.id`, catalog keys `lights-out.*`, file names `lights-out-engine.ts`, the declaration's `id`, the saved run's `gameId` |
| Pascal | `LightsOut` | types: `LightsOutState`, `LightsOutMove`, `LightsOutEvent` |
| camel | `lightsOut` | local values and hooks that name the game |
| UPPER_SNAKE | `LIGHTS_OUT` | module constants: `LIGHTS_OUT_ENGINE`, `LIGHTS_OUT_RULES`, `LIGHTS_OUT_GAME`, `LIGHTS_OUT_HOSTED` |

Every games skill's templates use `__GAME_ID__`, `__GAME_PASCAL__`, `__GAME_CAMEL__` and
`__GAME_CONST__` for these forms; `scaffold-game.mjs` prints the filled table. `check-game-scaffold.mjs`
fails `placeholder-left` on any `__UPPER_SNAKE__` token left in the game folder (or the white-label
app) and in the game's sims, board golden and E2E flows outside it, except platform names such as `__DEV__`, `__OBJC__`, `__LINE__` and `__FILE__`. Generated native
folders (`ios/`, `android/`), `build/`, `out/`, Pods and `node_modules` are never scanned: after the
first native build they hold hundreds of such macros.

## Identifiers inside the game

| Identifier | Rule | Example |
|---|---|---|
| Catalog keys | `<id>.<area>.<element>`, 2 to 5 kebab segments (i18n key grammar) | `lights-out.hud.moves` |
| Name key | `<id>.name` (`identity.nameId`) | `lights-out.name` |
| Lose keys | `<id>.lose.<reason>`, one per declared way of losing | `lights-out.lose.out-of-moves` |
| Pack ids | kebab-case per pack | `first-sparks` (name key `lights-out.pack-name.1`) |
| Counter ids | kebab-case and permanent (they are save keys) | `boards-cleared` |
| Event kinds | past-tense kebab-case | `cell-toggled` |
| Daily salt | a 16-bit number fixed forever, default FNV-1a of the id folded to 16 bits (the scaffold plan prints it; level-generation-and-solvers owns the rule) | frozen in the levels step |

## Files and names outside the game folder

| Thing | Name |
|---|---|
| The declaration | an entry `{ "id": "lights-out", ... }` in `contracts/games.json` |
| The pack layout | an entry `{ "id": "lights-out", "packCount": 3, "levelsPerPack": 30, ... }` in `contracts/levels.json` (level-generation-and-solvers): a game with packs, or `"packCount": 0, "levelsPerPack": 0` for a daily- or endless-only game; none for a game with no packs and no mode |
| The hosted binding | `<gamesDir>/<id>/<id>-hosted.ts` exports `<CONST>_HOSTED` = `{ ...<CONST>_GAME, Surface }` (game-session-host) |
| The host's game list | one factory `createGameHost(<CONST>_HOSTED, { ...deps, options: GAME_HOST_CONFIG['<id>'] })` in game-session-host's fixed `<gamesDir>/game-registry.ts` |
| Bot simulations | `test/sims/<id>/<name>.sim.test.ts` |
| Pixel golden | a `*.golden.test.ts` whose name or folder is the id (`test/goldens/canvas/lights-out.golden.test.ts`) |
| E2E flow | a `.yaml` under `.maestro/` whose name or folder is the id (`.maestro/games/lights-out.yaml`) |
| Commit scope | `feat(lights-out): ...` |
| Simulators and emulators | created by name, `<project>-<purpose>` (never "the booted one") |

## Store identifiers (white-label apps)

Only when one game is one app (`white-label-apps.md`):

| Identifier | Rule | Who |
|---|---|---|
| iOS bundle id and Android package | `<apps.bundlePrefix>.<id without hyphens>`, lowercase: `com.acme.lightsout` | derived; the prefix is set once for every app |
| In-app products | `<bundle id>.<suffix>` for each `apps.products` suffix: `com.acme.lightsout.premium` | derived |
| App Store Connect and Play records | created with that id; both are permanent | a human |
| Privacy-policy host and path, support address | `links` in `app-settings.ts` | a human; placeholders until then |
| AdMob app and unit ids, iOS and Android | `ads` in `app-settings.ts` | a human; Google's sample ids until then |

The bundle id and the package can never change after the first upload: both stores key the app, its
reviews and its purchases on it. The checker fails `bundle-id` and `product-id` at every stage, and
the complete stage fails `ship-placeholder` on `com.example.*`, `example.com`, `@example.com` and
Google's sample AdMob ids, one line each; no option turns one into a pass.
