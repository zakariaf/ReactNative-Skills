# Sound design: recipes, the quality gate, banks, cues and listening

Every sound is synthesised in code from a small typed recipe. There are no audio files by default, so
there are no licences to track, every render is byte-identical on device, in Jest and in the checker,
and every sound can be heard as a WAV before any build.

## Contents

- The recipe model
- The quality gate
- Sound design guide (starting points)
- Ids and banks
- From events to cues: cue tables and track cues
- Real-time games (games plugin)
- WAV previews and tuning by ear
- What only a human can check
- Worked example: the Tasks app

## The recipe model

A `SoundRecipe` is a list of voices (layers). Each `VoiceSpec` is:

| Field | Meaning |
|---|---|
| `wave` | `'sine'`, `'triangle'`, `'square'` (±0.6, softer than a full square) or `'noise'` (seeded white noise) |
| `startHz`, `endHz` | Pitch glide, linear over the voice (ignored for noise; write 0) |
| `offsetMs` | When the layer starts inside the sound |
| `durationMs` | Length of the layer |
| `attackMs` | Linear fade-in; 1-2 ms removes the click at the start |
| `gain` | Peak amplitude 0…1 before mixing |
| `seed` | Noise only: the sfc32 seed, so noise is identical on every render |

The envelope: linear attack, a quadratic decay over the whole voice, then a 6 ms fade so the last
sample is exactly zero (no click when the buffer stops). `synthesizeRecipe` mixes the layers at their
offsets; a mix that peaks above 0.9 is scaled down to 0.9, so layers can never clip.

The synth may use `Math.sin` (it is not simulation code) and takes randomness only from the app's
seeded PRNG (`src/core/rng/sfc32.ts`, seeded-determinism-and-golden-vectors), so device buffers, Jest
and the WAV previews are identical. The same pure function runs on device at the context's sample rate
(48 kHz on the iOS simulator), in Jest and, as a byte-exact port, in this skill's checker, whose
`synth-drift` rule renders a golden recipe with the app's own synth and compares the hash.

Write recipes as **literal data** inside the bank: numbers and strings inline, no shared constants,
spreads or helper calls. A diff shows exactly what changed, and `check-sound-banks.mjs` can read and
render the bank without a TypeScript compiler.

## The quality gate

`recipeProblems(recipe, maxDurationMs)` (`src/services/audio/synth/recipe-problems.ts`) returns an empty
list for a clean sound. `synthesize-recipe.test.ts` runs it over `UI_SOUNDS`; each bank's test runs it
over the bank; `check-sound-banks.mjs` runs a byte-exact JavaScript port of the same checks.

| Check | Limit | What it prevents |
|---|---|---|
| Finite samples | no NaN/Infinity | a broken recipe that silences the whole mix |
| Peak | 0.05 to 0.9 | inaudible sounds; clipping |
| First sample | below 0.05 | a click at the start (attack too short for a loud triangle or square) |
| Last sample | below 0.01 | a click at the end |
| Length | 10 ms to 1500 ms (music up to 30 s) | sounds too short to hear; long effects that pile up in bursts |
| Voice fields | `durationMs > 0`, `0 <= attackMs < durationMs`, `0 < gain <= 1`, `offsetMs >= 0`, tonal pitch 20-20000 Hz | nonsense data |
| Later layers | a voice with `offsetMs > 0` has `attackMs >= 1` | a click in the middle of the sound |

A green gate proves the sound is clean, not that it is right. Only listening proves that.

## Sound design guide (starting points)

Start from these shapes, then tune by ear:

| Moment | Recipe shape |
|---|---|
| a switch flips (`ui.toggle`) | two short sine blips a fifth apart (660 then 990 Hz, 60-70 ms, 45 ms apart) |
| an action succeeded (`ui.success`) | two rising triangle notes (E5 659.25 Hz, then A5 880 Hz, 80 ms apart) |
| an action failed (`ui.error`) | two short low square blips (220 Hz, 40 ms each, 60 ms apart), quiet (gain ≤ 0.25) |
| a press, when the app opts into tap sounds (`ui.tap`) | triangle 1400 → 900 Hz, 45 ms, attack 1 ms, gain 0.35 |
| the most repeated action (a task checked) | short triangle, 70-110 ms, rising or falling about 30 %, gain 0.3-0.4, the quietest sound |
| a payoff (a streak grows, items merge) | sine sweep up (300 → 1200 Hz) over 200-300 ms plus 150 ms of soft noise (gain ≤ 0.15, attack 4 ms) |
| a celebration (a goal reached) | three rising triangle notes C5-E5-G5 (523.25, 659.25, 783.99 Hz), 110 ms apart, the last longest |
| a hit or crash (games) | square, 100-150 ms, falling an octave (180 → 90 Hz); `minIntervalMs: 60` for rapid hits |
| a loss (games) | square falling a sixth (330 → 196 Hz) over about 400 ms |

Keep the palette small: three to six sounds per feature. Make the most repeated sound the most pleasant
and the quietest (the template bank's test asserts it); save loud, long sounds for rare moments.

## Ids and banks

- Sound ids are kebab-case nouns named after what happened: `'complete'`, `'goal'`, `'streak'`,
  `'delete'`. Never after an animation (`'play-flip-animation'`).
- `ui.` is the UI sounds' namespace; a bank id never starts with `ui.`, and ids are unique across banks
  (`composeSoundBank` throws, the checker fails `sound-id`).
- A bank is `src/features/<feature>/sounds/<feature>-sounds.ts` exporting `<FEATURE>_SOUNDS: SoundBank`
  (games: `src/games/<game-id>/sounds/<game-id>-sounds.ts`), with `<feature>-sounds.test.ts` beside it
  running `recipeProblems`, and the root layout passes it to `composeSoundBank`.
- Every id in a bank is cued inside its owner folder, and every cue names an id of its owner's bank.
  Music entries are exempt from "cued": they start with `startMusic`.
- Categories: bank sounds are `'sfx'`; the whole app has at most one `'music'` entry with `isLoop: true`.
  `'ui'` is the UI sounds'.
- `minIntervalMs` on a spec overrides the 30 ms repeat limit for that sound (at most 1000 ms).

## From events to cues: cue tables and track cues

Events say what happened (`'task-completed'`, naming-conventions); sounds and haptics map from events.
Each event that deserves feedback is played in exactly one place:

- **A feature's cue table** (`src/features/<feature>/<feature>-feedback.ts`): one row per event,
  `{ sound?, haptic? }`, played by the feature's model hook with `playCue(services, TASKS_FEEDBACK['task-completed'])`
  when the event happens. Views never play cues; they call the model.
- **A canvas track cue** (skia-canvas-rendering): a track may carry `cue: { sound?, haptic? }`, fired
  when the track starts; the cue scheduler plays `audio.play(cue.sound, track.startMs)` on the audio
  clock and haptics on timers, and cancels unfired cues on fast-forward, pause and leaving the screen.
  Put the cue on the track that shows the event, not on every particle track.
- **The UI moments** (`playUiFeedback`): app-wide moments, not feature events (feedback-moments.md).

An event shown by a canvas animation plays from its track cue only; doubling it from the cue table
would play it twice, and the voice policy and the throttle would drop one unpredictably.

## Real-time games (games plugin)

A real-time sim runs on the UI thread in fixed ticks and never touches a port (the checker's
`cue-in-sim` rule fails sound or haptic calls in `src/games/*/sim/` and in `'worklet'` modules). The sim
appends events; the loop drains them once per frame and sends one batch to JS, where the game's host
maps event kinds to `audio.play('caught')` and `haptics.play('heavy')` (realtime-game-loop owns the
loop). Give frequent sounds a `minIntervalMs` so a burst in one frame plays once, and never pulse per
tick. Write the ids as literals (`audio.play('caught')` or `{ sound: 'caught', haptic: 'heavy' }`
rows): the checker finds cues by these shapes, and an id hidden in a variable reads as an unused sound.

## WAV previews and tuning by ear

`node ${CLAUDE_SKILL_DIR}/scripts/check-sound-banks.mjs . --wav-dir reports/sfx` writes
`reports/sfx/ui/<id>.wav` and `reports/sfx/<feature>/<id>.wav` for every clean sound (48 kHz, 16-bit
mono, byte-identical to the app's synth; the checker verifies a pinned hash at startup and the app's
synth against it). `reports/` is git-ignored (the `preview-ignored` rule). Verified on 2026-10-03: two
runs give identical bytes; `afinfo` reports `1 ch, 48000 Hz, Int16`.

Tuning loop: change one number, re-render, listen next to the neighbouring sounds (macOS: select the
files in Finder and press space; Linux or Windows: any audio player), keep it or revert. An agent cannot
hear: a sound set is done when its previews are rendered and the listening is listed for a human.

## What only a human can check

The quality gate proves a sound is clean, the fakes prove it is requested, the recording decorators
prove a test build asked for it; only a person on a real phone proves it is right. These checks never
block a change: list them as a follow-up (examples/listening-checklist.md), carry on, and tune when the
answers come.

1. Listen to the WAV previews: does each sound fit its moment, and are they balanced against each other?
2. On an iPhone: do sounds land with their animations? With the silent switch on, is the app silent?
   Does the user's own music keep playing underneath?
3. On an Android phone: same timing check; with music playing in another app, does it keep playing
   (no ducking, no pause)? Does the media volume control the app's sounds?
4. Do the haptics feel right for each moment on both phones, and never like a buzz?

## Worked example: the Tasks app

The template bank (`templates/src/features/__FEATURE__/sounds/`, filled for the `tasks` feature) and
cue table (`__FEATURE__-feedback.ts`) give the Tasks app three sounds, one per event that deserves one:

| Event | Sound | Haptic | Played from |
|---|---|---|---|
| `task-completed` | `complete`: triangle 660 → 990 Hz, 110 ms, a soft 1320 Hz blip; the quietest | `light` | the tasks model's cue table, or the progress grid's first flip track |
| `goal-reached` | `goal`: C5-E5-G5 | `success` | the cue table, or the grid's goal track |
| `streak-extended` | `streak`: sine sweep 300 → 1200 Hz + soft seeded noise | `medium` | the cue table, or the grid's streak track |
| `task-deleted`, `list-renamed`, `task-edited` | none | none | (most events deserve no feedback) |
| a save succeeds / fails | `ui.success` / `ui.error` | `success` / `error` | `playUiFeedback` in the model |
| a settings switch flips | `ui.toggle` | `selection` | `playUiFeedback` in the settings model |

The ids `complete`, `goal` and `streak` are the ones skia-canvas-rendering's progress grid cues, so an
app that adopts both skills gets matching sounds. A game uses the same pieces: a bank in
`src/games/<game-id>/sounds/`, cues on its tracks, and drained events for a real-time loop.
