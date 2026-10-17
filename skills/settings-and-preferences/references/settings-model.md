# The settings model, end to end

Every saved preference: what is stored, where, which action changes it, its first-launch value, and
the code that makes it do something. `scripts/check-settings.mjs` proves the code against the app's
`contracts/settings.json`; this file explains the decisions behind each rule.

## Contents

- Where each piece lives
- The fields and their first-launch values
- Persistence: the key-value default
- Decoding: field by field, never a reset
- Actions and the store
- The effects table
- iOS and Android
- Resets
- Adding or changing a setting
- Appendix: settings in the save document
- When multi-package
- The contract, key by key
- What check-settings reports

## Where each piece lives

| Path | What | Owner |
|---|---|---|
| `src/stores/settings/settings-schema.ts` | `SETTINGS_SCHEMA` (strict valibot object), `Settings`, `DEFAULT_SETTINGS`, `PERCENT` | this skill (canonical, synced) |
| `src/stores/settings/settings-codec.ts` | `decodeSettings` (field by field), `encodeSettings`, `SETTING_KEYS` | this skill (canonical) |
| `src/stores/settings/settings-reducer.ts` | `SettingsAction`, `settingsReducer`, `clampPercent` | this skill (canonical) |
| `src/stores/settings/settings-reducer-cases.ts` | `SETTINGS_REDUCER_CASES`: the reducer rules as plain data (one case per action, the no-ops, the clamp); the reducer test runs them, and state-management-zustand's reducer checker loads the file without the app | this skill (canonical) |
| `src/stores/settings/settings-selectors.ts` | primitive selectors (`selectThemePreference`, `selectIsHapticsOn`, …) | this skill (canonical) |
| `src/stores/settings/settings-store.ts` | `createSettingsStore({ storage, errorLog })` (hydrate, reduce, persist, publish), `useSettingsStore(selector)`, `useSettingsStoreApi()` | this skill (canonical) |
| `src/stores/settings/settings-store-context.tsx` | `SettingsStoreProvider` (the root layout mounts it) | this skill (canonical) |
| `src/services/settings-storage/` | `settings-storage-port.ts`, `fake-settings-storage.ts` (canonical), `kv-settings-storage-adapter.ts` | this skill |
| `src/data/open-device-settings.ts` | creates the store over the kv adapter (part of the composition root) | this skill |
| `src/features/settings-effects/` | `preferences-root.tsx`, `connect-sound-settings.ts`, `haptics-gate.ts`: the effects | this skill |
| `src/features/settings/` | rows (with the account group), preference handlers, `data-resets.ts`, model hook, language-change plan, the screen | this skill (screen layout: ui-component-library) |
| `src/config/external-links.ts` | `PRIVACY_POLICY_PAGE` and `privacyPolicyUrl`, store review page per platform, support mail | this skill |
| `contracts/settings.json` | the app's fields, actions, effects and resets | the app |

The store is created once, in the root layout's first-render initializer, never at module level
(a reload, a direction change and Fast Refresh re-run modules). Context hands the store object down;
zustand carries the changing state, so the provider itself never re-renders anything.

## The fields and their first-launch values

The templates ship a neutral Tasks-app set. Replace it with the app's own fields, in the contract
first.

| Field | Validator | First launch | Action | Effect |
|---|---|---|---|---|
| `language` | `v.nullable(v.picklist(LANGUAGES))` | `null` (System) | `set-language` | `PreferencesRoot` → `I18nProvider` |
| `digits` | `v.picklist(['automatic', 'latin', 'local'])` | `'automatic'` | `set-digits` | `PreferencesRoot` → `I18nProvider digits` |
| `theme` | `v.picklist(['system', 'light', 'dark'])` | `'system'` | `set-theme` | `PreferencesRoot` → `AppThemeProvider preference` |
| `reduceMotion` | `v.picklist(['system', 'on', 'off'])` | `'system'` | `set-reduce-motion` | `PreferencesRoot` → `ReduceMotionPreferenceContext` → the root stack's `RootMotion` → `MotionConfig preference` |
| `hapticsEnabled` | `v.boolean()` | `true` | `set-haptics` | the haptics gate's `isEnabled` (read at call time) |
| `soundEnabled` | `v.boolean()` | `false` | `set-sound` | `connectSoundSettings` (subscription) |
| `soundVolume` | `PERCENT` (integer 0..100) | `80` | `set-sound` | `connectSoundSettings` (÷ 100) |

How to choose a first-launch value:

- **A setting that mirrors a phone setting starts at `'system'` (or `null`)**: language, theme, reduce
  motion, digits. The app then follows the phone until the person chooses, and a phone change reaches
  the app without anyone touching the app's settings.
- **Noise and interruptions start off**: sound, music, notifications, anything that plays over the
  person's own audio or asks for attention. Haptics may start on: they are silent and the phone's own
  switches still apply. audio-and-haptics-feedback's `DEFAULT_AUDIO_SETTINGS` (effects on at 0.8)
  is only the audio adapter's value before the store is open: `connectSoundSettings` applies the
  saved value at startup, so this contract's default wins. A game that wants sound on from the first
  launch changes the contract, the schema default and the codec's fallback together.
- **Everything else is a product decision**: write it in the contract, so the checker holds it.
- Booleans keep data names in storage (`soundEnabled`); code that destructures them renames to a
  question (`const { soundEnabled: isSoundOn } = settings`), as naming-conventions requires.

Other common fields and their effect: a text scale (a provider or the text primitive), a colour-blind
palette (`AppThemeProvider isColorBlind`, when the palette ships one), a reminder time (the
local-notifications sync reads it), a "confirm before delete" switch (a feature hook reads it).

## Persistence: the key-value default

Settings are small, read whole at startup and written whole on each change, so the default home is
`expo-sqlite/kv-store`: a separate small SQLite database (not the app database), with synchronous
`getItemSync` / `setItemSync` (expo-sqlite 57.0.3, read in its type declarations on 2026-10-03;
re-verify with `npm view expo-sqlite@57 version` and the SDK 57 SQLite page).

- **One JSON value under one key** (`settings`). One `setItemSync` is one atomic write, so a change of
  two fields (`set-sound`: on/off and volume) is never half saved. One key per field would be two writes.
- **Behind `SettingsStoragePort`.** `read(): Result<string | null, …>` and
  `write(text): Result<void, …>`; the adapter records an unexpected failure raw in the error log and
  returns the failure value (error-handling-typed-results). Tests use `createFakeSettingsStorage`
  (seeded text, failing reads or writes, a write log).
- **Synchronous on purpose.** The store hydrates in the root layout's first render, so the first
  frame already has the saved theme and language: no flash of the light theme on a dark choice, and no
  layout built in the wrong language. An async load cannot give that.
- **A failed write publishes nothing** and sets `lastWriteFailure`; the screen shows
  `settings.save-failed` and the switch stays where it was.
- **Unreadable storage runs the session in memory** (`isPersistent: false`): changes apply, nothing is
  written, so the saved settings survive for the next launch instead of being overwritten by defaults.
- **On the web** (an app that ships it, web-support): the root layout reads the saved language before
  web-support's `WebStorageGate` has warmed expo-sqlite up, and a synchronous kv-store read there times
  out in a browser. Such an app adds `kv-settings-storage-adapter.web.ts` beside the adapter, keeping
  the same text in `localStorage` (a preference, never a secret); web-support's references show it and
  its `web-sqlite-warm-up` rule fails a root layout without it. iOS and Android never load it.
- **Not AsyncStorage, not MMKV by default, not zustand `persist`.** kv-store is AsyncStorage's
  drop-in replacement with sync calls; `persist` publishes before it saves and keeps a second copy.
  MMKV is persistence-and-migrations' fenced alternative (its contract's `keyValueStore`).
- **Device backups carry the settings** with the app's files (iCloud on iOS, Android Auto Backup
  unless the app config opts out). A restore can bring a setting to a device where it does not apply
  (haptics on an iPad): combine the saved value with the device's capability where it is used, never
  trust it alone. (Behaviour as the platforms document it; not re-verified on a device here.)
- **The app's own backup file leaves preferences out** by default (data-export-and-restore backs up the
  SQLite tables only). An app that wants them in adds a `settings` section to the backup payload,
  validated with this skill's codec (`decodeSettings`, field by field) and restored through the
  settings store's own actions, never by writing the key-value store or SQL underneath it, so the
  effects (theme, language, sound) follow at once and a direction change still goes through
  `planLanguageChange`.

## Decoding: field by field, never a reset

`decodeSettings(text)` returns `{ settings, repairedKeys }`:

| Saved text | Result |
|---|---|
| `null` (first launch) | every default, nothing repaired |
| a field missing (saved before the field existed) | that field's default, quietly |
| a field this version cannot read (`"theme": "sepia"`) | that field's default, reported in `repairedKeys` (the store records it) |
| an unknown field (removed in a later version) | dropped |
| not a JSON object | every default, every key repaired |

So kv-store needs no migrations: **a stored field never changes shape or meaning in place.** A new
meaning gets a new field name (`reminderHour` → `reminderMinutes` is a new field, and the old one is
dropped on the next write). `settings-codec.test.ts` keeps a frozen sample of every shape a shipped
version saved and proves it still decodes; add a sample whenever a field is added, never edit one.

## Actions and the store

| Action | Payload | Changes |
|---|---|---|
| `set-language` | `language: Language \| null` | `language` |
| `set-digits` | `digits` | `digits` |
| `set-theme` | `theme` | `theme` |
| `set-reduce-motion` | `reduceMotion: 'system' \| 'on' \| 'off'` | `reduceMotion` |
| `set-haptics` | `isOn` | `hapticsEnabled` |
| `set-sound` | `isOn, volume` | `soundEnabled`, `soundVolume` (rounded, clamped 0..100; a non-number keeps the old value) |
| `reset-settings` | none | every field back to `DEFAULT_SETTINGS` |

`dispatch`: `next = settingsReducer(current, action)`; the same object means nothing changed, so
nothing is written; else `storage.write(encodeSettings(next))`; on failure `set({ lastWriteFailure })`
and stop; on success `set({ settings: next, lastWriteFailure: null })`. Selectors return primitives
or references already in the state; one that builds an object goes through `useShallow` at the call
site (state-management-zustand).

## The effects table

Each setting changes something outside the settings code, at once. Four mechanisms, each proven:

| Mechanism | Fields | How | Why this one |
|---|---|---|---|
| Provider re-render | language, digits, theme, reduce motion | `PreferencesRoot` reads the selectors and renders `I18nProvider language digits` → `AppThemeProvider preference` → `ReduceMotionPreferenceContext` (the root stack's `RootMotion` turns it into `MotionConfig preference`) → `TextLocaleProvider` | every screen re-renders with the new value; the providers stay store-free and testable |
| Store subscription | sound on/off and volume | `connectSoundSettings(store, applySound)` at startup applies now and after each change, returns the unsubscribe; `applySound` hands the 0..1 output to audio-and-haptics-feedback's `audio.applySettings({ effects, music })` | works with no screen mounted and never renders |
| Read at call time | haptics | `const gate = createHapticsGate()` before `createDeviceServices`, whose haptics adapter takes `gate.isEnabled`; `gate.connect(store)` right after the store opens | the next pulse follows the switch; no subscription to forget; the composition root creates the adapter before the store exists (the store needs the data layer's error log), and until `connect` the gate answers false, so no pulse plays against a setting not read yet |
| Feature hook | a feature preference | the feature's model hook reads a selector (`useSettingsStore(selectX)`) | the UI that depends on it re-renders |

- `AppThemeProvider` mirrors the preference into `Appearance.setColorScheme` (`'unspecified'` for
  System) so native alerts, pickers and the system bars follow the app's choice
  (design-system-structure owns it).
- `MotionConfig` resolves `'system'` against the live phone switch (`systemA11yStore`) and sets
  Reanimated's global mode; animations read `useReduceMotion()` (accessibility-as-code owns both).
- `I18nProvider` takes `localeTagFor(language, digits)`, so catalog numbers and stand-alone numbers
  show the same digits (i18n-strings-and-catalogs).
- The audio and haptics ports themselves belong to audio-and-haptics-feedback; this skill hands them
  the value (`SoundOutput` in 0..1) and the gate.

## iOS and Android

| Topic | iOS | Android |
|---|---|---|
| System language changes | the app is restarted; `getLocales()` stays fixed while it runs | no restart: re-read `getLocales()` when the app becomes active, or pass `useLocales()` to `PreferencesRoot` |
| Per-app language in system settings | Settings › the app › Language (when the app declares its localizations); changing it restarts the app | Settings › Apps › the app › Language on Android 13+ (expo-localization `supportedLocales`, i18n-strings-and-catalogs) |
| Layout direction | applied at the next start; `planLanguageChange` decides the restart; at startup `readSavedLanguage(storage)` gives rtl-and-direction's `DirectionGate` the saved choice before any store opens | the same |
| Reduce motion | Accessibility › Motion › Reduce Motion | Accessibility › Remove animations |
| Haptics row | hidden where the port says unsupported (most iPads) | hidden on devices without a vibrator; the system's touch-feedback switch still applies |
| Store review row | `https://apps.apple.com/app/id<ID>?action=write-review` | `https://play.google.com/store/apps/details?id=<package>` (opens the Play Store app when installed) |
| A row that needs a system setting (notifications blocked) | `Linking.openSettings()` opens the app's page | the same |
| Back from a sub-screen | swipe from the leading edge | predictive back gesture (navigation-and-routing) |

A setting the system owns stays the system's: Apple's tracking answer, notification permission and
the per-app language live in the phone's settings, so the app links there instead of copying them.

## Resets

- **"Delete all data"** (persistence-and-migrations owns the SQL: `resetAllData`, protected tables)
  deletes the person's data and **keeps the settings and purchases**. The settings live in the
  key-value store, so the reset never needs to touch them: never `Storage.clearSync()`,
  `AsyncStorage.clear()` or MMKV's `clearAll()` (each wipes every key, the settings included), and
  never the settings key. check-settings flags a whole-store clear in any app file that imports a
  key-value SDK, outside the storage adapter, whichever handler runs it.
- **First-run state survives too, by default**: an onboarding-done flag, the "what's new" version
  seen, a dismissed tip. The person deleted their tasks, not their knowledge of the app, and replaying
  onboarding after a reset is noise. A product that wants a full factory reset decides it
  explicitly and says so in the confirmation text.
- **`createDataResets(input)`** (`src/features/settings/data-resets.ts`) is what the confirmed dialog
  runs: `input.deleteAllData()` is the data layer's reset inside state-management-zustand's
  `updateAndPublish(stores, write)`, so every store re-reads once the one transaction landed;
  `refetchServerState()` (TanStack Query's `invalidateQueries()`, or a no-op) runs only after a reset
  that landed. `resetAllData(driver)` returns `void` and throws, so the composition root, which holds
  the driver, converts the throw once with `attempt()` into `{ kind: 'data-not-deleted' }`
  (`DataResetFailure`); `examples/use-settings-input.ts` shows the wiring. A failure shows
  `settings.delete-all-data.failed` under the list (`deleteFailedText`), announced on both platforms.
- **"Reset settings"** is its own row, its own confirmation and its own action (`reset-settings`); it
  touches nothing but the settings.
- Both open a confirmation dialog first; a danger row never acts directly.
- After a data reset every screen that shows that data reads it again (queries invalidated, stores
  re-read). In document mode that is one write inside `updateAndPublish`'s callback (the appendix).

## Adding or changing a setting

1. Decide it with the developer: a new setting is a product change. Add the field to
   `contracts/settings.json` (validator, first-launch value, action, effect regex; `unit` and `clamp`
   for a range).
2. Add the field to `SETTINGS_SCHEMA` and `DEFAULT_SETTINGS`; add its `v.fallback` line to the codec;
   add a frozen sample of the previous shape to `settings-codec.test.ts`.
3. Add the action (test first: one example, a property for a range) and its selector.
4. Add the row: its id, testID and label key in `settings-rows.ts` (and the catalogs of every app
   language), its handler in `settings-preference-actions.ts`.
5. Add the effect with its test, in one of the four mechanisms, outside the settings code.
6. Run the tests, then `check-settings.mjs`. Changing a field's meaning is a new field (decoding).

## Appendix: settings in the save document

An app that chose persistence-and-migrations' save document (`"mode": "document"` or `"both"`) keeps
the settings as its `settings` section instead of the key-value store:

- the schema is versioned (`SETTINGS_V1`, `SETTINGS_V2 = v.strictObject({ ...SETTINGS_V1.entries, … })`)
  and changes only through a document migration with frozen fixtures (persistence-and-migrations);
- the store persists with `documents.update((doc) => ({ ...doc, settings: next }))` (one transaction),
  then publishes;
- resets are the document's own (`resetAllProgress` keeps `settings` and `premium`) and are one
  write inside state-management-zustand's `updateAndPublish(stores, write)`. `documents.update`
  returns whether the change reached the disk, so the callback turns that answer into a `Result`:

  ```ts
  onConfirmResetProgress: (): Result<void, ProgressResetFailure> =>
    updateAndPublish(stores, () =>
      documents.update(resetAllProgress, { refreshBackup: true })
        ? ok(undefined)
        : err({ kind: 'progress-not-reset' }),
    ),
  ```

  Never a bare `documents.update(resetAllProgress, …)` outside that callback: the disk is right, but
  every other store keeps showing the old data until the next launch (`reset-publish`).

`examples/settings-contract-document-mode.json` is the contract for that layout (the self-test runs
it); everything else in this skill applies unchanged.

## When multi-package

With npm workspaces the settings code lives in the app workspace (`apps/mobile/src/stores/settings/`).
Keep one contract per app, with repo-relative paths (`"file": "apps/mobile/src/stores/settings/settings-schema.ts"`),
and pass it: `node ${CLAUDE_SKILL_DIR}/scripts/check-settings.mjs . --contract apps/mobile/contracts/settings.json`
(or set `"settingsContract"` in `rn-skills.config.json`). The checker scans every workspace's `src/`.

## The contract, key by key

| Key | Meaning |
|---|---|
| `schema.file`, `schema.export` | the file (a glob for versioned files) and export name (`SETTINGS_V<n>`: the newest is checked) |
| `defaults.file`, `defaults.export` | the first-launch object literal |
| `reducer` | the reducer file (one `case '<action>'` per action) |
| `store.file`, `store.persist`, `store.publish` | the store file and two regexes: the first persist match must come before the first publish match |
| `storage.adapters`, `storage.key` | the only files that may write settings to a storage SDK, and the key they use |
| `screenDirs` | folders whose code dispatches the row actions (the screen, an onboarding language step) |
| `effectExclude` | globs where a read never counts as an effect (the model, its storage, the screen) |
| `fields.<name>` | `schema`, `default`, `action`, `effect` (regex); optional `unit: "percent"`, `scale` (regex, default a division by 100), `clamp` (reducer function) |
| `actions`, `rowExempt` | every reducer action; actions no screen dispatches |
| `resets[]` | `file`, `function`, `keeps` (identifiers the body never names), optional `owner`; `publishWith` in document mode only (a key-value app leaves it out: there state-management-zustand's `crossStoreWrites` checks that `resetAllData` runs only inside `updateAndPublish`) |
| `toggleFeedback` | regex of the switch feedback call (default `playUiFeedback(..., 'toggle')`), or `null` when the app plays none |

`rn-skills.config.json` key read: `settingsContract` (the contract path). Layout keys used:
`srcDir`, `featuresDir`, `storesDir`, `contractsDir` (and each workspace's `srcDir`).

## What check-settings reports

| Rule | Fails when | Fix |
|---|---|---|
| `settings-contract` | a settings screen folder (`src/features/settings/`) exists but `contracts/settings.json` does not (a store folder alone is not enough: the canonical store files may arrive before the screen) | copy the template contract and fill it in |
| `settings-schema` | the schema is missing, not strict, lacks a contract field, has an unknown one, or a validator differs | change contract and schema together |
| `settings-default` | a first-launch value differs from the contract, or an extra key | follow the contract (change it first if the product decided) |
| `reducer-action` | an action has no `case`, or a `clamp` function is never called | one case per action; clamp in the reducer |
| `persist-then-publish` | the store publishes before it persists, or never does one of them | reduce → write → set |
| `hydrate-sync` | the store or a storage adapter awaits, chains `.then`, or calls an `*Async` API | sync reads and writes |
| `single-writer` | zustand `persist` on the store, or a file outside `storage.adapters` writes a field name or the key through a key-value SDK or `localStorage` | read the store, dispatch an action |
| `row-dispatch` | no screen code dispatches an action | wire the row to its handler |
| `setting-effect` | no file outside `effectExclude` matches a field's `effect` | apply it with one of the four mechanisms |
| `unit-scale` | an effect file reads a percent field without the conversion | convert at the edge (`toSoundOutput`) |
| `reset-keeps-settings` | a reset body names a `keeps` identifier; or (key-value mode, `storage` set) an app file outside `storage.adapters` that imports a key-value SDK calls `clearSync(`, `clearAsync(`, `clearAll(`, or `.clear(` on `Storage`, `AsyncStorage`, `localStorage` | keep data resets away from the settings; delete through the data layer |
| `reset-publish` | (`publishWith` set) a `.update(<reset>` that is not inside a `publishWith(...)` call's arguments, or no `publishWith(...)` call names the reset | one write inside `updateAndPublish`'s callback |
| `restart-on-direction-only` | screen code reloads the app in a file without `isRestartNeeded` | reload only after the plan says so |
| `toggle-feedback` | the screen code never calls the contract's feedback | pass it as `onToggled` |

A missing reset file prints `SKIP <file> [reset-keeps-settings] not yet created (<owner> creates it)`;
an app with no contract and no settings screen prints `NOT APPLICABLE`. Missing `package.json` or a
malformed contract is exit 2.

### What the checker cannot see (the tests and the reviewer own these)

The checker reads source text, not types or data flow. Known limits, each covered elsewhere:

- **`setting-effect` is satisfied by the selector's name anywhere outside `effectExclude`**, an
  unused import included. The effect tests (`preferences-root.test.tsx`, `connect-sound-settings.test.ts`,
  `haptics-gate.test.ts`, or the feature hook's test) prove the setting really acts.
- **`restart-on-direction-only` scans only `screenDirs`.** A reload in another feature folder (an
  onboarding language step outside them) is not seen: add that folder to `screenDirs`.
- **The whole-store clear rule knows the common SDK spellings.** A clear behind a wrapper of your own
  (`kv.wipe()`), a `removeItem` of the settings key through a variable rather than the literal, or
  a delete handler that dispatches `reset-settings` passes the scan; `data-resets.test.ts` ("keeps
  every setting and the saved settings text") is the proof, so keep it.
- **The whole-store clear rule cannot tell one store instance from another.** A
  `clearSync()`/`clearAll()` call on a second, separately named store (`new SQLiteStorage('cache')`,
  a second MMKV instance) is flagged as if it emptied the settings store. Rename the call, or keep
  that instance in its own adapter file listed in `storage.adapters` and say why in review. Not
  flagged: calls in a file that imports only `expo-secure-store` (it has no whole-store clear), a
  method of your own being defined (`clearAll(): void { ... }`; its body is still scanned), and a
  call on a receiver that is neither imported from a key-value SDK, built from one in the same file,
  nor a usual store name (`tokenStore.clearAll()`). The rule only reads files that import a clearable
  key-value SDK themselves, so a clear on an instance imported from the app's own module is missed
  whatever its name (`import { storage } from '@/services/kv/storage'; storage.clearAll();` passes,
  the usual MMKV shared-instance shape); `data-resets.test.ts` stays the proof.
- **A setting kept outside the model is not seen here.** A preference with its own persisted store
  (zustand `persist`, or `AsyncStorage` with a key the contract does not name) passes this checker,
  because `single-writer` looks for the contract's field names and storage key.
  state-management-zustand's check-stores `second-persistence` rule catches it: run both checkers.
- **`reset-publish` matches call text.** A reset handed to `updateAndPublish` through a variable
  declared elsewhere counts as wired only when the reset's name appears inside the call.
- **A `useState` mirror of a setting and a Save button are not detected.** Both are review items
  (the anti-patterns); state-management-zustand's `store-set-outside` catches the related bypass,
  a `setState` on the settings store from outside it.
- **`single-writer` needs a field name or the storage key as a string literal** next to a key-value
  SDK import; a key built at run time passes.
