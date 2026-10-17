# The audio engine: library, plugin, port, adapter, lifecycle

How a feedback sound reaches the speaker on iOS and Android, and why each piece is the way it is.
Every code file named here is in this skill's `templates/` folder at the same path it takes in the app.
Versions verified on 2026-10-03 (Expo SDK 57, React Native 0.86.3, react-native-audio-api 0.13.6,
expo-haptics 57.0.3) by reading the installed packages; re-verify with `npm ls react-native-audio-api
expo-haptics` and the "Before any bump" list below.

## Contents

- Versions and install
- The config plugin (iOS and Android)
- The microphone purpose string (ITMS-90683)
- The port
- The adapter: one AudioContext, the session, audio focus
- Voice policy
- One bank: UI sounds plus feature banks
- Lifecycle: suspend, resume, interruptions, dispose
- Music
- Wiring in the composition root
- Testing
- Recorded audio that is not feedback
- Bundled recorded sounds (opt-in)
- Licence rows for a notices screen
- Before any bump
- When multi-package
- Known issues

## Versions and install

| Package | Version | How | Why |
|---|---|---|---|
| react-native-audio-api | **0.13.6, exact** | `npm install --save-exact react-native-audio-api@0.13.6` | Pre-1.0: minor releases have broken APIs. It is not in Expo's module map, so `npx expo install` does not pin it. Its peer is `react-native-worklets >= 0.7.0` (the SDK 57 app's 0.10.1 satisfies it). No npm install script. |
| expo-haptics | `~57.0.3` | `npx expo install expo-haptics` | Expo's SDK 57 map. `expo install` writes the SDK's tilde range even with `save-exact`; keep it. |

`contracts/audio-feedback.json` records the react-native-audio-api version the app verified
(`audioApiVersion`); the checker fails any other pin until "Before any bump" is done and the contract
says so. Without a contract the verified version is 0.13.6.

One engine each: no `react-native-sound` or `react-native-haptic-feedback` beside the ports (two
engines fight over the audio session and double the tests). `expo-av` is not in the SDK 57 module map
(dependency-management lists it as do-not-add). An app that also plays media (a podcast, a video)
uses `expo-audio` or `expo-video` in that feature; the feedback layer (`src/services/audio`,
`haptics`, `feedback`) never imports a media player. The checker's file-audio rule reads only the
feedback layer and files that import react-native-audio-api, so a feature's
`useAudioPlayer('https://…/episode.mp3')` is the feature's business; its recorded files are listed in
the contract's `otherAudio` (see "Recorded audio that is not feedback").

**There is one audio session per process on iOS.** `AVAudioSession` is a singleton: when a media
feature calls expo-audio's `setAudioModeAsync({ playsInSilentMode: true, ... })` (category `playback`)
or expo-video plays, the category changes for the whole app, feedback included: while it holds,
feedback ignores the silent switch and may stop mixing with the user's music. react-native-audio-api
does not watch the category, but it re-applies its own when its engine starts again: the context's
`resume()` goes through `startPlaybackGraph` (stop the engine, then `startIfNecessary` →
`startEngine`), and `startEngine` calls `ensureActive:true`, which forces `configureAudioSession`;
that calls `setCategory` with the desired category (ambient) whenever the session's category differs
(read in `ios/audioapi/ios/core/NativeAudioPlayer.m`, `system/AudioEngine.mm` and
`system/AudioSessionManager.mm`, 0.13.6). So the suspend and resume that `useAudioLifecycle` does
around `isInterrupted` bring ambient back. The media feature's part:

1. While media plays, the app passes `isInterrupted: true` to `useAudioLifecycle`, so feedback is
   suspended and never plays over the media (an iOS call that ends meanwhile does not resume it: the
   adapter resumes after an interruption only while the lifecycle wants audio running).
2. When the media stops, `isInterrupted` goes back to false and the context resumes, which re-applies
   ambient as above. Optionally, as belt and braces (and required for media that plays without setting
   `isInterrupted`, since then the context never restarts), the feature restores the category itself:
   `await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' })`
   (expo-audio 57.0.5 maps exactly that to `AVAudioSession.Category.ambient` with no options, read in
   `ios/AudioModule.swift`). expo-audio also deactivates the shared session
   (`setActive(false, notifyOthersOnDeactivation)`) about 100 ms after its last player stops; the next
   `startEngine` activates it again.

**Not verified on a device**, and not read for expo-video; the listening checklist asks a human: after
the media plays, with the silent switch on, is the app silent again, and does the user's music mix
again? Android has no shared category: media takes audio focus for itself, feedback never does, and
nothing needs restoring.

## The config plugin (iOS and Android)

`src/config/audio-plugin.ts` exports `AUDIO_API_PLUGIN`; `app.config.ts` imports it with a relative
path and the extension (`import { AUDIO_API_PLUGIN } from './src/config/audio-plugin.ts';`, because
Expo runs the config in Node) and lists it in `plugins`. An unlisted plugin means every default applies.

```ts
export const AUDIO_API_PLUGIN: PluginEntry = [
  'react-native-audio-api',
  {
    iosBackgroundMode: false,
    androidPermissions: [],
    androidForegroundService: false,
    disableFFmpeg: true,
    disableStaticExternalLibs: true,
  },
];
```

What each default would do (read in `src/plugin/withAudioAPI.ts`, 0.13.6):

| Option | Default | Effect of the default |
|---|---|---|
| `iosBackgroundMode` | `true` | adds `audio` to `UIBackgroundModes`: App Review asks why a feedback app plays in the background |
| `androidPermissions` | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | merged into the manifest; Play asks for a foreground-service declaration |
| `androidForegroundService` | `true` | registers `CentralizedForegroundService` (type `mediaPlayback`) |
| `disableFFmpeg` | `false` | the podspec and a Gradle task download FFmpeg at build time (pinned by release tag, no checksum) |
| `disableStaticExternalLibs` | `false` | the same script downloads the Opus/Vorbis static libraries |

With every default overridden the build downloads nothing for this library on either platform and the
library's own manifest adds no permission. Verify once after `npx expo prebuild --clean` (or in an EAS
build's logs): `ios/<App>/Info.plist` has no `UIBackgroundModes` audio and no
`NSMicrophoneUsageDescription`; the Podfile has `ENV['DISABLE_AUDIOAPI_FFMPEG'] = '1'` and
`ENV['DISABLE_AUDIOAPI_STATIC_EXTERNAL_LIBS'] = '1'`; `android/gradle.properties` has
`disableAudioapiFFmpeg=true` and `disableAudioapiStaticExternalLibs=true`; the merged
`android/app/src/main/AndroidManifest.xml` has no `FOREGROUND_SERVICE` permission and no
`CentralizedForegroundService`. The `VIBRATE` permission there comes from expo-haptics' own manifest.

## The microphone purpose string (ITMS-90683)

Add none up front: feedback never records. The library's binary references record-permission APIs, so
an App Store upload may still report ITMS-90683 ("Missing purpose string in Info.plist",
`NSMicrophoneUsageDescription`). Only then set the plugin option `iosMicrophonePermission` to a
neutral sentence, put a comment naming ITMS-90683 on the line above, localise it through the app
config's `locales`, and build again with a new build number. Use the plugin option or an
`ios.infoPlist` entry, never both. The app never asks, so users never see it. Google Play has no
equivalent warning, and with `androidPermissions: []` there is no `RECORD_AUDIO` to explain.

## The port

`src/services/audio/audio-port.ts` is the only audio API the app uses:

| Member | What it does |
|---|---|
| `load(bank)` | Synthesises every recipe at the context's sample rate and uploads the buffers. Once, at startup. |
| `play(id, delayMs?)` | Plays now, or `delayMs` later on the audio clock (track cues). Unknown ids are ignored. |
| `cancelPending()` | Stops voices scheduled for the future (fast-forward, pause, leaving the screen). |
| `applySettings(settings)` | Ramps the three category gains to the sound effects and music settings. |
| `startMusic(id)` / `stopMusic()` | The one looped music voice. |
| `suspend()` / `resume()` | Pauses and resumes the engine (background, full-screen video or ad). |
| `dispose()` | Closes the engine: before any JS reload, and in tests. |

Categories: `sfx` (feature and game sounds) and `ui` (the UI moments) follow the sound effects setting;
`music` follows the music setting. `DEFAULT_AUDIO_SETTINGS` is effects on at 0.8 and music **off** at
0.6. The settings store keeps its own fields (settings-and-preferences owns them and the glue that
calls `applySettings` with volumes 0…1 whenever they change).

## The adapter: one AudioContext, the session, audio focus

`audio-api-audio-adapter.ts` is the only file that imports `react-native-audio-api`. It creates exactly
one `AudioContext` per app, lazily on the first `load`, and only after:

```ts
AudioManager.setAudioSessionOptions({ iosCategory: 'ambient', iosMode: 'default', iosOptions: [] });
```

- **iOS: the ambient category** respects the silent switch and mixes with other apps' audio, so the
  user's music keeps playing and the app is quiet when the phone is on silent. The session must be set
  before the context exists. Leave `iosAllowHaptics` at its default (it only matters while recording).
- **Android: never request audio focus.** `setAudioSessionOptions` does nothing on Android. The library
  maps `observeAudioInterruptions(true)` to `requestAudioFocus(AUDIOFOCUS_GAIN)` (read in
  `AudioAPIModule.kt` and `AudioFocusListener.kt`, 0.13.6), and on Android 12 and later the system then
  fades out and mutes whatever the user was playing (Android's audio focus guide). Feedback sounds play
  without focus and mix, which is the Android equivalent of iOS's ambient category. So the adapter
  observes interruptions on iOS only: `if (Platform.OS === 'ios') AudioManager.observeAudioInterruptions(true);`.
  A focus type (`'gainTransientMayDuck'`) ducks the user's music for every tap: never for feedback.
- **Android has no silent switch.** Feedback plays on the media stream at the media volume; the user's
  silent or vibrate ringer mode does not mute it, the same as most Android apps and games. The in-app
  sound effects switch is the user's control (settings-and-preferences shows it on both platforms).
- **Graph.** Each voice is a single-use `AudioBufferSourceNode` feeding one of three `GainNode`s
  (`sfx`, `ui`, `music`) that feed the destination. Source nodes are cheap and collected after `ended`.
- **Scheduling.** `play(id, delayMs)` starts at `ctx.currentTime + delayMs / 1000`, so a cue at 120 ms
  lands on the frame its animation starts. Delayed voices are remembered so `cancelPending()` can stop them.
- **Errors.** The adapter never throws or rejects into the UI: `suspend`, `resume` and `dispose` catch a
  vendor rejection and hand it to `reportError` (the adapter boundary of error-handling-typed-results),
  which the composition root wires to the error log.
- **Sources.** Buffers come from `synthesizeRecipe`. No `createStreamer`, no URL or network source; a
  bundled recorded file only in the opt-in profile below.

## Voice policy

`admit-voice.ts` is pure and decides, on the audio clock, whether a voice may start. Each admitted voice
is an interval (`soundId`, `startMs`, `untilMs`), so scheduled cues are judged correctly:

- At most **8** overlapping voices (`MAX_VOICES`): a burst of 30 cues never turns into noise. Only
  voices whose interval overlaps the new one count.
- The same sound restarts at most once per **30 ms** (`DEFAULT_MIN_INTERVAL_MS`), or its own
  `minIntervalMs` (60 ms for rapid hits; at most 1000 ms, `REMEMBER_MS`). Distance counts both ways,
  because a timeline may schedule tracks out of time order.
- `cancelPending()` stops every voice that has not started and `releaseVoices` frees their slots and
  repeat windows; otherwise the next action finds its own sounds "too soon" and drops them silently.
- `channelGain(setting)` is `volume²` when on and 0 when off: a squared slider sounds even.
- Every gain change ramps linearly over **50 ms** (`RAMP_S = 0.05`): an instant jump clicks.

## One bank: UI sounds plus feature banks

The UI moments' sounds are `UI_SOUNDS` (`ui.toggle`, `ui.success`, `ui.error`; category `ui`). Each
feature (or game) that makes sounds ships `<FEATURE>_SOUNDS` in
`src/features/<feature>/sounds/<feature>-sounds.ts` (`src/games/<game-id>/sounds/<game-id>-sounds.ts`).
The root layout loads them once:

```ts
services.audio.load(composeSoundBank(TASKS_SOUNDS));
```

`composeSoundBank` throws when a feature id is in the `ui.` namespace or two banks share an id: either
would silently replace another sound. The composition root (`src/services/`) may not import features,
so the root layout, which may, composes the bank. `hasMusic(bank)` is the one fact settings needs to
hide music controls.

## Lifecycle: suspend, resume, interruptions, dispose

`useAudioLifecycle({ audio, isInterrupted, reportError })` is mounted **once**, in the root layout
(`src/app/_layout.tsx`; with React Navigation, the component that renders the navigation container).
The context runs only while the app is active (`useIsAppActive`, react-components-and-hooks' shared
hook: iOS reports `inactive` for the app switcher, Control Center and calls; Android only `active` and
`background`) and nothing full-screen plays its own sound (`isInterrupted`: a video, an interstitial).
`suspend()` also cancels pending voices.

- iOS audio-session interruptions (a call, Siri) suspend the context on `began` and resume it on
  `ended` when iOS says `shouldResume` and the lifecycle's last request was `resume()` (a call that
  ends during a full-screen video leaves feedback suspended). Android sends none without focus; leaving the foreground for a
  call suspends through `useIsAppActive`.
- A canvas surface also cancels its cues and suspends audio when its screen loses focus
  (skia-canvas-rendering owns that lifecycle).
- **Before any JS reload** (`reloadAppAsync` after a language or direction change, `Updates.reloadAsync`
  after an update), `await services.audio.dispose()` first, so the old native engine closes before the
  bundle reloads. Three accepted shapes, in this order of preference:
  1. The reloading code has the services: `await services.audio.dispose();` then the reload.
  2. **The seam:** a module that may not reach the services (rtl-and-direction's `restartForDirection`
     in `src/i18n/direction.ts`) takes a `beforeReload: () => Promise<void>` parameter (or an
     `onBeforeReload` option), awaits it right before the reload, and its caller, the model that has
     the services, passes `() => services.audio.dispose()`:

     ```ts
     // src/i18n/direction.ts (rtl-and-direction owns it)
     await beforeReload();
     await reloadAppAsync(`layout direction -> ${direction}`);
     // the language model
     await restartForDirection(direction, guard, () => services.audio.dispose());
     ```

     The checker's `dispose-before-reload` rule accepts the awaited hook and then requires some caller
     of that function (a non-test file that calls it by name) to name `audio.dispose`. A caller that
     only forwards its own `beforeReload` hands the question up: rtl-and-direction's
     `DirectionRestart` forwards to `restartForDirection` and `DirectionGate` forwards to
     `DirectionRestart`, so the root layout that renders the gate passes
     `beforeReload={() => services.audio.dispose()}` (the checker follows the chain of exported
     components and functions that mention the hook).
  3. Code outside every provider (the root error boundary's crash restart) says why on the line above:
     `// audio-dispose-exempt: <reason>`.

## Music

Off by default. react-native-audio-api has no API that reports "other audio is playing", so the only
safe default is off: an app never plays music over the user's own.

- Most apps have no music; then every music control is hidden, never greyed out (`hasMusic(bank)` is
  false; settings-and-preferences owns the rows).
- An app with music has one bank entry with `category: 'music'` and `isLoop: true` (a few seconds of a
  simple synthesised pattern, up to 30 s), started with `startMusic(id)` only when the music setting is
  on, stopped with `stopMusic()` when it goes off.
- Never call the library's experimental `activelyReclaimSession`: it stops the engine when other audio
  plays.
- Defaulting music on needs a small local Expo module that returns
  `AVAudioSession.secondaryAudioShouldBeSilencedHint` on iOS (Android has no equivalent; the media
  volume and focus rules above apply) and starts music only when it is false. Ask the developer first.

## Wiring in the composition root

The architecture's three files take one member each (architecture-and-boundaries owns them):

```ts
// src/services/services-context.tsx: Services
readonly audio: AudioPort;
readonly haptics: HapticsPort;

// src/services/create-device-services.ts (the only file that creates adapters)
audio: createAudioApiAudioAdapter({ reportError: (error) => { errorLog.record('service', error); } }),
// options.haptics.isEnabled is settings-and-preferences' haptics gate (gate.isEnabled)
haptics: createExpoHapticsAdapter({ isEnabled: options.haptics.isEnabled, nowMs: clock.nowMs }),

// src/services/create-test-services.ts
audio: given.audio ?? missingPort('audio'),
haptics: given.haptics ?? missingPort('haptics'),
```

settings-and-preferences owns the haptics preference (default on), its gate and the sound glue. The
gate is created before the services, because the composition root creates the adapter before the
settings store exists; `gate.isEnabled` answers false until `gate.connect(settings)`, so no pulse plays
against a setting not read yet. `connectSoundSettings(settings, applySound)` then calls
`audio.applySettings({ effects, music })` with volumes 0…1 now and after every change. The root layout
loads the bank and mounts the lifecycle:

```tsx
function startApp(): Startup {
  const hapticsGate = createHapticsGate();
  const services = createDeviceServices({ haptics: { isEnabled: hapticsGate.isEnabled } });
  services.audio.load(composeSoundBank(TASKS_SOUNDS));
  // ...open data and settings (settings-and-preferences), then:
  hapticsGate.connect(settings);
  connectSoundSettings(settings, (effects) => {
    services.audio.applySettings({ effects, music: DEFAULT_AUDIO_SETTINGS.music });
  });
  return { services, ... };
}
// inside RootLayout, once
useAudioLifecycle({ audio: app.services.audio, isInterrupted, reportError });
```

**Behind a direction gate.** When the root layout renders a gate that may reload the JS run before
the app mounts (rtl-and-direction's `DirectionGate`, which shows `DirectionRestart` and flips), the
bank load and `useAudioLifecycle` live in the gate's child (`AppRoot`) instead of `startApp`: load
in `AppRoot`'s first-render state initializer. A restart run then never creates an `AudioContext`,
and the gate's `beforeReload` prop (`() => services.audio.dispose()`, forwarded to the seam) closes
nothing, harmlessly, because `dispose` before `load` is a no-op. `load` is idempotent (one context,
buffers replaced), so Strict Mode's double initializer in development is harmless too.

Then the tests that know the port list follow: `create-device-services.test.ts` lists `audio` and
`haptics` among the ports, and a hook or component test whose code now plays feedback passes the fakes
through the render helper (`createProvidersWrapper({ services: { audio: createFakeAudio(), haptics:
createFakeHaptics() } })`) instead of meeting `createTestServices`' throwing stand-in. Verified on
2026-10-03 by adopting the templates into a copy of the reference Tasks app: both programs type-check,
ESLint passes, all 761 tests pass in the unit and android projects, and both checkers print
`RESULT: PASS`.

`examples/root-layout-wiring.tsx` shows the whole shape.

## Testing

- Everything above the adapters injects `createFakeAudio()` (records `{ kind, ... }` calls) and
  `createFakeHaptics()` (records `played` cues) and asserts the calls (unit-and-component-tests rule 7).
- The adapter test runs on the **root manual mock** `__mocks__/react-native-audio-api.ts` (this skill
  owns it). The library's own mock (`react-native-audio-api/mock`, 0.13.6) has no
  `AudioManager.setAudioSessionOptions` or `observeAudioInterruptions`; without the root mock the
  adapter test fails with "setAudioSessionOptions is not a function". Values come back from plain
  functions, so no mock reset empties them (Jest 29.7's `restoreMocks` keeps a root mock's
  `jest.fn(impl)`, but `resetMocks` or a test's `mockReset()` would drop it; checked 2026-10-10).
- `audio-api-audio-adapter.android.test.ts` runs in the android Jest project (jest-expo/android, the
  real `Platform.OS`): after `load()` it proves `observeAudioInterruptions` was never called (no audio
  focus) while the interruption listener is still added.
- An adapter test that inspects the mock calls `jest.mock('react-native-audio-api')` and then
  `jest.requireMock(...)`; without the explicit `jest.mock`, `requireMock` returns a second instance
  with zero calls. Tests never import a vendor SDK.
- `use-audio-lifecycle.test.ts` replaces `@/hooks/use-is-app-active` with a switch the test flips.
- `synthesize-recipe.test.ts` gates every UI sound; each bank's test gates its bank (sound-design.md).
- The adapter test spies on the mock's `AudioBufferSourceNode.prototype.start`/`stop` to prove
  `cancelPending` stops and releases scheduled voices.

## Recorded audio that is not feedback

A notification sound (expo-notifications plays a file from the app bundle; an Android channel names
it) and a feature's media are not feedback, so they are not synthesized and the adapter never decodes
them. They are still listed, so every shipped audio file has a licence and a source:

```json
"otherAudio": [
  { "file": "assets/sounds/reminder.wav", "purpose": "notification", "license": "CC0-1.0", "source": "recorded by the team" }
]
```

`purpose` is `notification` or `media`. The checker fails any recorded audio file in the repo that
neither `bundledSounds` nor `otherAudio` lists, and any listed file that is missing.

## Bundled recorded sounds (opt-in)

Synthesized recipes are the default: no licences, byte-identical renders, a testable gate, previews
before any build. An app that must ship a recorded sound (a brand chime) opts in:

1. Put the file in `assets/sounds/` (short, 48 kHz mono, **WAV (PCM), MP3 or FLAC**) and list it in
   `contracts/audio-feedback.json` `bundledSounds` with its licence and source; the checker fails any
   recorded file the contract does not list, any listed file that is missing, and a `bundledSounds`
   file in another format. Never CAF, M4A/AAC or OGG/Opus: with `disableFFmpeg` and
   `disableStaticExternalLibs` the library decodes only what miniaudio reads (`AudioFormat.h` has no
   CAF; `needsFFmpeg` in `AudioDecoding.h` covers MP4/M4A/AAC; Vorbis and Opus need the static
   libraries; read in 0.13.6), so such a file stays silent and leaves only a `reportError` entry.
2. Decode it only in the adapter: `ctx.decodeAudioData(require('@/assets/sounds/chime.wav'))` (0.13.6
   resolves a module number through `Image.resolveAssetSource`, read from source). Prove it on a release
   build of both platforms before relying on it: not verified on a device.
3. Never a URL: the checker fails `createStreamer` and any `http(s)` audio file name in the feedback
   layer and in any file that imports react-native-audio-api.

`examples/bundled-sound-loading.ts` shows the shape.

## Licence rows for a notices screen

The library compiles vendored native code into the app, which a JavaScript licence audit cannot see.
If the app shows open-source notices, add (checked against the headers in
`react-native-audio-api/common/cpp/audioapi/libs` and `dsp/r8brain`, 0.13.6; re-check per version):

| Name | Licence | Copyright |
|---|---|---|
| miniaudio | MIT-0 | Copyright 2025 David Reid |
| PFFFT | LicenseRef-FFTPACK | Copyright (c) 2013 Julien Pommier; Copyright (c) 2004 the University Corporation for Atmospheric Research |
| moodycamel ConcurrentQueue | BSD-2-Clause | Copyright (c) 2013-2020, Cameron Desrochers |
| r8brain-free-src | MIT | Copyright (c) 2013-2025 Aleksey Vaneev |
| base64 | Zlib | Copyright (C) 2004-2017, 2020-2022 René Nyffenegger |

Synthesized sounds need no credit. The npm packages (`react-native-audio-api` MIT, `expo-haptics` MIT)
come from the release licence audit.

## Before any bump

The library is pre-1.0, so every version change is a small project:

1. `npm view react-native-audio-api version dist-tags` and read the release notes since the pinned version.
2. Re-read `node_modules/react-native-audio-api/src/plugin/withAudioAPI.ts` (new defaults?) and
   `src/mock/index.ts` (does the library mock now have the AudioManager methods? then the root mock
   shrinks), `src/system/AudioManager.ts` and the Android `AudioAPIModule.kt` (audio focus); for an app
   with media, `ios/audioapi/ios/core/NativeAudioPlayer.m` and `system/AudioEngine.mm` (does resume
   still restart the engine and re-apply ambient?); for bundled sounds, `common/cpp/audioapi/core/utils/AudioDecoding.h`
   (which formats need FFmpeg; widen `BUNDLED_DECODABLE` in the checker only after reading it).
3. Run the adapter tests, then a smoke test on a named iOS simulator and a named Android emulator (a
   sound plays, the user's music keeps playing, background suspends).
4. Ask a human to listen to the WAV previews and to the app on a phone (sound-design.md).
5. Record the version as `audioApiVersion` in `contracts/audio-feedback.json`, in the same commit as
   the pin.

## When multi-package

Native modules autolink per app, so every Expo app workspace lists both packages (react-native-audio-api
exact, expo-haptics with the SDK range); a shared package that holds the feedback layer declares them as
`peerDependencies` `"*"` (the checker accepts `*` only there). Run the checker with
`--src-dir apps/<app>/src` (or the workspace keys of `rn-skills.config.json`).

## Known issues

1. **ITMS-90683 may appear on the first upload.** The fallback is ready: `iosMicrophonePermission` with
   a comment and localisation.
2. **The library's Jest mock is incomplete in 0.13.6.** The root mock completes it; re-check on every bump.
3. **Haptics swallow their own failure** (`.catch(() => undefined)` with a `best-effort:` comment), the
   one licensed swallow of error-handling-typed-results; audio promise failures are recorded instead.
4. **Simulators**: the iOS simulator plays through the Mac at 48 kHz and has no silent switch; the
   Android emulator plays through the host. Only a phone proves the ambient and no-focus behaviour.
