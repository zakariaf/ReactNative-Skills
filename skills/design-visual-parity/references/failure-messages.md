# Failure messages: what they mean and what to fix

Every `FAIL` line has the form `FAIL <file> [<rule>] <message> Fix: <fix>`. This page goes one step
further: the usual real cause. Fix problems in the order they are printed per run (the scripts sort
them that way), rebuild, capture, check again.

## Contents

- check-parity.mjs (the gates)
- Where the design's numbers are
- capture-app.mjs and run-parity.mjs
- setup-parity-device.mjs
- make-sheet.mjs and check-signoff.mjs
- check-harness.mjs
- check-mockup.mjs and shoot-design.mjs
- Exit 2: bad input or environment
- When the same failure survives three fixes

## check-parity.mjs (the gates)

| Rule | Means | Usual real cause | Fix |
|---|---|---|---|
| `capture-size` | the capture is not the device profile's screen | captured on another simulator model, an emulator at another density | setup-parity-device.mjs, then capture with capture-app.mjs |
| `screen-not-reached` | the frame's root testID is not on screen (nor the modal layer that proves it) | the launch was refused (the `parity.error` screen's label names the parameter); a system alert in front; the root testID on an inner view; the frame state's opener missing | read the labels the message lists; fix the plan, the opener or the root testID; never a deep link on iOS |
| `scroll-mismatch` | a tall frame's capture is not scrolled where `scrollY` asked | the screen ignores `useFrameScrollTarget()`; the body scrolled only from `onContentSizeChange` (the first layout came before the safe-area insets and iOS clamped the offset); an animated scroll | pass `useFrameScrollTarget()` to ScreenBody's `scrollToY` (it scrolls from both events, without animation) |
| `reference-variant` | the run was captured against another reference than the app's facts select | the facts changed after the capture; a hand-made run | capture again; fix `facts.app` when it is wrong for the app |
| `reference-missing` | no reference for this frame, device, theme or language | a new language, device or frame; references never rendered | render them, only for an approved design (`shoot-design.mjs --update-reference --change <id>`) |
| `reference-mismatch` | run.json names another frame, device, theme or language than the reference, or one the contract does not know | a hand-edited run.json | capture again |
| `bounds-missing` | the run has no element bounds | the hierarchy dump failed or was skipped | capture again (Maestro and Java 17 installed) |
| `duplicate-testid` | two app elements carry one testID | a copied component kept its testID; a list keyed by something not unique | `<scope>.<element>.<data key>`, never an index |
| `missing` | a reachable design element's testID is not in the app (crop-only parts are never missing; under 8 pt on screen counts as off-screen) | not rendered; the testID on the inner Text of a Pressable; a reachable element inside a part hidden from screen readers; another state (an entitlement, empty data) | render it; move the testID to the accessible element; keep hidden decoration out of reachable containers; check the plan's data and the facts |
| `bounds` | an element is more than 2 pt off in x, y, width or height | padding, gap, min-height, border width, margins, safe-area inset, a font making text taller; a gap that exists only in the mockup CSS; a position set by a transform | read the element's style in the reference `.layout.json` and its CSS in the mockup; move by layout, never by a transform; fix the first failing element from the top |
| `text` | the label differs from the design text | the wrong copy key, the wrong fixture value, other punctuation or spaces, an accessibility label that is not the visible text | use the screen contract's key and the fixture's values |
| `fill` | the element's main colour is off by more than 3/255 | a hard-coded colour, the wrong token, the wrong theme, an opacity | use the theme token that paints the design's hex (the message names it) |
| `border` | a side the element draws is thicker, thinner or another colour | the token width 2.5 where the browser-rendered reference draws 2 (`component-border`); the border on a wrapper; a missing side | use the design border on every side it draws |
| `text-ink` | a text's ink is wider, narrower, taller, moved past its role's limit, or missing in the text colour | family or weight (a synthesised bold), size, letter spacing, wrapping, alignment, padding, line height; the wrong colour token | compare the run's `font` in the `.layout.json` with the type role the app uses; never nudge glyphs with a translate or padding; a mark the platform shapes narrower is a `platform-text-shaping` waiver |
| `structure` | a shape difference at least 1.5 pt thick inside an element ("inside its crop-only part X" when it sits on a part) | a missing or wrong icon, radius, shadow offset, ring, missing child, wrong picture; a tilted first block clipped by its scroll view | open `crops/<testID>.png`; match the icon, radius, shadow or spacing; give a tilted first block overhang room (ScreenBody `hasTopOverhang`); when the fix text names a known platform cause and the crop shows only that, a platform waiver |
| `waiver-invalid` | the waiver file is malformed or tries to change a number | an extra field, a wildcard testID, a short reason, no `reportedOn`, an unknown class, a shaping waiver on another rule or without `glyphs`, a design artefact without `designCause` or on `missing`, a `platform` or `platform-text-shaping` waiver without `devices` | fix the entry (signoff-and-waivers.md) |

## Where the design's numbers are

- The reference `<frame>.layout.json` holds each element's box, text runs and computed style. Read it
  first for any `bounds`, `fill`, `border` or `text-ink` failure.
- **Internal gaps and padding are not in it.** A gap between an icon and its label, or a pad inside a
  chip, exists only in the mockup's CSS: open the mockup, find the element by its `data-testid` and read
  its rules. A number found this way belongs in the component or its specs (ui-component-library), as a
  named constant.
- If the CSS itself draws something the product does not mean (an element frozen mid-press, a flex gap
  splitting one string), that is a `design-artefact` waiver plus a question to the reviewer, never a copy
  of the artefact in the app.

## capture-app.mjs and run-parity.mjs

| Rule | Means | Usual real cause | Fix |
|---|---|---|---|
| exit 2 "hierarchy from another device" | three dumps in a row lack this launch's `parity.launch.<nonce>` (the last kept as `rejected.hier.json`) | another session's driver answered (a shared device or port); the parity root or a modal root draws no `ParityLaunchMarker` | give the session its own device and let the scripts pick a free port; check-harness.mjs names a missing marker (`harness-launch-marker`) |
| `system-alert` | a system prompt is on screen (the message quotes it) | a permission or tracking prompt at launch; a deep link on iOS; an Android "isn't responding" dialog | find what asked; a parity launch asks nothing |
| `unstable` | no two screenshots 300 ms apart matched within the settle time | a loop or entrance that ignores the reduce-motion path; a timer; a loading state; a blinking caret | route it through `useReduceMotion()` (never a parity-only branch); stop timers; raise `--settle-ms` only for a slow first launch |
| `region-probe` | the probe launch showed no usable `parity.probe.<region>` | the component that draws the region does not render its probe while the probe switch is on | render the probe element with the region's rectangle as its label (parity-harness.md, "Probe launches") |
| `changed-during-capture` | the screen changed during three hierarchy dumps in a row | a timer, a polling spinner, a toast that times out | stop it in a parity launch |
| `screen-not-reached`, `capture-size` | as above, found before the comparison | as above | as above |
| `not-captured` (run-parity `--recheck`) | no run folder to check again | the run was never captured | run without `--recheck` |
| exit 2 "the <name> simulator is not booted" / "no running emulator of the AVD" | this session's device is off | a reboot; never set up | setup-parity-device.mjs with `--name` |
| exit 2 "the app did not launch" | the launch failed | the build is not installed; the wrong `--app-id` or `--scheme` | install the build (ios-simulator-build, android-emulator-build); check the contract's `launch` |
| exit 2 "Maestro is not installed" / "did not print JSON" | no hierarchy | Maestro or Java 17 missing; the driver stuck | install per e2e-maestro; rerun once (the first call reinstalls the driver) |
| exit 2 "capture-app.mjs stopped on ..." (run-parity) | a capture stopped with exit 2 | the reason is relayed with its fix | fix the environment, run again |

## setup-parity-device.mjs

| Rule | Means | Fix |
|---|---|---|
| `sim-missing`, `emu-missing` | no simulator or AVD with this name (check mode) | run without `--check` |
| `sim-not-booted`, `emu-not-running` | it exists but is off | run without `--check` |
| `sim-wrong-model` | a same-named simulator is another model or runtime | `--recreate`, or delete it by UDID |
| `emu-wrong-image` | a same-named AVD is made from another system image (its `config.ini` `image.sysdir.1`), or its config cannot be read | delete only that AVD (`avdmanager delete avd --name <name>`) and run the setup again; `--avd-home` when the AVDs live elsewhere |
| `emu-navigation` | the emulator is not in the profile's navigation mode (default gestural) | run without `--check` (it enables the navbar overlay exclusively) |
| exit 2 `--serial ... runs the AVD ...` / `--udid ... is not the ... simulator` | capture-app was given a device id that does not belong to `--name` | pass the id setup-parity-device.mjs printed, or leave it out |
| `sim-duplicate` | several simulators carry the name | delete the extra ones by UDID |
| `sim-locale` | the system locale is not en_US (24-hour clock) | run without `--check` (sets it and reboots once) |
| `sim-status-bar` | no status bar override (every reboot clears it) | run without `--check` |
| `sim-appearance`, `sim-content-size`, `sim-increase-contrast` | appearance, text size or contrast differ | run with the wanted `--appearance` |
| `emu-display-size`, `emu-display-density` | the emulator is not pinned to the profile's size and density | run without `--check` |
| `emu-night-mode`, `emu-font-scale`, `emu-demo-mode` | appearance, font scale or demo mode differ | run with the wanted `--appearance` |
| exit 2 "is not a parity device name" | `--name` is not `<project>-parity[-<key>]` | name it so nobody mistakes it for an everyday device |

## make-sheet.mjs and check-signoff.mjs

| Rule | Means | Fix |
|---|---|---|
| `stale-report` | report.json belongs to another app.png or reference, or was written by an older check-parity.mjs | run check-parity.mjs again, then make-sheet.mjs |
| `no-sheet`, `stale-sheet` | sheets missing, older than the report, or edited since | run make-sheet.mjs again and look again |
| `not-captured` | a run of the done set has no folder | capture it (run-parity.mjs does them all) |
| `narrowed` | "narrowed: not a sign-off": `--devices`, `--themes` or `--langs` left out part of the done set | drop the options; capture the missing runs, look and record them |
| `reference-variant` | a run was captured against another reference than the facts select | capture again |
| `not-checked`, `not-passing` | no report, or a failing report | run check-parity.mjs; fix the app |
| `not-a-capture` | not written by capture-app.mjs, or the reference copied in as app.png | capture the app; never copy the reference in |
| `not-looked` | no ledger entry, or images missing from `looked` | read every sheet image, then add or complete the entry (`--draft`) |
| `looked-at-old-sheet` | the entry is for an earlier sheet | look at the new sheet, update the entry |
| `eye-check-open` | an eye check is not answered | compare that aspect; `match`, `n/a` or `waived: <reason>` |
| `difference-open` | the look found something still open | fix it (capture, check, sheet, look again) |
| `coverage` | a tall frame's element was never fully on screen in any capture | capture the offsets run-parity.mjs plans, or add one with capture-app.mjs `--scroll <pt>` |
| `waiver-gone` | a report relied on a waiver that was removed | run check-parity.mjs again |
| `ledger-invalid` | the ledger is malformed | start from `templates/design/parity/signoff.json` |
| exit 2 "--date ... is not a calendar day" / "--date belongs to --draft" | a bad `--date`, or one without `--draft` | pass the day of the look with `--draft`, or leave it out for today |

## check-harness.mjs

| Rule | Means | Fix |
|---|---|---|
| `contract-invalid` | a contract, a device profile or the screen contract's frames are malformed or disagree | the message names the key (contract-format.md) |
| `harness-missing` | a harness file (or its test) does not exist | copy it from the templates |
| `harness-frame-missing`, `harness-frame-unknown` | the plans do not list exactly the design frames | one plan per frame of the contracts |
| `harness-root`, `harness-tall`, `harness-probe` | a plan's root, tall flag or probe region disagrees with the contracts | use the contract's values |
| `harness-frame-state` | a dialog, overlay or sheet frame, or a state data alone does not reach, has no plan state | give it the state its model opens |
| `harness-opener` | no model calls `useFrameStateOpener('<state>', ...)` for a planned state | add the opener to the owning model, with its test |
| `harness-parser` | the app's parser refuses a valid launch, accepts a bad one, or cannot be loaded | copy the template parser; keep it pure TypeScript |
| `harness-fixture` | the app's fixture differs from the design's | copy `design/parity/fixture.json` over it; it is never edited to make a frame pass |
| `harness-debug-flags` | the launch does not set every switch (today, motion still, offline off, probe) | copy the template `parity-launch.ts` |
| `harness-draws-nothing` | a harness file renders text or an image | draw it in the real screen, or not at all |
| `harness-launch-marker` | the parity root, or a file rendering React Native's `Modal`, draws no `ParityLaunchMarker`, itself or through a component imported from a file that draws it; or the marker sits outside the file's `accessibilityViewIsModal` view (iOS hides that view's siblings) | render it as the first child of each modal's `accessibilityViewIsModal` view; the shared `Scrim` and `ConfirmDialog` need the same one-line edit (parity-harness.md) |
| `harness-capture-branch` | a production file other than `use-frame-request.tsx`, `use-frame-state-opener.ts`, `use-frame-scroll-target.ts` and the launch marker calls `useFrameRequest()` | open the state with `useFrameStateOpener` and scroll with `useFrameScrollTarget`; never branch on the request |
| `harness-consent` | the app ships react-native-google-mobile-ads, but the launch screen's `consent` applier is missing or does not consult the ads mode (a bare `Promise.resolve()`) | resolve only when `readAdsExtraForBinary(...).adsMode === 'off'`, reject otherwise (examples/parity-launch-screen.tsx). Heuristic: the applier's text, or the file of a named applier, must mention `adsMode`, `ADS_MODE` or `readAdsExtra` |
| `harness-not-exported` | the test-only entry does not export `createParityKit` | add the export (examples/test-only-entry-additions.ts) |
| `harness-not-wired` | nothing reads `TEST_ONLY?.createParityKit`; a file reads it but never calls it; the kit module `parity-root-kit.tsx` is missing or does not render `<ParityFrameRoot>` and `<ParityLaunchBridge>`; or no screen renders `<ParityLaunchRoot>` | register the kit in the app's registry (examples/create-root-kits-parity.ts), copy the kit template, add the app's launch screen (examples/parity-launch-screen.tsx) |
| `harness-route` | no route answers `/debug/parity` | add `src/app/(debug)/debug/parity.tsx` |
| `harness-leak` | a runtime file (outside the test-only folders) imports the harness by value | reach it only through `TEST_ONLY`, or move the importing file into a test-only folder |
| `harness-test-only-folder` | `testOnlyFolders` does not list the harness folder | add it to `contracts/architecture.json` |
| `harness-gitignore` | the runs folder is not ignored | keep `.parity/` in `.gitignore` (the canonical one lists it) |
| `waiver-invalid`, `ledger-invalid` | the waiver file or the ledger is malformed | fix the entry |
| `gated-paths` | quality-gates.json `gatedPaths` misses the waivers, references, manifest, fixture, mockup or device profiles, or covers the sign-off ledger (`design/parity/**`) | list the gated paths one by one (the fix text names them) in a Gate-Change commit |
| `component-border` | component specs keep token border widths although the references are browser renders | `specs.asRenderedBorders: true` (ui-component-library) |

## check-mockup.mjs and shoot-design.mjs

| Rule | Means | Fix |
|---|---|---|
| `mockup-missing` | the mockup the contract names does not exist | put it there, or fix `mockup.file` |
| `mockup-frame`, `frame-missing` | a design frame is drawn 0 or several times, or a `data-frame` names no design frame | one `data-frame` per frame; `data-mock-only` for frames never captured |
| `mockup-testid`, `exactly-one-match` | a testID of the frame matches 0 or several (visible) elements | exactly one `data-testid` per element |
| `mockup-unknown-testid` | a `data-testid` in a frame is not in the screen contract | add it to the contract first, or fix the id |
| `mockup-parent` | a part is not drawn inside its `parent` | nest it, or fix the contract |
| `element-reach` | a crop-only part asks for bounds, text or fill, or a reachable element sits inside a hidden part | `checks: ["crop"]` with a `coveredBy`; draw reachable elements outside hidden parts |
| `element-cover` | a crop-only part has no `coveredBy`, or it names a part that is crop-only, never compared, or not an ancestor | name the nearest reachable ancestor whose crop is compared |
| `state-card-bounds` | an element of a state card asks for bounds | a state card is never compared by position |
| `mockup-offline` | the mockup loads something from the network | copy the file next to the mockup |
| `mockup-font`, `fonts` | a font file is missing, or did not load | copy the exact font file the app bundles |
| `design-error` | the mockup's script threw | fix it, or drop it (static is the default) |
| `design-text` | an element shows another text than the app's catalog for its key | ask the reviewer; change the catalog or the mockup |
| `variant-derive`, `design-mask` | a derive or mask selector matched no element or several, or a derive hid the wrong elements | fix the contract's `derive` or `designMasks` |
| `render-size` | a render came out at another size than the frame's clip at the device scale | a defensive check: Chrome returns the clip at the device scale, and no mockup content was found that breaks it (a zoom or a 7,000 px frame did not), so it has no planted-bug fixture; if it ever fires, suspect the renderer, not the mockup |
| `reference-missing` (shoot-design) | `--check` found no committed reference for a render, or no screen-contract image `<screens.json references>/<frame>.png` | render it with `--update-reference` (it writes both); never export the screen-contract image by hand |
| `reference-drift` | a fresh render differs from the committed reference, or from the screen-contract image (first device, light, source language, 1 pt = 1 px) | find the cause (renderer, font, mockup); update only for an understood, approved, logged change; a lone drift under load: rerun |
| `stale-reference` | the mockup, its fonts or a device profile changed since the render | if deliberate: log it and `--update-reference --change <id>`; else restore the input |
| `reference-changes` | the change log is malformed | `{ id, date, frames, variants, what, why }` |
| `reference-change-unlogged` | `--update-reference` without a logged change naming the frames | log the approved change first, then pass its id |

## Exit 2: bad input or environment

A missing contract for a script that needs one, a malformed run.json, a probed frame's run without its
region, a tooling folder without Playwright (shoot-design.mjs: both install forms are printed), no
device, no Maestro: the message says what and how to fix it. Nothing to check is exit 2, never a pass.

## When the same failure survives three fixes

Stop looping. Report it to the reviewer with the run's `sheet.png` and the element's crop, what was
tried, and a proposal (a fix, a waiver, or a design question). Never change a tolerance, a mask or a
reference to end the loop.
