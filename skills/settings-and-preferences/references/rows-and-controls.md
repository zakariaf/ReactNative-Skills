# Rows and controls: behaviour, accessibility, copy and navigation

How each kind of settings row behaves when touched, how VoiceOver and TalkBack read it, the copy
keys, the testIDs, the route, and the tests to write. Visual sizes come from the design system and
ui-component-library; this file is about what the rows do.

## Contents

- The screen: route, model, view
- Switch rows
- Segmented rows (Numbers, Theme)
- The volume slider
- Chevron rows and danger rows
- The account group
- The language list and the restart dialog
- Dialogs
- Copy keys
- testIDs and end-to-end flows
- Tests to write
- Appendix: React Navigation 7 (static API)

## The screen: route, model, view

- **Route** `src/app/(app)/settings.tsx` stays thin: it renders `SettingsScreen` from
  `src/features/settings/` with the model a feature hook returns (`examples/settings-route.tsx`). Its
  title comes from the group layout (`t('settings.title')`), like every screen's.
- **Model** `useSettingsModel(input)` is the only code of the feature that reads the store, the copy
  and the feedback. `input` carries the row facts (`SettingsContext`: signed in, haptics supported,
  Premium owned, consent needs an entry point), the device locales, the layout direction, the
  restart callback and `dataResets` (the data layer's reset through `updateAndPublish`, and the
  server-cache refetch); `examples/use-settings-input.ts` shows where each comes from.
- **View** `settings-screen.tsx` is a pure view of the model (`examples/settings-screen.tsx`): one
  section per group (`group.title` as a header), one row per `group.rows` entry, its testID and
  label from the model, the save-failed note when `saveFailedText` is set and the delete-failed note
  when `deleteFailedText` is set, and the three confirm dialogs. A sub-screen (language, about,
  licences) is its own route in the same group.
- **The failure notes are heard on both platforms.** `accessibilityLiveRegion="polite"` makes
  TalkBack read a note when it appears, but it is Android only: VoiceOver ignores it. So on iOS each
  note is also announced once through accessibility-as-code's `useAnnounce`
  (`src/ui/a11y/use-announce`), which speaks only while a screen reader runs
  (`examples/settings-screen.tsx`, `FailureNote`). Only on iOS (`Platform.OS === 'ios'`): TalkBack
  speaks announcements as well, so an Android note would be read twice, and use-announce itself says
  to prefer the live region for status text. The effect lists `announce` as a dependency; it stays
  stable because React Compiler (on in the canonical stack) memoizes it, so a note is announced once
  per new text.
- Rows that do not apply are absent from `groups`, so the view never decides visibility. A long list
  is a `SectionList` (or `FlatList`); the settings list is short and bounded, so a `ScrollView` is
  fine too.

## Switch rows

- **The whole row is the switch**: `accessibilityRole="switch"`, `accessibilityState={{ checked }}`,
  the label is the accessible name, a description is the hint. The track graphic is decorative, not a
  second target. VoiceOver says "Haptics, switch button, on"; TalkBack says "On, Haptics, switch".
- A tap calls the row's handler once (`onToggleSound`, `onToggleHaptics`, `onToggleReduceMotion`),
  which dispatches one action and then runs `onToggled`: the model input that plays
  audio-and-haptics-feedback's toggle moment, `() => { playUiFeedback(services, 'toggle'); }`
  (`examples/use-settings-input.ts` wires it). Never `usePressFeedback()`: the press feedback is a
  no-op unless the app opted into tap sounds, and with the opt-in it plays `tap`, not `toggle`. The
  row component plays no tap feedback of its own for a switch, so a flip sounds once; and because the
  ports read the settings at call time, turning sound off is already silent.
- **Reduce motion shows the resolved value**: the explicit choice, or the phone's switch while the
  setting is `'system'` (`useReduceMotion()`). A tap writes the opposite explicitly (`'on'`/`'off'`);
  "Reset settings" brings back `'system'`.
- Sound off does not hide the volume row; the slider is drawn in its off state and still adjustable.
- **Switches whose truth lives elsewhere.** Some rows on the settings screen are not settings fields,
  because another skill owns the state and its writer:
  - *Reminders* (local-notifications): the switch deactivates or reactivates the reminder rows, then
    calls `reminderSync.request()` after the commit; it never cancels notifications itself (only the
    reminder sync writes to the OS).
  - *Sync in the background* (background-tasks): a settings field that feeds
    `reconcileBackgroundTasks`' `isEnabled`; while the port reports `restricted` (iOS simulator, Expo
    Go, Background App Refresh off) the row reads "not available on this device" instead of a switch
    that does nothing.
  - *Share usage data* (analytics-and-consent, `settings.usage-data.label`): calls
    `analytics.setConsent`; the answer is that skill's versioned consent record (choice, question
    version, time), never a field of this schema.

## Segmented rows (Numbers, Theme)

- The label on its own line, the control on a full-width line under it (it fits at 200 % text).
- The control is a radio group: `accessibilityRole="radiogroup"` on the control, each segment
  `accessibilityRole="radio"` with `accessibilityState={{ selected }}`; testIDs
  `settings.theme-segment.<system|light|dark>`, `settings.numbers-segment.<automatic|latin|local>`.
- Exactly one segment is selected, marked by more than colour (a check mark or weight).
- A tap dispatches `set-theme` / `set-digits`; the current segment again changes nothing (the reducer
  returns the same object, so nothing is written).
- Numbers previews, when shown, are formatted with the app's number formatter for each digit style,
  never typed into a catalog.

## The volume slider

- `accessibilityRole="adjustable"`, `accessibilityValue={{ min: 0, max: 100, now: volume, text:
  volumeText }}`, and increment/decrement accessibility actions in steps of 10.
- **The pitfall:** most slider components work in 0..1 and call `onChange` on every drag step, while
  the store keeps integer percent. Pass `value={volume / 100}` and let `onChangeSoundVolume(rate)`
  round to a whole percent and dispatch only when it differs from the saved one: at most one write per
  percent. Passing the percent straight in pins the thumb at the end and saves fractions.
- The slider plays no feedback while dragging. It mirrors in right-to-left layouts (fill from the
  start edge).

## Chevron rows and danger rows

- `accessibilityRole="button"`; the label is the name and the value (the Language row's
  "System (English)") is read after it. The chevron mirrors in right-to-left layouts.
- Language → the language list; Get Premium → the paywall (in-app-purchases); Restore purchases →
  the purchase port's restore, with the result announced; Privacy choices → the consent form
  (admob-ads-and-consent); Privacy policy → `privacyPolicyUrl(PRIVACY_POLICY_PAGE)` through
  `Linking.openURL` (always visible: App Store Review Guideline 5.1.1(i) and Google Play's User Data
  policy both require the link inside the app, not only in the listing); Rate the app → `storeReviewUrl(Platform.OS, ids)`
  through `Linking.openURL`; Contact support → `supportMailUrl(email, versionText)`; About → the about
  route, which also lists the open-source licences (a licences sub-route). A failed hand-off (no mail
  app, a `null` URL) is recorded and shown as a short message, never a crash.
- **Danger rows** (Reset settings, Delete all data) have the danger tone and open a confirmation
  dialog; they never act on the first tap.

## The account group

- Shown only while someone is signed in (`context.isSignedIn`; an app without accounts passes
  `false`, so the group never appears): **Sign out** (`settings.sign-out-row`, label
  `settings.sign-out.label`) and **Delete account** (`settings.delete-account-row`, label
  `settings.delete-account.label`, the danger tone), under the title `settings.group.account`
  (`settings.group.account` group testID).
- Both hand off to auth-and-secure-storage, which owns the session, the token wipe and the
  account-deletion flow with its own confirmation and copy. Apple requires in-app account deletion
  wherever the app lets people create an account (App Store Review Guideline 5.1.1(v)), and Google
  Play requires a deletion path in the app and on the web; the row is this screen's part of that.
- Signing out never resets the device settings: theme, language and sound belong to the device,
  not the account. Preferences the server keeps per account are listed in the contract's
  `accountPreferences` and live in server state, not in the settings store.

## The language list and the restart dialog

- One list: "System (العربية)" first (`settings.language.system` with the autonym of the language the
  phone resolves to), then one row per app language with its autonym (`LANGUAGE_AUTONYMS`, never
  translated, each rendered in its own script and direction), each with a radio mark.
  testIDs `settings-language.language-row.<system|en|ar>`.
- A row runs `onSelectLanguage(next)`: the choice is saved and the text switches at once. When
  `planLanguageChange` says `isRestartNeeded` (the new language reads the other way) **and the choice
  was saved**, the model calls `onRestartNeeded`, which opens the restart dialog. After a failed
  write the store publishes nothing and the save-failed note shows; a restart then would come back in
  the old language, so no dialog opens. **Restart now** hands over to rtl-and-direction's
  direction switch and reload; **Not now** keeps the current layout until the next cold start, which
  applies the saved direction.
- The comparison is with the layout's direction now, not the text's: after "Not now", choosing the
  first language again needs no restart.

## Dialogs

| Dialog | Title / body | Buttons |
|---|---|---|
| Restart to apply | `settings.language.restart.title` / `.body` | Not now (`settings.language.restart.later`) · Restart now (`.confirm`) |
| Reset settings | `settings.reset-settings.confirm-title` / `.confirm-body` | Cancel (`common.cancel`) · Reset (`settings.reset-settings.confirm`, danger) |
| Delete all data | `settings.delete-all-data.confirm-title` / `.confirm-body` | Cancel · Delete (`settings.delete-all-data.confirm`, danger); a failure afterwards shows `settings.delete-all-data.failed` |
| Delete account | auth-and-secure-storage's own dialog and copy | — |

The safe choice sits at the start (it mirrors in right-to-left layouts) and has the initial focus.
Dialogs are the app's own components from `src/ui` (themed, translatable, testable), not `Alert`.

## Copy keys

The templates ship `src/i18n/catalogs/en.json` and `ar.json` with every key below; merge them into
the app's catalogs and translate them for every app language.

| Key | English |
|---|---|
| `settings.title` | Settings |
| `settings.group.account` / `.general` / `.appearance` / `.sound` / `.premium` / `.privacy` / `.data` / `.about` | Account / General / Appearance / Sound and haptics / Premium / Privacy / Data / About |
| `settings.sign-out.label`, `settings.delete-account.label` | Sign out, Delete account |
| `settings.language.label` / `.system` | Language / System ({languageName}) |
| `settings.numbers.label` / `.automatic` / `.latin` / `.local` | Numbers / Automatic / Latin / Local |
| `settings.theme.label` / `.system` / `.light` / `.dark` | Theme / System / Light / Dark |
| `settings.reduce-motion.label` / `.description` | Reduce motion / Fewer moving effects and simpler transitions. |
| `settings.sound.label`, `settings.sound-volume.label` / `.value` | Sound effects, Volume / Volume at {volumeRate, number, ::percent} |
| `settings.haptics.label` | Haptics |
| `settings.premium.get` / `.active` / `.restore` | Get Premium / Premium is active / Restore purchases |
| `settings.privacy-choices.label`, `settings.privacy-policy.label` | Privacy choices, Privacy policy |
| `settings.reset-settings.label` (+ `.confirm-title`, `.confirm-body`, `.confirm`) | Reset settings |
| `settings.delete-all-data.label` (+ `.confirm-title`, `.confirm-body`, `.confirm`) | Delete all data |
| `settings.delete-all-data.failed` | Your data could not be deleted. Try again. |
| `settings.rate-app.label`, `settings.contact-support.label`, `settings.about.label` | Rate the app, Contact support, About |
| `settings.save-failed` | That change could not be saved. Try again. |
| `settings.language.restart.title` / `.body` / `.confirm` / `.later` | Restart to apply / … / Restart now / Not now |

`languageName` ends in `Name`, so `t()` isolates it (FSI … PDI): tests compare
`'System (⁨English⁩)'`.

## testIDs and end-to-end flows

- Row testIDs come from `SETTINGS_ROW_TEST_IDS` (`settings.<row>-<role>`: `-row`, `-switch`,
  `-slider`) and group testIDs are `settings.group.<id>`; flows and tests use these literals, never a
  built string (naming-conventions). The notes are `settings.save-failed` and `settings.delete-failed`;
  the dialogs `settings.restart-dialog`, `settings.reset-settings-dialog`,
  `settings.delete-all-data-dialog`.
- The restart check that proves persistence on a device, with named devices only (e2e-maestro owns
  the flows): change the theme, then on iOS `xcrun simctl terminate <udid> <bundle-id>` and
  `xcrun simctl launch <udid> <bundle-id>`; on Android `adb -s <serial> shell am force-stop <package>`
  and `adb -s <serial> shell monkey -p <package> 1`. The first frame must already be dark. As a flow:
  `maestro --device <udid> test .maestro/settings/theme-survives-restart.yaml`, using `stopApp` and
  `launchApp` (without `clearState`) between the change and the assertion.

## Tests to write

- Schema: the pinned first-launch values, an unknown field rejected (`settings-schema.test.ts`).
- Codec: a round-trip property, a frozen sample per shipped shape, a damaged field repaired alone,
  text that is not an object (`settings-codec.test.ts`).
- Reducer: one example per action, the same object for a no-op, a clamp property over any number
  (`settings-reducer.test.ts`, which runs every row of `settings-reducer-cases.ts`; add a case there
  for a new action).
- Store: persist before publish (a subscriber sees the saved text), nothing written for a no-op, a
  failed write publishes nothing, unreadable storage writes nothing, repaired fields recorded
  (`settings-store.test.ts`).
- Rows: every visibility rule (the account group only while signed in), testIDs and labels for every
  row (`settings-rows.test.ts`).
- Data resets: the data gone and every store re-read, every setting and the saved text untouched, a
  failed reset returned with nothing re-read or refetched (`data-resets.test.ts`).
- Links: the privacy page is a public https page (fails while the placeholder is left in), the
  review page per platform, the support mail (`external-links.test.ts`).
- Handlers: one action per handler, feedback after switches only, the slider's whole-percent rule,
  reduce motion writes the opposite (`settings-preference-actions.test.ts`).
- Model: labels, the language value, the restart callback (and none after a failed save), the
  save-failed and delete-failed texts (`use-settings-model.test.tsx`).
- Effects: every provider follows the store (`preferences-root.test.tsx`), sound applied at once and
  after changes (`connect-sound-settings.test.ts`), the haptics gate (`haptics-gate.test.ts`).
- Language plan: direction flip, same direction, System, after "Not now" (`language-change.test.ts`).
- Screen (with the view): every visible row's testID renders and a switch press changes the store,
  queried by role and name, ending with the accessibility audit (accessibility-as-code).

## Appendix: React Navigation 7 (static API)

An app on React Navigation instead of Expo Router registers the same feature screen in its static
config; everything else in this skill is unchanged:

```tsx
// src/navigation/root-navigator.tsx (excerpt)
const RootStack = createNativeStackNavigator({
  screens: {
    Tasks: { screen: TasksRoute },
    Settings: { screen: SettingsRoute },
    SettingsLanguage: { screen: SettingsLanguageRoute },
  },
});
```

Titles come from `t('settings.title')` in a component under the providers that sets
`navigation.setOptions` (React Navigation reads no catalog key itself), and `navigation.navigate('SettingsLanguage')` replaces `router.push('/settings/language')`.
