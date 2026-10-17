# The on-device pass

Screenshots prove layout; they never prove behaviour. Once per review, a person runs these steps on
real, cheap phones of the target market, one per shipped platform, in real state, and the record holds
the answer to every step. An agent prepares the build and the record, asks for the pass, and never
claims a step it did not see done.

## Contents

- The hardware and its state
- The order: destructive steps last
- The steps
- Recording results
- Asking a person for the pass

## The hardware and its state

- The cheapest phone the app supports in its main market, not a flagship and not only a device farm:
  both hide memory pressure, slow storage, real fonts and the settings people actually use. A farm or a
  simulator may add coverage, never replace the phone.
- A Release build from a store-like channel, the production variant where the lane offers it (the
  sweep already covered preview; this is the build people install, with the debug code stripped): a
  TestFlight build on iOS, a Play internal-testing build on Android (ios-release-testflight,
  android-release-play). Shrinking and stripping only happen in release builds. Each such build
  spends a build number; that bump alone does not invalidate the sign-off (record-and-signoff.md).
- Real state: ringer on silent, another app's music playing, notifications on, the language and text
  size the person uses, a low battery for one step, the network flaky once. Write the model and the OS
  version at the top of the hardware entry: when a step fails, that header is the whole reproduction
  context.

## The order: destructive steps last

Upgrading, restoring, crashing and reinstalling destroy the state the other steps need, so they run
last, in the plan's order, and the record keeps that order (`review-device-pass`). Doing them first
means doing the screen-reader pass twice.

## The steps

| Step | What to do | Passes when |
|---|---|---|
| `real-state` | Use the app for ten minutes as a person would, in their real setup | nothing feels broken, slow or surprising; first-run prompts make sense |
| `screen-reader` | VoiceOver (iOS), TalkBack (Android): accessibility-as-code's checklist on the key screens, in one ltr and one rtl locale | every control reached in visual order, named, with state; dialogs keep focus; one short announcement per action |
| `switch-access` | Switch Control (iOS), Switch Access (Android), or a hardware keyboard: reach every control, enter and leave every mode (text entry, edit, a sheet) | nothing unreachable, no trap (text fields are the classic one) |
| `largest-text` | Largest text size, plus Bold Text and Display Zoom (iOS) or Display size largest (Android), on the smallest phone | nothing clipped or overlapping; every action still reachable by scrolling |
| `reduce-motion` | Turn Reduce Motion (iOS) or Remove animations (Android) on while the app runs | loops stop, transitions fade, celebrations show their end state, without a relaunch |
| `audio-haptics` | Silent switch on and off, another app's music playing, a sound and a haptic per event | silent means silent; others' music keeps playing; one haptic per event (audio-and-haptics-feedback) |
| `interruptions` | A call or alarm, background and come back, lock the screen, airplane mode, rotate (tablet), split screen | the screen and unsaved input survive; offline is said, not a spinner |
| `upgrade-in-place` | Install the previous store release, create data in every feature, upgrade to this build | every item is still there and correct; a schema check alone proves nothing about copied rows (run-migration) |
| `backup-restore` | Export, wipe or move to a second phone, import; then import a truncated and a hand-corrupted file | data identical; a corrupt file shows an error and never wipes data (data-export-and-restore) |
| `crash-log` | On the preview store-channel build (TestFlight or Play internal testing), trigger the test-only crash and open its report (crash-reporting-and-observability); production strips the triggers, so on a production build answer from a real crash or `n/a` with the reason | symbols readable (not hex offsets), no user content in the report |
| `fresh-install` | Delete the app and install the build again | first run, onboarding and permission prompts appear once, in order, in the person's language |

A step that does not apply stays in the plan and is answered `n/a` with a reason of at least 20
characters ("The app has no export or import of its data yet."). An app adds its own steps (restore
purchases, a widget, a watch app) before the destructive ones.

## Recording results

In `design-review/<review-id>/review.json`, per hardware id of the plan:

```json
"devicePass": {
  "android-budget": {
    "model": "a budget phone, 3 GB RAM",
    "os": "Android 14",
    "date": "2026-10-14",
    "results": {
      "real-state": { "result": "pass" },
      "screen-reader": { "result": "fail", "finding": "F4" },
      "switch-access": { "result": "pass" },
      "backup-restore": { "result": "n/a", "why": "The app has no export or import of its data yet." }
    }
  }
}
```

- `result` is `pass`, `fail` (with `finding`, the id of the recorded finding) or `n/a` (with `why`).
- `date` is the local day the pass ran, between the review start and today.
- A failed step is fixed in the fix round, run again on the fixed build and recorded `pass` with its
  `finding` kept; a sign-off with a `fail` left is refused (`review-signoff`).
- A failure of `screen-reader`, `switch-access`, `largest-text`, `reduce-motion` or a destructive step
  is a BLOCKER finding (`review-floor`).

## Asking a person for the pass

The pass is a human step. When the build is on the store channels, ask once, plainly (the
stop-and-ask format of git-commits-and-reporting): which build, which phones, which steps, where to
write the answers, about 45 minutes per platform. Record the answers exactly as reported; never fill a
result from memory of an earlier release or from a simulator.
