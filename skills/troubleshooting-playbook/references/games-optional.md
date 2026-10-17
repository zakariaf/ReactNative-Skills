# Games (optional plugin)

Failures specific to the optional games plugin: deterministic rules, levels, real-time loops, balance simulations and session hosts. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npm run test:sim`.

<!-- Generated from assets/known-failures/games.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Determinism
- Rules
- Levels
- Real-time
- Balance
- Session

## Determinism

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `games-cross-engine-determinism` | A replay or bot run recorded in Jest diverges on the device (or between iOS and Android) | Hermes computes Math.sin, cos, exp, atan2 and pow with the platform C library; V8 uses its own | Rules, simulations, geometry and daily generation use only + - * /, Math.sqrt, Math.imul, floor, round, abs, min, max and an integer PRNG (sfc32); lint bans the rest there | verified |  | `seeded-determinism-and-golden-vectors` |

## Rules

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `games-create-finished` | A level starts already won or lost | The game's create() returned a finished state | Fix create(); the engine contract test requires every level to start in play | verified |  | `game-rules-engine` |

## Levels

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `games-daily-salt-shared` | Two games' daily levels follow the same seed sequence | A game copied the template daily salt | Derive the salt from the game id (FNV-1a of the id); the level checker reports a shared salt | verified |  | `level-generation-and-solvers` |

## Real-time

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `games-tunnelling` | A fast ball passes through a wall, or a corner hit bounces wrong | Discrete steps skip thin obstacles at high speed | Use swept collision tests, a small fixed step, and properties such as "never leaves the arena" and "energy never increases" | documented |  | `realtime-game-loop` |
| `games-sim-kit-alloc` | A real-time simulation drops frames or triggers garbage collection | Vector helpers return new objects on every call; a UI-thread tick must allocate nothing | Write the maths with plain numbers inside the step functions | documented |  | `realtime-game-loop` |
| `games-spatial-hash-stride` | Collisions are missed or land in the wrong cell, with no error | The spatial hash expects two numbers per entity, but the body array holds four (x, y, vx, vy) | Pass positions with stride 2, never the raw body array | documented |  | `realtime-game-loop` |
| `games-board-freeze-after-resume` | After an interruption (a full-screen ad, a background trip) the canvas stays on one frame until the next input | A race between the resume and the next scene push: the UI frame for the old scene reported done and stopped the new scene before its first frame | Tag frame-done messages with their run and ignore stale ones; hold pushes while not runnable; record a frame on every resume. Prove it with a device flow that asserts the scene settles | verified |  | `game-session-host` |

## Balance

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `games-balance-report-stale` | The balance check fails [report-stale] although the rules did not change | The report fingerprint covers the game's logic, the simulation file and the shared files they import; one of them changed, or the local report predates the change | Rerun npm run test:sim and the balance check; never edit the report by hand | verified |  | `game-balance-and-bots` |

## Session

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `games-stranded-run` | A lost run with no continue available never shows its result | The run waited for the user to take or decline a continue offer that was hidden | End the run at once when the offer is unavailable ("never strand a finished run"), with a test for each unavailable reason (offline, no ad, no entitlement) | verified |  | `game-session-host` |
