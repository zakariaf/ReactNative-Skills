# Feedback moments: UI feedback, tap sounds, settings and evidence

Where sounds and pulses are played from, and how the user's settings and the test build see them.

## Contents

- UI feedback: one table for the app-wide moments
- Tap sounds are opt-in (the press surface)
- Feature cue tables
- The user's settings and the rows that hide
- Evidence in test builds: the recording decorators
- What the checker proves
- Where the checkers are heuristic

## UI feedback: one table for the app-wide moments

`src/services/feedback/ui-feedback.ts` maps each app-wide moment to its UI sound and pulse, and
`playUiFeedback(services, kind)` plays both through the ports (so the settings, the voice policy and the
throttle apply):

| Kind | Sound | Pulse | Where it is called |
|---|---|---|---|
| `toggle` | `ui.toggle` | `selection` | the model handler of every switch and picker step; the canonical site is the settings model |
| `success` | `ui.success` | `success` | a model, when an action the user asked for succeeded (saved, sent, restored) |
| `error` | `ui.error` | `error` | a model, when such an action failed (the error message shows at the same time) |

The table is the app's: delete a moment it has no call site for, with its `ui.*` recipe in
`UI_SOUNDS` (an app without save flows keeps only `toggle`); the template tests iterate over the
table, so they follow. Add a moment the same way: a row, a recipe, a call site.

Rules that follow:

- Call `playUiFeedback` from model hooks and handlers, never from individual views and never with
  `audio.play('ui.x')` by hand (the checker's `ui-feedback` rule fails that outside the audio and
  feedback services): one forgotten handler is a silent switch, and a hand-played sound has no pulse.
- Every moment in the table is played somewhere: the checker's `ui-feedback` rule fails a moment no
  `playUiFeedback(..., '<kind>')` call names (a call `isSaved ? 'success' : 'error'` plays both).
- `ui-feedback.test.ts` proves every UI sound has exactly one moment, so `UI_SOUNDS` holds no orphan.
- A switch plays `toggle` in its handler with the state change, never the press feedback below. The
  press feedback is a no-op unless the app opted into tap sounds (no `PressFeedbackProvider`), so a
  switch wired to `usePressFeedback()` is silent in most apps, and with the opt-in it would play
  `tap` instead of `toggle`.

**The canonical toggle call site is the settings model's input.** settings-and-preferences'
`use-settings-model.ts` takes an `onToggled` callback in its input (built in
`use-settings-input.ts`) and hands it to `createPreferenceActions`, which runs it once after each
switch's dispatch (so turning sound or haptics off is already silent: the ports read the settings at
call time). That callback plays the moment:

```ts
// src/features/settings/use-settings-input.ts
const services = useServices();
const onToggled = (): void => {
  playUiFeedback(services, 'toggle');
};
```

Any other switch or picker (a filter, a list option) does the same in its own model.

## Tap sounds are opt-in (the press surface)

Buttons are silent by default. The platforms already answer a press: iOS with the press look, Android
with the ripple and, when the user turned on Touch sounds, the system click (React Native's `Pressable`
plays it unless `android_disableSound` is set; read in react-native 0.86.3 `Pressability.js`). An app
that gives every press its own sound (a game, a playful app) opts in:

1. Add the row `tap: { sound: 'ui.tap' }` to `UI_FEEDBACK` and the `ui.tap` recipe to `UI_SOUNDS`
   (sound-design.md has the starting shape).
2. Render the provider once at the root, inside `ServicesProvider`, with `playsSound`:

   ```tsx
   <PressFeedbackProvider
     playsSound
     onPress={() => {
       playUiFeedback(services, 'tap');
     }}
   >
   ```

   The context (`src/ui/press-feedback-context.tsx`, owned by design-system-structure; this skill ships
   a synced copy) imports only React, so `src/ui` stays presentational; outside the provider the hook
   is a no-op, so component tests need no audio fake.
3. Nothing else changes: design-system-structure's `PressableSurface` already runs `usePressFeedback()`
   before `onPress` for every control but a switch, and passes
   `android_disableSound={usePressFeedbackPlaysSound()}` to its `Pressable` (checked against the
   canonical `src/ui/pressable-surface.tsx` on 2026-10-10). `playsSound` is what turns that on: without
   it Android plays its system click and the tap sound together. The app edits no synced file. A
   provider that only pulses (no sound in `onPress`) leaves `playsSound` out, so the person's Touch
   sounds setting keeps its click.

The checker enforces the opt-in once the `tap` row exists: some file in `src/ui` runs
`usePressFeedback()`, the provider plays `'tap'`, every press surface names `android_disableSound`, and
the `PressFeedbackProvider` whose `onPress` plays `'tap'` carries `playsSound` (`android-touch-sound`).

## Feature cue tables

A feature's events map to cues in `src/features/<feature>/<feature>-feedback.ts`:

```ts
export const TASKS_FEEDBACK = {
  'task-completed': { sound: 'complete', haptic: 'light' },
  'goal-reached': { sound: 'goal', haptic: 'success' },
  'streak-extended': { sound: 'streak', haptic: 'medium' },
} as const satisfies Readonly<Record<string, FeedbackCue>>;

// in use-tasks-model.ts, where the event happens
playCue(services, TASKS_FEEDBACK['task-completed']);
```

Most events get no row. The table's test proves every row names a sound of the feature's bank; the
checker proves every bank sound is cued somewhere in the feature (`sound-unused`) and every cue names a
bank id (`cue-unknown`).

## The user's settings and the rows that hide

settings-and-preferences owns the settings store, its defaults and the rows; this skill owns what they
drive:

| Setting | Default | Drives | Row hidden when |
|---|---|---|---|
| Sound effects (on/off, volume) | the app's contract (the canonical settings schema ships off, 0.8) | `audio.applySettings` → the `sfx` and `ui` gains | never |
| Music (on/off, volume) | **off**, 0.6 | the `music` gain, `startMusic`/`stopMusic` | `hasMusic(bank)` is false (most apps) |
| Haptics (on/off) | on | `isEnabled()` read at each `haptics.play` | `haptics.isSupported` is false (iPad) |

Hidden rows are removed, never greyed out. The settings glue calls `applySettings` once at startup
(after the store restores) and whenever a sound setting changes, with volumes 0…1.

## Evidence in test builds: the recording decorators

`src/services/test-hooks/recording-feedback.ts` wraps the two ports: each sound and pulse passes
through unchanged and is also handed to `record({ kind: 'feedback', label, atMs, data })`. It sits in a
test-only folder, not beside the shipped `src/services/feedback/` files, because a folder the test-only
entry re-exports from must be listed in `contracts/architecture.json` `testOnlyFolders` and hold nothing
that ships. A test build reaches it only through the app's test-only gate (debug-menu-and-test-hooks):
`src/test-only-entry.ts` re-exports `recordAudioFeedback` and `recordHapticsFeedback` (never a gate of
its own), and the startup wraps the audio and haptics ports with `TEST_ONLY?.recordAudioFeedback` the
way the clock is wrapped. Release bundles contain none of it; a test build writes the entries where its
E2E run can read them (e2e-maestro). A flow can then assert that
completing a task asked for `complete` and `success`: proof the app requested the feedback. How it
sounds and feels stays the human check.

## What the checker proves

| Claim | Proven by |
|---|---|
| every UI moment is reachable | `ui-feedback` (a `playUiFeedback` call names it) |
| a tap sound has a press surface and no double click on Android | `ui-feedback`, `android-touch-sound` (the surface names `android_disableSound`; the provider that plays `'tap'` passes `playsSound`) |
| every feature sound is cued and every cue has a sound | `sound-unused`, `cue-unknown` (check-sound-banks) |
| buttons do not buzz | `button-haptics` |
| views never play feedback themselves | `view-feedback` (`audio.play`, `playCue`, `playUiFeedback` in `src/ui` or a feature's screen or components) |
| the sim never plays sounds | `cue-in-sim` |
| the sounds are clean | `recipe-quality` and each bank's test |
| the sounds are right | nobody but a human with a phone |

## Where the checkers are heuristic

Both checkers read source text, not types, so a few shapes pass unseen. The limits are deliberate:
growing the patterns would flag ordinary code of other features, so review covers these instead.

- **Cues.** check-sound-banks counts `sound: '<id>'` only inside a cue object: any row of a
  `*-feedback.ts` table, an object after `cue:` (a canvas track cue), a `playCue(...)` argument, or an
  object literal annotated with, or `satisfies`, a `FeedbackCue`/`TrackCue` type. It counts
  `audio.play('<id>')` (any receiver ending in `audio`, such as `services.audio` or `audio?`) and
  `startMusic('<id>')`. Notification content (`{ title, sound: 'default' }`), an Android channel's
  `sound: 'reminder.wav'`, `lottie.play('intro')` and a celebration hook's `play('task-completed')` are
  not cues. An id held in a variable (`audio.play(id)`) or a cue object built without one of those
  shapes is not seen: keep cue ids literal in the table, the track or the call.
- **Views.** `view-feedback` and `button-haptics` treat `src/ui`, `src/features/<feature>/components/`
  and `*-screen.tsx` as views. A hook that lives in `components/` and plays feedback is flagged; move it
  next to the model. A view that receives a callback which plays feedback is fine: the model owns it.
- **UI sounds by hand.** `ui-feedback` fails `audio.play('ui.…')` with a literal id outside the audio
  and feedback services; an id held in a variable is not seen.
- **Route files.** A file in `src/app` is not a view: the root layout legitimately plays the tap
  moment in its `PressFeedbackProvider`. A route screen that calls `playCue` or `playUiFeedback`
  itself passes `view-feedback`; keep route files thin and put the call in the screen's model.
- **Tap provider.** `android-touch-sound` reads the `<PressFeedbackProvider ...>` opening tag: it
  needs `playsSound` (or `playsSound={true}`) when the tag's `onPress` calls `playUiFeedback(..., 'tap')`
  inline. With `onPress={onAnyPress}` it cannot see what the function plays, so it only fails a surface
  driven by `usePressFeedbackPlaysSound()` when no provider passes `playsSound` at all; keep the call
  inline. A computed value (`playsSound={isSoundOn}`) is not proven true: pass the bare prop.
- **Vibration.** `vendor-import` sees the named import `import { Vibration } from 'react-native'`.
  `ReactNative.Vibration` through a namespace import or `require('react-native').Vibration`
  is not seen; review covers it (no app code needs either).
- **Reload seam.** `dispose-before-reload` accepts an awaited `beforeReload()`/`onBeforeReload()` before
  the reload, then looks for a non-test caller that calls the enclosing function by name and names
  `audio.dispose`. An exported function or component that only forwards the hook (rtl-and-direction's
  `DirectionRestart`, `DirectionGate`) passes the search on to its own callers. A caller that passes a
  disposer through another variable or file is not followed; pass `() => services.audio.dispose()`
  inline at the call.
