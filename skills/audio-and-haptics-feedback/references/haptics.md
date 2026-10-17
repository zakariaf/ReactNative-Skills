# Haptics: the port, the cue table on iOS and Android, the throttle

A haptic is a short tap on a meaningful event: a switch flips, a task is done, an action fails. It
follows the user's haptics preference, is throttled, never throws, and is hidden where the device has
no haptic engine. Facts verified on 2026-10-03 by reading expo-haptics 57.0.3 (`src/Haptics.ts`,
`android/.../HapticsModule.kt`, `HapticsRecord.kt`) and Expo's SDK 57 haptics page; the feel of each
cue is not verified on a device (a human checks it).

## Contents

- The port and the adapter
- The cue table
- Rules of use
- The throttle and the preference gate
- Devices and failure modes
- Testing
- The human check

## The port and the adapter

`src/services/haptics/haptics-port.ts`:

```ts
export type HapticCue = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';
export type HapticsPort = {
  readonly isSupported: boolean; // false on iPad: the haptics preference row is hidden
  readonly play: (cue: HapticCue) => void; // gated, throttled, never throws
};
```

A canvas track's cue uses the same seven names (skia-canvas-rendering's `TrackCue.haptic`), so the cue
scheduler passes them straight through.

`expo-haptics-adapter.ts` is the only file that imports `expo-haptics`. The composition root creates it
once with the preference read at call time and the injected clock. The preference reader is
settings-and-preferences' haptics gate (`createHapticsGate()`, created before the services; it answers
false until `gate.connect(settings)`):

```ts
haptics: createExpoHapticsAdapter({ isEnabled: hapticsGate.isEnabled, nowMs: clock.nowMs }),
```

Never import `Vibration` from `react-native` for feedback, and never add a second haptics library.
The checker's `vendor-import` rule fails a `Vibration` import in the feedback layer
(`src/services/audio`, `haptics`, `feedback`) and in every view (`src/ui`, a feature's screen or
components). Elsewhere a feature that needs a long pattern that is not feedback (a timer alarm that
repeats until dismissed) imports it with the reason on the import line or the line above:
`// vibration-exempt: <reason>`. Such a pattern ignores the haptics preference and the throttle, so it
is never a substitute for a cue.

## The cue table

| `HapticCue` | iOS (expo-haptics) | Android 14+, API 34 (`performAndroidHapticsAsync`) | Android 11 to 13, API 30-33 | Android 7 to 10 (legacy) | Use for |
|---|---|---|---|---|---|
| `selection` | `selectionAsync()` | `AndroidHaptics.Segment_Tick` | `Clock_Tick` | `Clock_Tick` | a switch flips, a picker steps |
| `light` | `impactAsync(ImpactFeedbackStyle.Light)` | `Context_Click` | `Context_Click` | `Context_Click` | the most repeated action (a task checked, an item dropped) |
| `medium` | `impactAsync(ImpactFeedbackStyle.Medium)` | `Virtual_Key` | `Virtual_Key` | `Virtual_Key` | a payoff (a streak grows) |
| `heavy` | `impactAsync(ImpactFeedbackStyle.Heavy)` | `Long_Press` | `Long_Press` | `Long_Press` | a rare big moment |
| `success` | `notificationAsync(NotificationFeedbackType.Success)` | `Confirm` | `Confirm` | `Context_Click` | an action succeeded, a goal is reached |
| `warning` | `notificationAsync(NotificationFeedbackType.Warning)` | `Reject` | `Reject` | `Long_Press` | an action was refused, a limit is near |
| `error` | `notificationAsync(NotificationFeedbackType.Error)` | `Reject` | `Reject` | `Long_Press` | an action failed |

Why Android uses `performAndroidHapticsAsync`: it calls `View.performHapticFeedback`, needs no
`VIBRATE` use, and follows the system's touch-feedback setting, the way iOS feedback generators follow
System Haptics. Expo's page says the `Vibrator` API behind `impactAsync`/`notificationAsync` on Android
"is not recommended for implementing haptics feedback".

Why a legacy table: expo-haptics 57.0.3 looks the constant up by reflection and rejects
(`HapticsNotSupportedException`) when the device's API level lacks it; only `Clock_Tick`,
`Context_Click`, `Keyboard_Tap`, `Long_Press` and `Virtual_Key` exist on every level from the app's
minSdk 24. `Confirm`/`Reject` arrived in API 30 and `Segment_Tick` in API 34, so the adapter reads
`Platform.Version` and picks `ANDROID_CUES` from API 34 (`ANDROID_CUES_API`), `ANDROID_API_30_CUES`
from API 30 (`ANDROID_OUTCOME_CUES_API`: the outcomes keep `Confirm`/`Reject`, only `selection` falls
back to `Clock_Tick`), and `ANDROID_LEGACY_CUES` below it, where success and failure are only told
apart by strength (`Context_Click` against `Long_Press`). The adapter's `fireIos` switch and the three
Android tables are this table as code; `check-audio-haptics.mjs` verifies every row (`haptic-table`,
`haptic-android`: the legacy table may use only the five every-level constants, the API 30 table also
`Confirm`, `Reject`, `Gesture_Start` and `Gesture_End`).

## Rules of use

- Pulse only on meaningful events: a row of a feature's cue table (`'task-completed'` → `light`), a
  track cue, a UI moment (`playUiFeedback`). Never per frame, never per tick of a real-time sim (drain
  events on JS and pick the few that matter).
- Buttons use no haptics. The one UI exception is `selection` on switches and picker steps; the
  checker's `button-haptics` rule fails any other cue fired from `src/ui` or a feature's screen or
  components (event feedback belongs to the model).
- One pulse per visible event. A burst that completes five tasks gets one `success`, not five; the
  throttle would drop most of them anyway.
- Match strength to importance: `light` for the most repeated action, `medium` for a payoff, `heavy` for
  a rare moment, the notification types for outcomes. An event shown by a canvas animation pulses from
  its track cue only, never also from the cue table.
- Reduce motion does not remove haptics or sounds (accessibility-as-code owns reduce motion); a scaled
  timeline moves its cues with it.

## The throttle and the preference gate

`should-pulse.ts` is pure:

- No pulse while the user's haptics preference is off (read at call time, so the switch takes effect at
  once).
- No pulse closer than **40 ms** (`MIN_HAPTIC_GAP_MS`) to the previous one: closer pulses feel mushy,
  like a buzz, so a burst feels like one strong event.
- `nowMs` is wall-clock time from `ClockPort`; a clock that jumps backwards (a negative gap) lets the
  pulse through rather than muting haptics.

## Devices and failure modes

- **iPad:** no haptic engine. The adapter reports `isSupported: false` (`Platform.isPad`) and never
  pulses; settings hide the haptics row (hidden, never greyed out; settings-and-preferences owns it).
- **Android:** treated as supported; a device without a vibrator ignores `performHapticFeedback`, and
  the user's system touch-feedback setting can turn it off. expo-haptics' manifest merges the `VIBRATE`
  permission (used by its Vibrator calls, which this adapter does not make on Android).
- **iOS conditions where the Taptic Engine does nothing** (Expo's page): Low Power Mode, haptics turned
  off in Settings, the camera active, dictation active. The call succeeds silently.
- **Why the call can reject at all** (read from source): the native module is missing in a development
  build made before expo-haptics was added (`UnavailabilityError`), and on Android the React context is
  gone during a reload, or a constant is newer than the device. Every call ends with
  `.catch(() => undefined)` under a `// best-effort:` comment: the one licensed swallow
  (error-handling-typed-results), allowed only inside the adapter.
- **Simulator and emulator:** no haptic engine; a call proves only the wiring.

## Testing

- `should-pulse.test.ts`: off is silent, the 40 ms boundary (39 dropped, 40 allowed), a backwards clock.
- `expo-haptics-adapter.test.ts` (unit project, iOS preset): `jest.mock('expo-haptics', factory)` records
  native calls; the test passes a `device` ({ os, isPad, apiLevel }) instead of overwriting `Platform`,
  and asserts the iOS table, the Android table on API 34, the throttle, the preference gate and the
  iPad; `androidHapticFor` proves the API 30 and legacy tables at their boundaries.
- `expo-haptics-adapter.android.test.ts` (android project, jest-expo/android): the adapter reads the
  real `Platform` and pulses through `performAndroidHapticsAsync`, never the Vibrator calls.
- Everything else uses `createFakeHaptics()` and asserts `played`.

## The human check

Strength and feel are judged on real phones, one iPhone and one Android phone, by a human: does each
pulse match its moment, does any sequence feel like a buzz, does turning the in-app haptics switch off
silence them at once? It never blocks a change; record the answers and tune one cue at a time.
