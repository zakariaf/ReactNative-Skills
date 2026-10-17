# State, persistence, navigation, async and dates

Failures with stores, validation, SQLite persistence, navigation, cancellation and day maths. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npm ls zustand expo-sqlite expo-router valibot`.

<!-- Generated from assets/known-failures/state.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Stores
- Validation
- Persistence
- Navigation
- Async
- Dates

## Stores

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `state-zustand-new-object` | Maximum update depth exceeded after reading a store | A Zustand 5 selector returned a new object or array on every call | Return primitives or stable references, or wrap the selector in useShallow from zustand/shallow | verified |  | `state-management-zustand` |
| `state-stale-stores-after-write` | Screens show old values until the app restarts after a background write | The write went straight to storage, so the stores that mirror it never re-read | Write through the store action (or publish the change to the stores in the same step); never write storage behind a store | verified |  | `state-management-zustand` |

## Validation

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `state-zod-jit` | A zod 4 schema crashes or refuses to run in a Hermes release build | zod 4's JIT compiles validators with new Function, which Hermes does not support | Use valibot (the stack default); with zod 4 set jitless mode before any schema runs | documented (zod >=4) |  | `networking-and-server-state` |

## Persistence

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `state-newer-db-crash` | The app crashes at launch after installing an older build over a newer one (the database comes from a newer app) | The open path threw when PRAGMA user_version was newer than the app knows, so every launch crashed before the first frame | Return a 'newer version' outcome from the open path, run read-only or in memory, and show "please update"; never throw while opening | verified |  | `persistence-and-migrations` |
| `state-db-not-a-database` | The app crashes at launch with "file is not a database" | The database file itself is not an SQLite file (never seen with WAL and synchronous FULL) | Handle it as an open outcome: move the file aside as a support copy and start fresh, with the developer's approval of the copy and the message | open |  | `persistence-and-migrations` |
| `state-wal-checkpoint` | A device backup restores older data | Recent writes sit in the -wal file | Run PRAGMA wal_checkpoint(TRUNCATE) when the app goes to the background (the -wal file drops to 0 bytes) | verified |  | `persistence-and-migrations` |
| `state-save-payload-size` | Writes get slow as a JSON document grows | The whole document is written on every save | Keep a write-speed test; past about 200 KB move the busy part into its own table or row (the SQLite default avoids this) | documented |  | `persistence-and-migrations` |

## Navigation

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `state-prevent-remove-limits` | Work is lost although Back opens a confirmation | usePreventRemove does not catch app close, an OS kill, or a screen unmounted by a guard flip | Save as the user goes; the Back confirmation is UX only | verified |  | `navigation-and-routing` |
| `state-nav-direction-source` | The navigator direction disagrees with the layout for one launch | The direction was derived from the language setting, not I18nManager | Derive navigation direction from I18nManager's current constants | verified |  | `rtl-and-direction` |
| `state-rtl-push-direction` | Push animations slide the wrong way in RTL with headerShown false | Not checked on a device | Check push and back animations in RTL on both platforms before shipping RTL | open |  | `navigation-and-routing` |
| `state-reduce-motion-fade` | Reduce Motion is on, but screens still slide | The stack always uses the platform push animation | Set animation: 'fade' (or 'none') from the reduce-motion setting in the screen options | open |  | `motion-and-animation` |
| `state-stack-screen-stays-mounted` | A polling or timer screen keeps working when another screen covers it | Stack screens stay mounted under the screen on top | Start and stop the work with useFocusEffect (and pause on background) | documented |  | `async-safety` |

## Async

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `state-abort-polyfill-missing-api` | signal.throwIfAborted is not a function, or signal.reason is undefined, on the device while Jest passes | React Native 0.86 polyfills AbortController with abort-controller 3.0.0, which lacks throwIfAborted and reason; Jest runs Node's full implementation | Check signal.aborted and throw your own abort error; never call throwIfAborted or read signal.reason in app code | documented (react-native 0.86.x) |  | `async-safety` |
| `state-abort-error-name` | An abort is shown as an error on the device although the code checks error.name === 'AbortError' | expo/fetch rejects an aborted request with a FetchError, not an AbortError | Decide by signal.aborted, not by the error name | documented |  | `async-safety` |
| `state-listener-signal-option` | A listener registered with { signal } keeps firing after the abort on the device | React Native's event-target-shim 5 ignores the signal option of addEventListener | Remove listeners explicitly in the cleanup (keep the remove function or subscription) | documented |  | `async-safety` |

## Dates

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `state-countdown-utc` | "Next in {h} h {m} min" is hours off (it counts to UTC midnight) | It was computed from Date.now() % 86_400_000, which is UTC midnight, not local | Ask the clock port for the time until the next local day (DST-safe); keep day maths out of screens | verified |  | `dates-streaks-and-statistics` |
| `state-week-strip-by-weekday` | A seven-day strip cannot find today's cell by its testID | The cells were numbered by ISO weekday instead of position | Number by position (1 = six days ago, 7 = today); the weekday only picks the label | verified |  | `dates-streaks-and-statistics` |
| `state-clock-member-missing` | TS2741: Property '<member>' is missing in type ... but required in type 'ClockPort' | A hand-written clock object from before the port gained that member | Use the fake clock from the clock service in tests; code that only reads the time takes Pick<ClockPort, ...> | verified |  | `architecture-and-boundaries` |
| `state-signoff-date-utc` | A tool writes yesterday's date into a ledger or report shortly after local midnight | It took the UTC calendar day | Write the local calendar day (the date-key helper), and let a --date option override it | verified |  | `dates-streaks-and-statistics` |
