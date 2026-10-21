---
name: lottie-and-rive
description: Adds Lottie and Rive animation moments - bundled files, size and frame-rate budgets, Reduce Motion still frame, screen-reader hiding, bounded loops, licences. Use when adding a .json or .riv file. Not for Reanimated motion (motion-and-animation).
---

# Lottie and Rive

Makes every designer-made animation in an Expo app a bundled, recorded and bounded moment: Lottie for
one-shot or briefly looping illustrations, Rive for interactive state machines, Reanimated for
everything else. Each file has a byte and frame-rate budget, a still frame for Reduce Motion and test
builds, a licence and a source; decorative art is silent for VoiceOver and TalkBack; one heavy moment
plays at a time. One checker proves the files, the contract and the code agree.

## Rules that must hold

1. **Two runtimes, each for its job, and Reanimated for UI motion.** `lottie-react-native` (Expo SDK 57
   resolves `~7.3.8`) plays designer-exported one-shots and short loops; `@rive-app/react-native`
   0.5.5 with `react-native-nitro-modules` 0.36.5 plays interactive state machines; presses, sheets,
   rows and screen pushes stay Reanimated (motion-and-animation). Why: one engine per job keeps the
   native code and the bundle small, and a DOM player or the legacy `rive-react-native` is a second
   engine nobody maintains (`unapproved-runtime`).
2. **Animation files are bundled assets, never URLs.** `require('@/assets/animations/<file>')`, never
   `{ uri }`, `fromURL()` or a URL in a record; a `.riv` is exported with its fonts and images
   embedded. Why: a remote file fails offline, loads late and can change under a reviewed release
   (`remote-animation-source`).
3. **Every file has a record in `contracts/animations.json`.** Runtime, job, byte budget, fps, plays
   or settles, heavy, decorative, reduced-motion alternative, licence and source, added in the same
   change as the file. Why: an unrecorded file has no budget, no still frame and no known right to
   ship (`unbudgeted-file`).
4. **Each file stays inside its byte and frame-rate budget.** Its size at most its `maxBytes`, itself
   at most `budgets.maxBytes`; a Lottie file's own `fr` equals its record's `fps`, at most
   `budgets.maxFps` (60); a Rive moment's `frameRate` is its record's `fps`. Why: a large file is
   parse time and memory on every launch that reaches it, and a 120 fps illustration doubles the
   frames drawn for nothing a person sees (`unbudgeted-file`).
5. **Reduce Motion shows a static frame.** Only `LottieMoment` and `RiveMoment` play a file; their
   `AnimationMoment` frame reads `useReduceMotion()` and holds the record's still frame (Lottie at
   `progress`, Rive paused on its first frame, or `hidden` for decorative art); the `still` prop
   repeats the record. Why: neither runtime reads the system setting or Reanimated's config, so
   without the wrapper the moment ignores the person's choice (`no-reduce-motion-fallback`).
6. **Test builds hold motion still through the same path.** The debug kit's `motion=still` reaches
   `useReduceMotion()` as preference `'on'`; there is no second "animations off" flag. Why: a
   separate test flag lets screenshots pass while Reduce Motion is broken.
7. **Decorative animations are hidden from VoiceOver and TalkBack; informative ones are one labelled
   image.** `decorative` hides the frame (`accessibilityElementsHidden`, `no-hide-descendants`);
   otherwise `accessibilityRole="image"` with a `t()` label. Why: a screen reader that stops on
   confetti says nothing useful, and art that carries meaning must say it.
8. **Loops are bounded.** A Lottie run plays `plays` times (1 for a one-shot, at most
   `budgets.maxPlays`), never the endless `loop` prop, and lasts at most `budgets.maxSeconds`; a Rive
   state machine is confirmed to settle (`settles: true`); every moment holds still off screen and in
   the background. Why: an endless loop drains the battery and turns a flourish into noise
   (`unbudgeted-file`).
9. **At most one heavy animation plays on screen at a time.** Heavy art (full screen, large, or at
   least `budgets.heavyFromBytes`) is recorded `heavy` and passed `weight="heavy"`; the app mounts
   `AnimationStageProvider` once, which lets the first heavy moment play and holds the others still.
   Why: two heavy players at once drop frames on mid-range Android phones (`unbudgeted-file` when
   record and code disagree).
10. **Each file has a licence and a source on record.** The licence it ships under and where it came
    from (a page, a vendor, "made by the team"); when unknown, ask the developer. Why: store reviews,
    takedown requests and rebrands ask where art came from, and nobody remembers a year later
    (`missing-licence-record`).

Owned elsewhere and only cited here: `useReduceMotion`, `MotionConfig` and gesture alternatives
(accessibility-as-code); Reanimated moments and the celebration budget (motion-and-animation);
frame-time budgets on devices (performance-budgets); the `@/assets/*` alias (architecture-and-boundaries);
the Metro slot (app-variants-and-environment); exact pins and release age (dependency-management).

## Workflow

1. **Decide whether it is a file at all.** Read [references/runtimes-and-setup.md](references/runtimes-and-setup.md)
   ("Choosing"): if Reanimated and the app's tokens can do it, hand off to motion-and-animation and stop.
2. **Install the runtime it needs** (same reference): `npx expo install lottie-react-native`, and for
   Rive `npm install --save-exact @rive-app/react-native@0.5.5 react-native-nitro-modules@0.36.5`;
   then a new development build. For `.riv` or `.lottie` files copy
   `templates/scripts/metro/animation-assets-kit.ts` (and its test) to `scripts/metro/` and add
   `ANIMATION_ASSETS_KIT` to `METRO_KITS` in `scripts/metro/metro-kits.ts`. When the app runs
   architecture-and-boundaries' checker, classify each runtime in `contracts/architecture.json`
   `portlessSdks` ("a UI building block; only src/ui/animation/ imports it"), or it fails as
   `unclassified-sdk`.
3. **Copy the templates once.** `templates/src/ui/animation/` to `src/ui/animation/` (the playback
   rule, the stage, `AnimationMoment`, and the Lottie and Rive players with their moments and tests;
   leave out the runtime the app does not use), `templates/__mocks__/` to `__mocks__/` (the same
   choice), `templates/contracts/animations.json` and its schema to `contracts/`. The frame imports
   accessibility-as-code's `src/ui/a11y/use-reduce-motion.ts` and react-components-and-hooks'
   `src/hooks/use-is-app-active.ts`; copy those skills' files first when the app lacks them. Mount
   `<AnimationStageProvider>` once with the root stack's providers.
4. **Add the file and its record.** Put it in `assets/animations/`; read
   [references/files-budgets-and-licences.md](references/files-budgets-and-licences.md) for every
   field, the budgets, export settings and the licence; imitate
   [examples/animations-contract.json](examples/animations-contract.json).
5. **Show it from the feature.** Render `<LottieMoment>` or `<RiveMoment>` with a literal
   `require()`, the record's `plays` or `frameRate`, `still` and `weight`, `isActive` from the
   screen's focus, and the label from `t()` when informative. Imitate
   [examples/list-completed-celebration.tsx](examples/list-completed-celebration.tsx) (a heavy
   decorative Lottie one-shot started by the commit) and
   [examples/empty-tasks-mascot.tsx](examples/empty-tasks-mascot.tsx) (an informative Rive mascot).
6. **Test it.** Read [references/accessibility-and-testing.md](references/accessibility-and-testing.md):
   the root mocks, still under `preference="on"`, a bounded run ending, decorative art hidden,
   informative art found by role and name.
7. **Run the checks** from the repo root and loop until each passes: `npm run typecheck`,
   `npx eslint . --max-warnings 0`, `npx jest --ci`, then
   `node ${CLAUDE_SKILL_DIR}/scripts/check-animations.mjs .`. Each `FAIL` line names the file, the
   rule and the fix: fix the file, the record or the code, never loosen a budget past its ceiling or
   write a placeholder licence to pass.
8. **Ask for the device pass (human step).** Release builds on a named iOS simulator and a named
   Android emulator, then one real phone each: motion on, Reduce Motion on, VoiceOver and TalkBack,
   leaving the screen mid-play (accessibility-and-testing reference, "The device pass"). Report the
   check results and what the device pass found.

## Definition of done

- [ ] Every Lottie and Rive file the change touches is in `assets/animations/` (or another bundled
      folder) with a complete record in `contracts/animations.json`, licence and source included.
- [ ] Features render files only through `<LottieMoment>` / `<RiveMoment>` with a literal `require()`
      whose `plays` or `frameRate`, `still` and `weight` match the record; only `src/ui/animation/`
      imports a runtime; `<AnimationStageProvider>` is mounted once.
- [ ] Tests prove the still frame under reduced motion, a bounded run ending, and the screen-reader
      behaviour; `npm run typecheck`, `npx eslint . --max-warnings 0` and `npx jest --ci` pass.
- [ ] Every version fact used is dated in the runtimes reference; any newer one was re-verified with
      its command.
- [ ] The developer has been asked for the device pass (Release builds, both platforms, Reduce Motion
      and screen readers).
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-animations.mjs .` prints `RESULT: PASS` (it prints no
      SKIP lines; `NOT APPLICABLE` only when no runtime, file or runtime import exists)

## Anti-patterns

- **`<LottieView source={require(...)} autoPlay loop />` in a screen.** It ignores Reduce Motion,
  loops forever and plays off screen; render `<LottieMoment plays={1} still={1}>`.
- **`useRiveFile('https://cdn.example.com/mascot.riv')` or `source={{ uri }}`.** It fails offline
  and changes without review; bundle the file and record it.
- **A Lottie file for a button press or a list row.** Reanimated does it with the app's tokens and
  no file; hand off to motion-and-animation.
- **A Rive file for a one-shot illustration, or Lottie for an interactive toggle.** Each runtime has
  its job; the checker reports the other one as `unapproved-runtime`.
- **`"licence": "unknown"` or `"source": "TODO"` to get a green check.** Ask the developer; ship
  only art whose rights are known.
- **Raising `budgets.maxBytes` because one file is big.** Re-export it smaller (shape layers, no
  embedded images, 30 fps, a `.lottie` archive) first; raise a record's own budget only within the
  app's ceiling and with the reviewer.
- **An `isTestMode` prop that turns animations off for screenshots.** Use the debug kit's
  `motion=still`, which goes through `useReduceMotion()` and so proves the reduced path too.
- **Starting a celebration from `useEffect` or a focus effect.** It replays on every remount; set the
  state that shows it in the handler that committed the result.
- **Two full-screen celebrations at once, or a heavy file passed `weight="light"`.** Record it heavy,
  pass `weight="heavy"`, and let the stage queue it.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/runtimes-and-setup.md](references/runtimes-and-setup.md) | Choosing Reanimated, Lottie or Rive; dated version facts with re-verify commands; installs, Expo and New Architecture notes, Metro asset extensions; the play, pause and still APIs; what is not verified | Workflow steps 1 and 2 |
| [references/files-budgets-and-licences.md](references/files-budgets-and-licences.md) | The contract field by field, budgets and ceilings, frame rate, bounded loops, heavy moments, export settings, licences, code that must agree, config keys, multi-package | Workflow step 4, and on `unbudgeted-file` or `missing-licence-record` |
| [references/accessibility-and-testing.md](references/accessibility-and-testing.md) | Reduce Motion and the still frame, test mode, screen readers, where a moment starts, the Jest mocks, what to assert, the device pass | Workflow steps 5, 6 and 8 |
| `templates/src/ui/animation/` | `animation-playback.ts` (play or still, bounded plays), `animation-stage.tsx` (one heavy at a time), `animation-moment.tsx` (reduce motion, app state, screen readers), `lottie-player.tsx` + `lottie-moment.tsx`, `rive-player.tsx` + `rive-moment.tsx`, each with its test | Workflow step 3 (copy to `src/ui/animation/`) |
| `templates/__mocks__/` | Root Jest mocks: `lottie-react-native.tsx` and `@rive-app/react-native.tsx` | Workflow step 3 (copy to `__mocks__/`) |
| `templates/contracts/animations.json` | The contract template: assets folder, wrapper files, budgets, an empty record list | Workflow step 3 |
| `templates/contracts/animations.schema.json` | JSON Schema of the contract | Workflow step 4, when writing a record |
| `templates/scripts/metro/` | `animation-assets-kit.ts` (adds `riv` and `lottie` to Metro's asset extensions through the Metro slot) and its test | Workflow step 2, for `.riv` or `.lottie` files |
| [examples/list-completed-celebration.tsx](examples/list-completed-celebration.tsx) | A heavy decorative Lottie one-shot started by the commit, held still off screen | Workflow step 5 |
| [examples/empty-tasks-mascot.tsx](examples/empty-tasks-mascot.tsx) | An informative Rive state machine with its label and frame rate | Workflow step 5 |
| [examples/animations-contract.json](examples/animations-contract.json) | A complete contract with one Lottie and one Rive record | Workflow step 4 |
| `scripts/check-animations.mjs` | The checker: remote sources, unrecorded or over-budget files, reduced-motion fallbacks, licence records, approved runtimes (`--help` lists the five rules; `--contract`, `--src-dir`, `--json`) | Workflow step 7 and the definition of done |
| `scripts/lib/` | `animations-contract.mjs` (loads and judges the contract), `animation-code.mjs` (the per-file code rules); synced `source-scan.mjs` (never edit here) | When changing a rule |
| `scripts/selftest.mjs` | Proves the checker on the templates under a small Tasks app, and every planted bug | After changing the checker, a template or a fixture |
| `scripts/check-lib.mjs` | Shared script helper (synced; never edit here) | Never by hand |
| `assets/runtimes.json` | The approved runtimes with their jobs and extensions, the unapproved packages, the budget defaults and ceilings (dated) | When a runtime or a ceiling changes |
| `assets/shared.json` | Declares the synced files (check-lib, source-scan) | When adding a shared file |
| `tests/` | `bases/app/` (a Tasks app with a Lottie celebration, a Rive mascot and silent planted findings under `.agents/skills/` and `skills/`) and `fixtures/check-animations/` (the overlay suite, its `CASES.json` and `good/`) | When adding a rule |

## Related skills

- `motion-and-animation` - Reanimated moments, the celebration budget, and the reduce-motion root this skill's frame reads through.
- `accessibility-as-code` - `useReduceMotion`, `MotionConfig`, screen-reader labels and gesture alternatives.
- `performance-budgets` - frame-time and memory budgets measured on Release builds.
- `debug-menu-and-test-hooks` - the `motion=still` switch that holds every moment still in test builds.
- `dependency-management` - exact pins, Expo's module map and the release-age rule for the runtimes.
- `architecture-and-boundaries` - the `@/assets/*` alias and where asset files live.
- `app-variants-and-environment` - the Metro slot the asset kit plugs into.
- `unit-and-component-tests` - the Jest projects and root mocks policy.
- `i18n-strings-and-catalogs` - the translated label of an informative moment.
