# kind values, testIDs and message keys

The three string grammars that stored data, E2E flows and translations depend on: the `kind`/`type`
discriminants of data unions and actions, the `testID` of every element a flow touches, and the
semantic keys of the message catalogs. Read this before adding a command, event, action, testID,
catalog key or placeholder.

## Contents

- kind and type values
- Rules that follow from the grammar
- testIDs
- testIDs on iOS and Android
- Maestro selectors
- Message keys
- Placeholders

## kind and type values

Every data union uses a `kind` discriminant, and every reducer action a `type` discriminant, whose
value is a kebab-case string literal (`[a-z0-9-]` only; `kind-value`). The grammar tells which union a
value belongs to:

| Union | Grammar of `kind` | Examples |
|---|---|---|
| `...Command` (a request: input to a reducer, a sync step, an engine) | imperative verb or verb-noun | `'create-task'`, `'complete-task'`, `'move-task'`, `'schedule-reminder'` |
| `...Event` (a fact: what happened) | past tense, noun first | `'task-created'`, `'task-completed'`, `'reminder-scheduled'`, `'list-archived'` |
| `...Error` (inside a `Result`) | what went wrong, a noun phrase | `'stale-revision'`, `'list-not-found'`, `'quota-exceeded'`, `'network-unavailable'` |
| `...Result` / outcome | a state word | `'applied'`, `'rejected'`, `'pending'` |
| UI intent (from a gesture hook) | gesture noun | `'tap'`, `'long-press'`, `'swipe'` |
| Animation track (a timeline built from events; games plugin) | visual primitive noun | `'tween'`, `'burst'`, `'shake'`, `'flash'` |
| Reducer action (`type`, not `kind`) | imperative request | `'set-filter'`, `'toggle-editing'`, `'reset-selection'` |

`examples/task-sync-types.ts` shows the whole grammar on a sync log (commands, events, errors and the
result union); `examples/lights-out-types.ts` shows it on a public-domain puzzle for the games plugin
(move `'toggle-cell'`, events `'cells-toggled'`, `'board-cleared'`).

## Rules that follow from the grammar

- One event per thing that happened; the name says what happened, not what to show
  (`'task-completed'`, never `'show-completed-toast'`). Sounds, haptics, analytics and UI feedback map
  from events.
- `kind` values, analytics event names and counter ids that are stored (the local outbox, exported
  backups, server payloads, analytics dashboards) are a data format. Renaming one needs a data
  migration (persistence-and-migrations) or a server change, never a quiet refactor.
- Analytics event names, cue ids and statistic ids are kebab-case nouns or past-tense phrases,
  unique and stable forever (`'task-completed'`, `'streak-days'`).
- `left`/`right`/`up`/`down` are fine as data (a swipe direction); the physical-direction ban applies
  only to style objects (rtl-and-direction).
- Tooling and Node-side config are exempt from the kebab rule, because they talk to external formats
  (App Store Connect uses camelCase resource `type` values; Gradle and EAS have their own keys).
- A `type:` that is not a discriminant follows its own format, and `kind-value` leaves it alone in
  four places:
  - **A MIME type anywhere:** `<type>/<subtype>`, with parameters or a wildcard
    (`new Blob([csv], { type: 'text/csv;charset=utf-8' })`, `image/svg+xml`, `image/*`, `*/*`; the
    pattern is `assets/naming-rules.json` `mimeType`).
  - **Every `type:` option inside a `<library>-<concern>-adapter.ts`**, the one file that speaks the
    SDK's format. An adapter's own `kind` unions still follow the grammar; keep SDK calls with
    non-MIME option values in their adapter, where the exemption lives.
  - **react-hook-form's `setError(name, { type })`:** the form library owns its error types
    (`'maxLength'`, `'required'`). A manual error may also carry a kebab-case type of the app's own
    (`'too-long'`): `ErrorOption.type` accepts any string.
  - **`type:` values in test files:** a test writes either the app's own values, which tsc holds to
    the unions `kind-value` checks where they are declared, or a library's (valibot's issue types
    `'min_length'`, `'non_empty'`). `kind:` values in tests are still checked.

  The canonical ESLint `kindValue` selector skips plain MIME types only; code-identifiers.md shows the
  selector that matches the checker and what to write until the config carries it.

## testIDs

Format: `<scope>.<element>[.<part-or-key>...]`, every segment `[a-z0-9]+(-[a-z0-9]+)*`, at least two
segments. Regex: `^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$`.

- `<scope>` is the screen's route path in kebab-case (`tasks`, `task-details`, `settings-language`), a
  dialog (`delete-task-dialog`), a sheet (`task-editor`) or `debug`.
- `<element>` is a kebab noun. Interactive elements end in their role: `-button`, `-row`, `-switch`,
  `-slider`, `-tab`, `-link`, `-checkbox`, `-radio`, `-input`, `-field`, `-chip`, `-tile`, `-card`
  (`testid-role` checks React Native's pressables and inputs (`Pressable`, `Touchable*`, `Switch`,
  `TextInput`, `Button`) always, and the app's own components whose name ends in a role word, such as
  `AppButton` or `ListRow`, when the tag also gets `onPress`, `onLongPress`, `onValueChange` or
  `onChangeText`; an app adds role words in `contracts/naming.json` `extraTestIdRoles`). Text and
  containers need no suffix (`tasks.title`, `tasks.list`, and a `<SummaryCard testID="tasks.summary">`
  with no handler).
- Repeated items append a stable data key as its own segment, never a list index:
  `tasks.task-row.<task id>`, `settings-language.language-row.ar`. `testid-index` fails any template
  value that reads `i`, `idx`, `index` or a name ending in `Index` (`${String(index + 1)}`,
  `${rowIndex}`); `testid-format` fails a value glued into a segment (`tasks.row-${task.id}`), because
  a flow then cannot match the element by its fixed part.
- Reusable components take a `testID` prop and derive their parts by appending a segment:
  `tasks.add-button` → `tasks.add-button.icon`, written `` `${testID}.icon` `` (a leading `${testID}`
  is the one value that may stand for several segments).
- testIDs are not user-visible and are never translated; they are exempt from the i18n lint rules.
- Canvas content (Skia) has no testIDs; its wrapper does (`tasks.chart`), and flows tap inside it by
  coordinates the app publishes in a test-only text element.
- Only literal testIDs are linted by ESLint. For a dynamic id, write a template literal whose static
  parts already follow the format: `` `tasks.task-row.${task.id}` ``. `check-code-names.mjs` checks
  both forms (`testid-format`).

## testIDs on iOS and Android

Maestro's `id:` selector matches React Native's `testID` on both platforms (Maestro's React Native
documentation), so one flow drives the iOS simulator and the Android emulator.

- A `testID` on a component that renders no native view of its own (a fragment, a custom component
  that does not forward it) reaches neither platform: forward it to the underlying `View`, `Pressable`
  or `Text`.
- An `accessible` parent becomes one accessibility element, and its children's testIDs disappear from
  the hierarchy Maestro reads, so `id:` cannot find them (observed on the iOS simulator; not verified
  on Android here). Make the element under test the accessible one, or select the accessible parent
  and narrow it with `text:` (accessibility-as-code owns the grouping rules).
- Android TalkBack and iOS VoiceOver read `accessibilityLabel`, never the testID: an element needs
  both, the label from the catalog and the testID from this grammar.

## Maestro selectors

Flows select by `id:` only, so they run unchanged in every locale (`maestro-selector`):

```yaml
- tapOn:
    id: 'tasks.add-button'
- assertVisible:
    id: 'tasks.title'
    text: 'Tasks'            # a text matcher may narrow an id selector
- extendedWaitUntil:
    visible:
      id: 'task-details.title'
    timeout: 10000
```

- Maestro treats the value as a regular expression; a `.` also matches itself, so `tasks.add-button`
  works unescaped.
- A shorthand `tapOn: 'Add'`, `assertVisible: 'Add'`, `visible: 'Add'`, or a `text:` selector without an
  `id:`, is a text selector and fails.
- The one exception is OS-owned UI that has no testID: the iOS "Open in <app>?" link alert, the iOS
  permission alerts, Android's runtime permission dialog (`POST_NOTIFICATIONS` on Android 13+, camera,
  location), a test ad. It sits under a `# system-ui: <why>` comment on the line or up to 6 lines above
  (the e2e-maestro skill's flow checker reads the same comment):

  ```yaml
  # system-ui: iOS asks "Open in <app name>?" for the link; the title and 'Open' are Apple's, not app text.
  - runFlow:
      when:
        visible: 'Open in .*\?'
      commands:
        - waitForAnimationToEnd
        # system-ui: Apple's Open button, the nearest one below the alert title.
        - tapOn:
            text: 'Open'
            below: 'Open in .*\?'
            optional: true
  ```

  `below:` is there because a bare `'Open'` is ambiguous: a test ad banner's "OPEN" button (Google's
  test ads in a debug build) also matches it, so the flow could tap the ad instead of the alert.
  Narrowing to the nearest `Open` below Apple's alert title taps only the system button (seen on the
  iOS simulator in the source app this skill was generalized from).

  The checker also accepts a guard whose `when: visible:` text equals the text tapped under
  `commands:` (`visible: 'Allow'` with `tapOn: 'Allow'`), and an OS-dialog line marked
  `- tapOn: 'Allow' # system dialog`; prefer the `# system-ui:` form, which says why.
- An `id:` value must be a valid testID, unless it is a deliberate regex (`'[a-z0-9-]+\.screen'`) or an
  `${ENV}` value such as `'${WAIT_FOR}'`.

## Message keys

Grammar (checked by `check-code-names.mjs` and the i18n-strings-and-catalogs skill's catalog verifier;
the canonical ESLint config enables only `formatjs/no-literal-string-in-jsx`, which finds literal UI
text but does not check key shape):

```
key        = segment "." segment [ "." segment ]{0,3}      2 to 5 segments
segment    = [a-z0-9]+ ( "-" [a-z0-9]+ )*                   lowercase ASCII kebab-case
regex      = ^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){1,4}$
first      = a feature folder (tasks, settings) or a declared area (app, common, crash, date, errors, permissions, reminders)
```

| Catalog | First segment | Examples |
|---|---|---|
| `src/i18n/catalogs/<locale>.json` | a feature folder name under `src/features/`, or one of `contracts/naming.json` `keyAreas` | `tasks.add-button.label`, `task-details.due-date.label`, `settings.sound-switch.label`, `common.cancel`, `errors.sync.stale-revision`, `app.name`, `permissions.camera.usage-description` |
| When multi-package: `packages/<pkg>/src/i18n/catalogs/<locale>.json` | the package folder name | `billing.paywall.title`, `billing.restore-button.label` |

The template's `keyAreas` (`app`, `common`, `crash`, `date`, `errors`, `permissions`, `reminders`)
are the app-wide areas the library's own files use: `app.name` (the display name), `common.*` (shared
words), `date.*` (formatted dates), `errors.*`, `permissions.*` (system-dialog texts) and
`reminders.*` (`reminders.next`, the date-formatting example in `src/i18n/format-date.test.ts`, which
lives in `src/i18n/`, not in a feature folder) from the i18n-strings-and-catalogs catalogs, and
`crash.*` from the crash screen error-handling-typed-results ships in `src/features/crash-recovery/`
(the root error boundary shows it for any route, so it is an area, not one feature's keys). An app
adds its own areas in the contract and drops the ones it does not use; a feature folder needs no
entry (an app with `src/features/reminders/` covers `reminders.*` by the folder alone).

- **Semantic, not textual.** `tasks.add-button.label` holds "Add task". If the wording changes, the key
  stays. Never put the English words into the key (`tasks.add-a-new-task`).
- **The last segment names the role** when an element has several texts: `.title`, `.body`, `.label`,
  `.a11y-label`, `.a11y-hint`, `.placeholder`. A text the OS shows in a system dialog (an iOS
  Info.plist purpose string, an Android permission rationale) is `permissions.<topic>.usage-description`
  or `permissions.<topic>.rationale` (`permissions.camera.usage-description`, the
  i18n-strings-and-catalogs convention); it is plain text with no placeholders, because the build
  copies it into native resources where nothing formats ICU.
- **One sentence, one key.** Plurals and selects live inside the message
  (`{taskCount, plural, one {# task} other {# tasks}}`); never `...tasks-one` / `...tasks-other` keys.
  Arabic needs all six plural categories (`zero`, `one`, `two`, `few`, `many`, `other`): the message
  carries them, the key does not change.
- **Keys are string literals at the call site** (`t('tasks.add-button.label')`, `<T id="tasks.title" />`,
  `intl.formatMessage({ id: 'tasks.title' })`, react-intl's `defineMessage({ id: 'tasks.title' })` and
  `defineMessages({ title: { id: 'tasks.title' } })`; the checker reads all of them) or come from a
  typed table of literals (`PRIORITY_LABEL_KEYS[priority]`), never from string building (`` t(`tasks.priority.${priority}`) ``
  fails `i18n-key-built`). Extraction tools and the typed message-key union can only check keys they
  can see.
- **Namespaced.** With `contracts/naming.json` `keyAreas`, every key starts with a feature folder or a
  declared area (`i18n-key-namespace`); a new area is one line in the contract, which keeps the list
  of top-level namespaces a reviewed decision.
- **When multi-package: a package's keys belong to the package.** App code never names one at a call
  site (`t('billing.paywall.title')` in `src/features/` fails `i18n-key-namespace`): the package exports
  the component or function that shows its own texts, so renaming a key inside the package cannot
  break the app without a type error.
- Catalog files are flat JSON objects (key → ICU message), keys sorted, one file per locale. The
  i18n-strings-and-catalogs skill owns the catalog format, ICU rules, polyfills and the translation
  workflow.

## Placeholders

Placeholders are camelCase and name the value; they mirror the object passed to `t()`
(`i18n-placeholder`):

| Value | Form | Example |
|---|---|---|
| A number | `{name, number}` | `{count, number} open` |
| A counted noun | `{nameCount, plural, ...}` | `{taskCount, plural, one {# task} other {# tasks}}` |
| A choice | `{name, select, ...}` | `{priority, select, high {Urgent} other {Normal}}` |
| A date or time | `{name, date, ...}` / `{name, time, ...}` | `Due {dueDate, date, medium}` |
| Free text | plain `{...Name}` or `{...Text}` | `{listName}`, `{dueText}`, `{priceText}` |

Bad: `{0}`, `{list-name}`, `{COUNT}`, and a plain `{count}` for a number (it skips locale digits: a
locale whose default numbering is not Latin shows its own digits only through `number`, for example
`ar-EG` shows ٣ and `fa` shows ۳ for 3). Verified on 2026-10-03 with Node 26.4's ICU 78.3 (CLDR 48):
`new Intl.NumberFormat('ar-EG').format(3)` is `٣`, `fa` gives `۳`, and bare `ar` gives `3` (Latin
digits are now its default). Not checked on Hermes on iOS or Android, whose Intl data may differ.
Re-verify: `node -e "console.log(new Intl.NumberFormat('ar-EG').format(3))"`.
