# The silent async failure catalogue

A closed list of the ways async code in an Expo app fails without a sound, each with its guard and
where it is proven: **C** this skill's checker, **L** ESLint/tsc (typescript-and-lint-rules), **J** a
Jest race test (test-recipes.md), **D** only on a device (an E2E flow or a manual check), **N** the
global error net catches it after the fact (error-handling-typed-results). When you find an n+1th way
to fail silently, add it here, with its guard.

| # | Failure | Platform | Guard | Proven by |
|---|---|---|---|---|
| 1 | A floating promise rejects | both | await / return / `.catch(reportError)` | L, N |
| 2 | An async handler inline in `onPress` rejects | both | synchronous handler with a block body | L |
| 3 | A promise-returning function passed by reference to a prop typed `unknown` rejects | both | wrapper or void intent | C (`async-by-reference`) |
| 4 | A component's callback type returns `Promise`/`unknown`, so callers pass async functions silently | both | `=> void` | C (`void-callback-type`), then L |
| 5 | An older response overwrites a newer one | both | one controller per effect run; `createLatestRequest` | C (`effect-stale-result`), J |
| 6 | A response writes, navigates or toasts after the user left | both | `signal.aborted` before every write | C, J |
| 7 | A subscription arrives after the effect cleaned up and is never removed | both | `isActive` + remove on arrival | C, J |
| 8 | The first read of an outside value overwrites a newer change event | both | subscribe first; an event cancels the read | J |
| 9 | A cancelled request is shown or recorded as an error | both | decide by `signal.aborted`; `cancelled` kind | C (`abort-signal`), J |
| 10 | `throwIfAborted`, `signal.reason`, `AbortSignal.abort()` or `{ signal }` listeners work in Jest and not on the phone | both (device only) | device-safe API subset | C (`abort-signal`), D |
| 11 | Cancellation decided by `error.name === 'AbortError'` misses expo/fetch's `FetchError` | both (device only) | ask the signal | C, D |
| 12 | A listener handle is dropped or never removed; Fast Refresh stacks copies | both | keep and release | C (`subscription-released`), J |
| 13 | A leaked `hardwareBackPress` handler swallows every later back press | Android | release in cleanup | C, D |
| 14 | `Keyboard.removeAllListeners` removes a library's listeners | both | remove only your own | C |
| 15 | A timer fires after its owner is gone, or an interval never stops | both | keep the id, clear it | C (`timer-cleared`), J |
| 16 | An uncancellable sleep keeps a retry loop acting after the screen left | both | `delayOrAbort(ms, signal)` | C, J |
| 17 | A covered screen keeps polling, tracking location or reading sensors | both | `useFocusEffect` | C (`focus-scoped-work`), J (router test) |
| 18 | An interval keeps running in the background | Android (iOS suspends) | pause while not active (`useIsAppActive`) | J (injected flag), D |
| 19 | Overdue timers all fire at once when the app returns | iOS mostly | compute elapsed time from the clock | J (fake clock), D |
| 20 | A request hangs and the spinner stays forever | both | `withTimeout` with a deadline | J |
| 21 | A timed-out request keeps running and writes later | both | `withTimeout` aborts the task's signal | J |
| 22 | A retry loop without a bound or a delay spins | both | fixed backoff table, retryable kinds only | J |
| 23 | A write is aborted to make room for a newer one and still lands | both | never cancel writes; one in flight | J, review |
| 24 | A double tap submits twice | both | `isSaving` disables the action | J |
| 25 | `await save(); router.back()` pops the wrong screen | both | navigate first, or only while focused | J (router test) |
| 26 | Work assumed to finish in a `finally` or on unmount when the OS kills the app | both | persist at the moment of change | D (kill test, persistence-and-migrations) |
| 27 | An unhandled rejection in a release build leaves no trace at all | both | the error net tracks rejections in every build | N (error-handling-typed-results) |

Rows marked D are the reason a green Jest run is not the whole proof: run the affected flow on an iOS
simulator and an Android emulator (e2e-maestro) before calling an async change done.
