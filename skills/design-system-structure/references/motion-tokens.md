# Motion tokens

What the motion tokens are, how they reach Reanimated, and the reduce-motion contract every moment
keeps. The catalogue of moments and their choreography belongs to motion-and-animation; the reduce
motion hook and the root config belong to accessibility-as-code. Verified on 2026-10-03 against
Reanimated 4.5.1 (read in its source in the reference app); re-verify with
`npm view react-native-reanimated@4.5 version` and the source paths below.

## Contents

- The tokens
- What the checker sees as a raw duration or spring
- Springs: write every parameter
- A moment table, with its reduce-motion column
- Reduce motion in code

## The tokens

`src/theme/motion.ts` copies the token file's `motion` group:

| Export | Holds | Example use |
|---|---|---|
| `EASING` | cubic-bezier control points | `Easing.bezier(...EASING.decelerate)` |
| `MOTION_MS` | durations in ms (`pressIn`, `fast`, `standard`, `slow`, `reducedFade`, `holdToConfirm`) | `withTiming(1, { duration: MOTION_MS.fast })` |
| `SPRINGS` | complete spring configs (`release`, `sheet`) | `withSpring(0, SPRINGS.release)` |
| `PRESS` (in `tokens.ts`) | the press surface's look: `kind`, dim opacity, shrink scale, sink squash | the press surface (theme-in-react-native.md) |

## What the checker sees as a raw duration or spring

A raw 300 in a component escapes the reduce-motion review and the token file, and an inline spring
config is how the mass-4 release reaches a screen. `check-raw-values` looks where animations are
written, outside `src/theme`, and only in the layers that draw (by default `src` minus `src/core`,
`src/data`, `src/api`, `src/stores`, `src/services`, `src/i18n`, `src/config`): a task's
`{ duration: 25 }` in the domain is data and never flagged. Both rules read a value the way a
component writes it:

- **inline:** `{ duration: 300 }`, `withDelay(300, ...)`, `.duration(300)`;
- **through a same-file const:** a number (`const FADE_MS = 250; { duration: FADE_MS }`, the shorthand
  `{ duration }`, `.duration(SLIDE)`, `withDelay(STAGGER, ...)`) or an object literal passed by name or
  spread (`const BOUNCE = { damping: 10, stiffness: 100 }; withSpring(1, BOUNCE)`, the shape of
  Reanimated's own docs), reported at the const's line with the call it reaches;
- **inside an expression:** every number that is not a member access (`isSlow() ? 600 : 200`,
  `index * 50`, `MOTION_MS.fast * 2`: a duration no token holds and no reduce-motion review saw).

A const never passed to an animation call stays silent. **Not seen** (the checker reads one file as
text, without types): a number imported from another module, held in a `let`, returned by a function,
or passed through a component prop (`<Fade durationMs={300} />`); review those by hand, and keep
durations in `MOTION_MS` so there is nothing to review.

| Rule | Flags | Not flagged |
|---|---|---|
| `no-raw-duration` | `duration` or `delay` values inside `withTiming`, `withDelay`, `withRepeat`, `withSequence`, `Animated.timing`, `LayoutAnimation.configureNext({ duration })` and `LayoutAnimation.create(300, ...)`: a number, a same-file number const (`{ duration: FADE_MS }`, `withDelay(STAGGER, ...)`), or an expression holding one (`isSlow() ? 600 : 200`, `withDelay(index * 50, ...)`); a same-file config const passed to them (`withTiming(1, FADE)`); `.duration(300)` / `.delay(80)` / `.duration(SLIDE)` on a layout-animation builder imported from Reanimated (`FadeIn`, `LinearTransition`, `Keyframe`); `transitionDuration` / `animationDelay` style keys (Reanimated 4 CSS) | `MOTION_MS.*`, `index * MOTION_MS.fast`, a `0` (instant), a `duration` key in a plain data object, `dayjs.duration(25, 'minutes')`, `LayoutAnimation.Presets.easeInEaseOut` |
| `no-raw-spring` | `damping`, `stiffness`, `mass`, `dampingRatio`, `duration` (and the Animated spring keys) as numbers, same-file number consts or expressions inside `withSpring` or `Animated.spring`, or in a same-file config const passed or spread into them; `.damping(12)`-style builder calls | `withSpring(0, SPRINGS.release)`, `{ ...SPRINGS.release, velocity }` |

## Springs: write every parameter

`withSpring` merges a partial config with its defaults. In Reanimated 4.5.1 those defaults are
duration-based (`duration` 550 ms, `dampingRatio` 1) with `damping` 120, `stiffness` 900 and
**`mass` 4** (`src/animation/spring/springConfigs.ts`, `GentleSpringConfig`); the previous major
defaulted mass to 1. A token that writes damping and stiffness but leaves
mass out inherits 4: the release becomes twice as slow and much bouncier than designed, and changes
again with the next major. So every spring token writes `damping`, `stiffness` and `mass` (or the
duration pair `duration` and `dampingRatio`); `spring-config-complete` checks every `*SPRING*`
export, and `no-raw-spring` keeps spring numbers out of components.

A spring overshoots differently from a CSS curve. When a motion must match a web mockup exactly, use
`withTiming(to, { duration, easing: Easing.bezier(...EASING.overshoot) })` instead.

## A moment table, with its reduce-motion column

Keep one table (in the design or in motion-and-animation's catalogue) where every moment that moves
has its reduce-motion alternative. The shape:

| Moment | Duration | Easing / spring | Reduce motion |
|---|---|---|---|
| Press in (`PRESS.kind`) | `pressIn` | `decelerate` | a dim stays; a shrink becomes a dim; a sink loses its squash; instant |
| Release | `SPRINGS.release` (`fast` fade for a dim) | spring | instant return |
| Fill change (select) | `fast` | `standard` | instant |
| Screen transition | `standard` | `standard`, in the reading direction | cross-fade `reducedFade` |
| Looping attention (a pulsing badge) | `slow` loop | `standard` | no loop, static state |
| Hold to confirm | `holdToConfirm` | linear | unchanged: a functional timer |

## Reduce motion in code

- Read the app's reduce-motion hook (the setting, or the phone's switch when the setting says
  system), never Reanimated's `useReducedMotion()`: in 4.5.1 it returns a constant captured when the
  module loads (`src/hook/useReducedMotion.ts`), so a switch flipped while the app runs is ignored.
- A root `ReducedMotionConfig` (mounted once by accessibility-as-code's `MotionConfig`) makes every
  `withTiming`/`withSpring` that keeps the default `reduceMotion` follow the setting: timings and
  springs finish instantly. Without it an in-app "reduce motion" switch only removes what a component
  removes by hand.
- Components remove what the config cannot: the press squash (`isReducedMotion`), loops (never
  started when reduced), slides replaced by a `reducedFade` cross-fade. That fade must itself pass
  `reduceMotion: ReduceMotion.Never`, or the root config finishes it instantly like the slide it
  replaces; motion-and-animation keeps that one opt-out in `REDUCED_FADE`, `reducedEntering()` and
  `reducedExiting()` (`src/ui/motion/moment-config.ts`), so use those rather than a bare
  `{ duration: MOTION_MS.reducedFade }`.
- A functional timer (hold to confirm, an undo window) passes `reduceMotion: ReduceMotion.Never`: it
  is a safety interval, not decoration, and must never shorten.
