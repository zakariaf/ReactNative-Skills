# Code policies: comments, errors, async, immutability, injection, imports

How code is written inside the limits: what a comment says, how expected failures travel, how promises
are handled, why data is immutable, how dependencies arrive, and how imports are spelled. Read the
matching section when writing error handling, async code, a service or a new module. Where another
skill owns the full design, the section says which.

## Contents

- Comments and TSDoc
- Error handling
- Async code
- Immutability and purity
- Dependency injection
- Imports

## Comments and TSDoc

- Every exported function or class in `src/core/` and every exported `*Port` type has a one-sentence
  TSDoc summary (`/** ... */`) right above it that states the contract, the unit or the reason, not a
  paraphrase of the code: `/** Returns the next uint32 and the advanced state; never mutates its input. */`.
  `check-source.mjs` enforces it (`tsdoc-contract`); the files it covers can be changed with
  `rn-skills.config.json` `"tsdocGlobs"`.
- Elsewhere, add a summary to exported stores, reducers, hooks and services whenever the name cannot
  carry the contract; the agent reads summaries before bodies.
- Add `@param`/`@returns` only when a name cannot carry the meaning; never restate the type.
- Inside functions, comment *why*, never *what*; cite the requirement or the issue when a line exists
  because of it.
- English, full sentences, no ASCII art, no author names or dates, no `TODO`/`FIXME`/`HACK`
  (`no-warning-comments`), no commented-out code (`sonarjs/no-commented-code`), no `eslint-disable`
  (inert and reported).
- Line 1 of every file names its repo path (`// src/features/tasks/task-list.ts: ...`); naming-conventions
  owns that rule.

## Error handling

Decide by asking "can this happen in a correct program?" error-handling-typed-results owns the full
design (the `Result` type in `src/core/result.ts`, failure kinds, mapping at boundaries, user-facing
messages); these are the parts the lint rules and checkers enforce.

| Situation | Mechanism | Example |
|---|---|---|
| Expected failure with reasons | return `Result<TValue, TError>`; `TError` is a `kind` union | a malformed route parameter, a request that timed out, a full disk, a cancelled purchase |
| Expected absence, no reason needed | return `T \| null` | a lookup that finds no task |
| External SDK failure | the adapter catches, maps to a `Result` or a typed state, and records unexpected ones through the error-reporting port | a known error code is expected (silent); an unknown one is recorded |
| Broken invariant, contract misuse, impossible state | `throw new Error(message, { cause })` | a hook used outside its provider; a config value outside its union |
| Render error | the error boundary records it and shows a recovery screen | never a crash loop |
| Error inside a worklet or UI-thread callback | `try`/`catch` inside the worklet, then `scheduleOnRN(record, ...)` hands it to the error-reporting port on the JS thread | a gesture or frame callback throwing (a `try`/`catch` on the JS thread cannot see an error thrown on the UI thread) |
| Anything uncaught | the global handler and the unhandled-rejection tracker record it | a last resort, not a strategy |

The type system then forces every caller to handle every expected case (`switch-exhaustiveness-check`
over the `kind` union). A parser of outside input returns a `Result` instead of throwing:
`examples/parse-task-id-param.ts` and its test.

The error-reporting port (`src/services/error-log/error-log-port.ts`, owned by
architecture-and-boundaries) has `record(source, error)`, which never throws and never rejects, so it
is safe inside any `catch`. `ErrorSource` values are kebab-case and stable.

Rules for `catch`:

- `catch (error)` is `unknown`; narrow with `error instanceof Error` before reading `.message`.
- Every `catch` and `.catch(...)` maps the error to a `Result` or typed state, records it through the
  error-reporting port and continues with a defined fallback, or rethrows with context:
  `throw new Error('tasks migration v3 to v4 failed', { cause: error })`. Empty catch blocks are errors.
- Only throw `Error` objects (`only-throw-error`); reject promises with `Error` objects
  (`prefer-promise-reject-errors`).
- A best-effort cosmetic effect may ignore its own failure inside its adapter (a haptic tap:
  `.catch(() => undefined)`); prefer recording the first failure per session. Nowhere else.
- User-facing error text is a translated message chosen from the failure `kind`, never
  `error.message`.

## Async code

- **No floating promises.** Await it, return it, or end it with `.catch(reportError)`; `void promise`
  does not count (`ignoreVoid: false`).
- **Synchronous handlers.** A function named `handleX`, or an inline function passed to an `on*` prop,
  is never `async` and has a block body that returns nothing (`handlerBody`, `handler-body`): an
  expression body hands the promise of `onPress={() => Linking.openURL(url)}` to a prop typed as
  returning `unknown`, while a statement in a block body is checked by `no-floating-promises`.
  Fire-and-forget work ends in `.catch(reportError)`, where `reportError` comes from
  `useReportError(source)` (`examples/use-report-error.ts`, used by
  `examples/use-task-editor-model.ts`). React Native's Strict TypeScript API types `onPress` as
  returning `unknown`, so `no-misused-promises` cannot see an async handler; the `asyncHandler`
  selector and `check-source.mjs` (`sync-handler`) can. A promise-returning function passed by
  reference (`onPress={retry}`) passes every lint rule: wrap it in a synchronous handler.
  async-safety's checker reports it (rule `async-by-reference`).
- **Forms.** react-hook-form's `handleSubmit(onValid)` returns a promise and rethrows what `onValid`
  throws, so it is never passed straight to an `on*` prop (`onPress={handleSubmit(onValid)}` fails
  `asyncHandler` and `sync-handler`). Call it inside a synchronous handler and end it with the
  rejection handler: `onPress={() => { handleSubmit(onValid)().catch(reportError); }}`; expected
  failures inside `onValid` still travel as `Result` values.
- **Timeouts belong to adapters.** Every await on an SDK or a request that can hang is wrapped, and a
  timeout is an expected failure, not an exception. The helper is async-safety's
  `src/services/async/with-timeout.ts` (`examples/with-timeout.ts` is a synced copy):
  `withTimeout((signal) => attemptAsync(() => sdk.fetch({ signal }), toFailure), 8_000, outerSignal)`
  returns `Result<T, E | TimedOut | Cancelled>` and aborts the task it gives up on. async-safety owns
  the rules for deadlines, cancellation and stale responses. TanStack Query owns retries and
  cancellation for server state (networking-and-server-state).
- No `async` Promise executors (`no-async-promise-executor`); no `new Promise` around code that is
  already async.
- Run independent awaits together (`Promise.all`); await sequentially only when order matters
  (migrations v1 → v2 → v3).
- No promises, `await` or `setTimeout` in worklets; the UI thread talks to JS through `scheduleOnRN`.
- `setTimeout` always gets an explicit delay, and every timer is cleared (in `finally` or an effect
  cleanup).
- Time comes from `ClockPort` (or the frame timestamp on the UI thread), never from `Date.now()`,
  `new Date()` or `performance.now()`; `new Date(epochMs)` only converts an instant you were given.

## Immutability and purity

- Types: `readonly` on every property, `readonly T[]` for arrays, `Readonly<Record<...>>` for maps.
  Constant tables: `as const` (with `satisfies` when a type must be checked).
- Updates: spread into a new object (`{ ...state, filter: action.filter }`), `map`/`filter` into new
  arrays. Never mutate a parameter (`no-param-reassign` with `props: true`); `const` unless reassigned
  (`prefer-const`); class fields `readonly` where possible (`prefer-readonly`).
- Sort without mutating: `[...tasks].sort(compare)` (or `toSorted` once every target supports it).
- State that is persisted, exported or replayed is JSON-serialisable: no `Map`, `Set`, class
  instances, functions or `undefined` values in it.
- The one exception is the games plugin's real-time loop (`src/games/*/sim/**`), which mutates typed
  arrays inside Reanimated shared values in place to avoid per-frame allocation; the config relaxes
  `no-param-reassign` only there.
- Purity (`src/core`, game rules): output depends only on inputs; randomness comes from a seeded RNG
  state passed in; time arrives as a parameter (`nowMs`, a `DateKey`). No React, React Native, Expo,
  Skia or app-layer imports (block 5a).

## Dependency injection

- The composition root creates each adapter once and provides the set to the app (architecture-and-boundaries
  owns where it lives and how tests swap it). React Context is used for dependency injection only
  (services, theme), never for app state.
- A feature's model hook (`use-<feature>-model.ts`) reads services with `useServices()`; stores and
  services receive ports as factory arguments (`createTasksService({ storage, clock })`); pure
  functions receive plain values (`nowMs: number`, `seed: number`).
- Tests render with fakes through `renderWithProviders` (unit-and-component-tests), passing only the
  ports a test needs, so no test needs `jest.mock` for the app's own modules. Root `__mocks__/` exist
  only for native SDKs that crash when imported in Jest.
- No service locators, no mutable module-level registries, no adapter imported from a screen or a
  store, no module-level singleton that touches native code (except inside an adapter).

## Imports

| Import | Form | Example |
|---|---|---|
| Same folder | `./file` | `import { sortTasks } from './task-list';` |
| Sub-folder of the current folder | `./folder/file` | `import { TaskRow } from './components/task-row';` |
| Any other folder in `src/` | the `@/` alias | `import { AppText } from '@/ui/app-text';` |
| A root test helper (tests only) | the `@test/` alias | `import { renderWithProviders } from '@test/render-with-providers';` |
| npm package | bare name, public entry only | `import { create } from 'zustand';` |
| Types | a separate `import type` | `import type { Task } from './task-list';` |
| JSON data | a default import of the file | `import en from './catalogs/en.json';` |
| Node-run code (`app.config.ts`, `plugins/`, `scripts/`) | relative with the extension; `../` allowed | `import { formatLine } from '../format/format-line.ts';` |

- No barrel files and no re-exports for convenience; import the file that defines the symbol.
- Which folder may import which (routes are leaves, `src/core` is the bottom layer, `src/ui` is
  presentational) is the zone rule; architecture-and-boundaries owns it.
- When multi-package: workspace packages expose `"exports": { "./*": "./src/*" }`, and every import
  writes its extension (`@acme/ui/button.tsx`); references/tsconfig-set.md explains why.
