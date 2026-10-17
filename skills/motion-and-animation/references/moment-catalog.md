# The moment catalog

What a moment is, how an entry is written, which reduced alternative each kind may declare, how
to decide whether something should move at all, how to pick tokens and choreography, and how
check-motion reads the catalog. Verified on 2026-10-03 against Reanimated 4.5.1 and the canonical
`src/theme/motion.ts` (design-system-structure); re-verify with
`node -p "require('expo/bundledNativeModules.json')['react-native-reanimated']"`.

## Contents

- Why one catalog
- An entry, field by field
- Kinds and their reduced alternatives
- Timing shapes
- Should it move at all
- Tokens: roles, not numbers
- Choreography: origin, order, direction
- Cues: sound and haptics belong to the commit
- `files`: primitives that cannot import the catalog
- The celebration budget
- Reviewing the catalog (`--table`)
- Layout keys of rn-skills.config.json
- When multi-package

## Why one catalog

An app that never decides its motion still has motion: the library defaults, a slide someone
copied, a 300 ms fade a component invented. Nobody reviewed those for reduced motion, nobody knows
they exist, and they drift apart screen by screen. The catalog turns every moving thing into a
named, reviewable decision: one entry says what starts it, which motion tokens it spends and what
the person sees when motion is reduced. Code cannot move without naming an entry
(`moment-declared`), so the catalog stays a true list, and an entry nothing animates any more fails
as stale (`moment-unused`).

The catalog is a TypeScript module (`src/ui/motion/motion-moments.ts`), not a JSON contract,
because code reads it: `timingOf(MOTION_MOMENTS.taskCheck)` hands back the very duration and curve
the entry names, so the catalog and the running app cannot disagree. It stays plain data whose only
imports are type-only ones from `@/theme/motion`, so check-motion loads it with Node alone (type
stripping) and judges the values, not the text.

## An entry, field by field

| Field | Required | Holds | Checked by |
|---|---|---|---|
| `kind` | yes | `feedback`, `state`, `transition`, `attention`, `celebration`, `functional` | `moment-catalog` |
| `trigger` | yes | what starts it, in words a reviewer can find in the running app | `moment-catalog` |
| `timing` | yes | token names: `{ duration, easing, delay?, stagger? }`, `{ spring, delay? }` or `{ navigator: 'stack' }` | `moment-catalog`, `moment-tokens` |
| `reduced` | yes | what reduced motion shows: `instant`, `fade`, `static`, `none`, `unchanged` | `moment-reduced` |
| `pieces` | celebrations | how many pieces move (1 for a single sticker or title) | `celebration-budget` |
| `repeat` | feedback only | a finite repeat count (a shake) | `moment-catalog` |
| `cue` | no | the event the commit plays: a key of the feature's cue table (`'task-completed'`), not a sound id | `moment-catalog` (shape) |
| `files` | primitives | app-relative files that animate it without importing the catalog | `moment-files` |

Unknown keys fail (`moment-catalog`): a typo such as `reduce: 'fade'` would otherwise leave the
moment without a reduced alternative while the file looks complete.

## Kinds and their reduced alternatives

| Kind | What it is | Examples (Tasks) | May declare | Default choice |
|---|---|---|---|---|
| `feedback` | answers a touch | press, release, a rejected input's shake | `instant`, `fade`, `none` | press: `fade` (a shrink becomes a dim); shake: `none` (the message stays) |
| `state` | a value changed in place | a checkbox fills, a chip tints, progress grows | `instant`, `fade` | `instant` |
| `transition` | something enters, leaves, or the screen changes | a row appears, a sheet settles, a screen push | `fade`, `instant`, `none` | `fade` |
| `attention` | a loop that asks to be noticed | a syncing pulse, a waiting hint | `static`, `none` | `static` (the rest state, with a busy text) |
| `celebration` | a bounded flourish after a result | a list-cleared burst, stars popping in | `static`, `fade`, `none` | burst: `none`; stars: `static` (shown filled at once) |
| `functional` | a timer the person acts on | hold to delete, an undo window | `unchanged` | `unchanged` |

A feedback shake declares its finite `repeat` and ends at rest (a sequence whose last step is 0;
an odd reversing repeat count ends displaced, reanimated-4-in-practice.md), so its `none`
alternative is free: reduced motion jumps to that last step.

What each alternative means in code:

- `instant`: the animation jumps to its end state. The root `MotionConfig` (accessibility-as-code)
  does this by itself for every `withTiming`, `withSpring`, `withDecay` and layout animation that
  keeps the default `ReduceMotion.System`; nothing to write.
- `fade`: a short opacity change replaces the movement. It must opt out of the root config, or the
  config would make it instant too: `REDUCED_FADE` (for `withTiming`) and `reducedEntering()` /
  `reducedExiting()` (layout animations) in `moment-config.ts` are the only sanctioned opt-out
  besides functional timers.
- `static`: never starts; the rest or end state shows (a loop rests at 0, stars show filled).
- `none`: removed; the result is already on screen (a burst draws nothing, a shake is dropped).

check-motion holds the code to the declaration (`moment-reduced`): a moment declared `fade` whose
animating files never use `REDUCED_FADE`, `reducedEntering()` or `reducedExiting()` would collapse to
`instant` under the root config, so it fails (files listed in `files` and navigator moments are
exempt: they time themselves). A celebration drawn with `<CelebrationBurst>` declares `none`,
because the burst returns nothing while motion is reduced and `useCelebration` jumps to the end. A
`static` or `fade` celebration needs the app's own end-state view (stars drawn filled, a badge that
fades in with `REDUCED_FADE`), not `<CelebrationBurst>`.
- `unchanged`: plays as designed. Only `functional` moments, because a safety interval that finishes
  instantly is a bug, not an accommodation.

The end state is identical with motion on or off. A selection that only exists while its animation
runs, or a value readable only mid-transition, fails everyone who reduces motion (WCAG 2.3.3,
Animation from Interactions).

## Timing shapes

- **Timing** `{ duration, easing, delay?, stagger? }`: `duration`, `delay`, `stagger` name
  `MOTION_MS` keys; `easing` names an `EASING` key or `'linear'` (functional timers and loops that
  must not ease; Reanimated's own `withTiming` default is an ease-in-out quad, so `'linear'` is
  written out, never implied).
- **Spring** `{ spring, delay? }`: a `SPRINGS` key. Spring tokens write damping, stiffness and mass
  (Reanimated 4.5.1 defaults mass to 4; design-system-structure's `spring-config-complete`).
- **Navigator** `{ navigator: 'stack' }`: a native stack transition; the platform times it and
  `useScreenAnimation()` picks which one. Only for `transition` moments.

A token that does not exist fails `moment-tokens`; add it to the token file and
`src/theme/motion.ts` first (design-system-structure owns token values), then name it.

## Should it move at all

Decide before declaring. Motion has a cost every time it plays, and the most frequent interactions
pay it most.

| How often the person meets it | Decision |
|---|---|
| Many times a minute: typing, scrolling, tab switches, list taps | No moment, or an imperceptible press feedback (the shared press surface's) |
| Tens of times a session: toggles, row selection, checkboxes | A `state` or `feedback` moment on the shortest tokens (`pressIn`, `fast`) |
| Occasionally: sheets, toasts, a new row, a screen push | A `transition` moment on `standard` |
| Rarely: a list cleared, a streak, first success | A `celebration`, on a budget |

Name the purpose in one word before writing the entry: feedback, state, orientation (where did it
come from, where did it go), attention, or delight (rare results only). A moment without a purpose
is decoration that the next person on a slow phone pays for. Tab switches do not slide: tabs are
peers, and a slide implies a depth that is not there. Expo Router's `Tabs` offer only `'fade'` and
`'shift'` (a fade with a small offset, not a slide); either is fine for peers when it is gated on
reduce motion (`animation: isReducedMotion ? 'none' : 'shift'`, `screen-transition-reduced`). A
tab switch is a many-times-a-minute change, so by the table above it gets no moment: check-motion
deliberately counts a `Tabs` layout as non-animating for `moment-declared` and checks only the
gate. This is the one documented exemption from "every moving thing is declared".

## Tokens: roles, not numbers

Moments spend roles; the numbers live in the token file. Keep the ordering, whatever the brand
chooses for the values: `pressIn` < `fast` < `standard` ≤ `slow`, and nothing on the
input-response-retry loop longer than `standard`, because that loop is paid dozens of times per
session. The canonical demo values (`pressIn` 70, `fast` 120, `standard` 240, `slow` 360,
`reducedFade` 120, `holdToConfirm` 1500 ms) sit where most apps land; a calmer or snappier brand
moves the whole scale, never inverts it.

A finger that was involved gets a spring (it carries velocity through an interruption); everything
else gets a timing curve. Entering and leaving use a decelerating curve; movement on screen uses
the standard curve; constant progress uses `'linear'`.

## Choreography: origin, order, direction

- **Origin.** Motion starts where the cause is: a burst from the pressed checkbox, a sheet from the
  edge it lives on, a row from its own slot. Celebrations never fly in from the screen edges.
- **Order.** One thing leads; others follow by `stagger`. More than a few staggered items read as
  a wait: the budget below caps the total.
- **Direction.** Horizontal movement follows the reading direction: React Native never mirrors a
  `translateX`, so a slide from the start edge negates its offset in right-to-left languages
  (rtl-and-direction owns the direction value). Vertical motion and direction-neutral content (a
  chart, a canvas, media) do not flip. Native stack pushes are the platform's own: look at them in a
  right-to-left locale on both platforms (not verified by this skill).

## Cues: sound and haptics belong to the commit

A moment may name the `cue` its commit plays: the event key of the feature's cue table
(audio-and-haptics-feedback's `<FEATURE>_FEEDBACK`, for example `'task-completed'`), never a bank
sound id such as `'complete'`, so one name finds the row that holds both the sound and the haptic.
The type stays `string`, because the catalog compiles in an app without that skill. The cue fires in
the handler that commits the state, on the same frame the visual starts, once per event: never from
an animation callback (it drifts by frames and fires twice on a replay), never per frame, never as
the only feedback (haptics are off for many people and absent on many Android phones). The cue
table, its throttling and the silent switch belong to audio-and-haptics-feedback; the catalog only
links the two.

## `files`: primitives that cannot import the catalog

Shared primitives owned by other skills animate without reading the catalog:
design-system-structure's `src/ui/pressable-surface.tsx` (press and release), and the navigator
files that render a native `<Stack>`. A moment lists them in `files` (app-relative paths).
ui-component-library's animated parts are listed the same way as the press surface: an app that
copies one lists the file that animates in the `files` of the moment the part plays (its
building-a-component.md has the table): `src/ui/toggle.tsx` under a `state` moment,
`src/ui/toast.tsx` under a `transition` moment, and for the hold button only
`src/ui/use-hold-to-confirm.ts` under a `functional` moment (`hold-button.tsx` only reads the
progress, so listing it fails `moment-files` with "animates nothing"). Its busy indicator and
confetti are not listed: with this catalog present it swaps in a busy indicator that plays an
`attention` moment through `useMotionLoop`, and drops confetti for `<CelebrationBurst>`.
check-motion then requires each entry to exist, to animate, and to spend the token the moment names
(`MOTION_MS.<duration>`, `SPRINGS.<spring>`, or a native stack for a navigator moment), so a
primitive whose timing drifted from its entry fails (`moment-files`). A `<Stack>` file listed
nowhere fails `moment-declared` with the fix "list this file in the navigator moment's files"; it
cannot take `timingOf(...)`. The template's `screenPush` entry holds the placeholder
`__ROOT_STACK_FILE__`: replace it with the file that renders the root `<Stack>`
(`src/app/_layout.tsx` in the create-expo-app layout; the `AppStack` file of
`examples/app-stack.tsx` when the root layout's JSX depth pushes it into a component) and add every
other file that renders a `<Stack>`.

## The celebration budget

`CELEBRATION_LIMITS` in the catalog caps every celebration: the template ships
`{ maxMs: 1600, maxPieces: 24 }`. The app may make it stricter, never looser than the library
ceilings of 2000 ms and 40 pieces (`celebration-budget`), because a celebration is a flourish on the
way to the next interactive state, not a wait. The total is computed from the tokens:

```
totalMs = delay + duration + stagger × (pieces − 1)
listCleared: fast 120 + slow 360 + pressIn 70 × 11 = 1250 ms, 12 pieces
```

A celebration therefore uses a timing (a spring has no fixed end). It plays through
`useCelebration` (`celebration-through-hook`): once per event key, `skip()` at any time, the end
state at once under reduced motion, and no "is playing" flag for anything to wait on. Failure gets
acknowledgement at the same level without a shaming animation.

One moment gets one celebration. `<CelebrationBurst>` (this skill) is the burst from the point of
action, sized by the moment's `pieces`; ui-component-library's `Confetti` (`src/ui/confetti.tsx`) is
a full-width band for a screen-level moment. An app with this catalog plays its celebrations through
`<CelebrationBurst>` and `useCelebration`, and ui-component-library drops `Confetti` in that case, so
the two never stack on one event.

`play(eventKey)` belongs in the handler that committed the result, right after the commit. A
`useEffect`, `useLayoutEffect` or `useFocusEffect` that calls it fails `celebration-through-hook`:

```tsx
// Fails: the once-per-key memory lives in the component and resets when it remounts.
useEffect(() => {
  celebration.play(listId);
}, [celebration, listId]);
```

The checker finds the names bound to `useCelebration(...)` (`celebration.play(`, or a destructured
`play(` and its alias) inside an effect body. A `play` inside a store subscription that an effect
sets up is flagged too: move it to the action or handler that commits.

## Reviewing the catalog (`--table`)

`node ${CLAUDE_SKILL_DIR}/scripts/check-motion.mjs . --table` prints the catalog as a Markdown table
with every token resolved to milliseconds and each celebration's total:

```
| Moment | Kind | Trigger | Timing | Reduced | Lives in |
| taskCheck | state | A task is marked done or open again | fast 120 ms, standard | instant | MOTION_MOMENTS.taskCheck |
| listCleared | celebration | The last open task of a list is marked done | slow 360 ms, decelerate, delay fast 120 ms, stagger pressIn 70 ms (total 1250 ms, 12 pieces) | none | MOTION_MOMENTS.listCleared |
```

Paste it into the change report: the reviewer reads every moment, its reduced alternative and its
budget without opening a file.

## Layout keys of rn-skills.config.json

| Key | Default | Use |
|---|---|---|
| `srcDir`, `routesDir`, `uiDir`, `themeDir` (layout keys) | `src`, `src/app`, `src/ui`, `src/theme` | where the app's folders are |
| `motionCatalog` | `<uiDir>/motion/motion-moments.ts` | another catalog path (app-relative) |
| `motionRootLayout` | `<routesDir>/_layout.tsx` | the file that mounts the providers (`App.tsx` with React Navigation) |
| `motionExclude` | none | globs left out of the code scan (vendored code, a legacy folder being migrated) |

The command-line options `--catalog`, `--root-layout` and `--exclude` override them for one run.

## When multi-package

With npm `workspaces`, check-motion checks every **app** workspace that depends on
`react-native-reanimated`, each with its own layout and catalog; `files` entries are relative to
that app's folder. A workspace is an app when it holds an app config (`app.config.ts`, `.js`,
`.mjs`, `.cjs` or `app.json`) or a routes folder, or lists `expo-router` or `expo` under
`dependencies`. A shared UI package that lists reanimated (usually a `devDependency` beside the
peer) is a **library**: the per-file rules run on its source, and each of its animating files must
appear in a moment's `files` in some app's catalog (`../../packages/ui/src/press-dot.tsx` from
`apps/mobile`), or it fails `moment-declared`. When no workspace qualifies as an app, every
reanimated workspace is checked as one. The self-test runs the full Tasks app as `apps/mobile` of a
workspace repo (`bad-workspace-app`), with a shared `packages/ui` listed (`pass-workspace-library`)
and unlisted (`bad-workspace-library-unlisted`).
