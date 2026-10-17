# check-async-safety: rules, configuration and limits

`scripts/check-async-safety.mjs` is a zero-dependency Node scan of the app's TypeScript sources (comments
and string contents blanked first). It catches what a reviewer would otherwise check by eye and what
ESLint and `tsc` cannot see; it is heuristic, not a type checker. Run it from the app repo root:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-async-safety.mjs .
```

Exit 0 pass (NOT APPLICABLE included), 1 problems, 2 bad input. Each problem line is
`FAIL <file>:<line> [<rule>] <message> Fix: <fix>`; the last line is `RESULT: PASS` or
`RESULT: FAIL (<n> problems)`.

## Contents

1. What is scanned
2. Rules
3. Configuration
4. NOT APPLICABLE, notes and errors
5. Known limits
6. When a finding is wrong
7. Overlap with other skills
8. Verification record

## 1. What is scanned

Every `.ts`/`.tsx` file under the source folder (`src`, from check-lib's `resolveLayout`, or
`--src-dir`), found with the repo walk that skips `node_modules`, generated native folders, build
output, agent skill folders (`.agents/`, `.claude/`, `skills/`, ...) and any folder holding a
`SKILL.md`. `.d.ts` files are left out. Test files (`*.test.ts(x)`, `*.spec.*`, `__tests__/`,
`__mocks__/`, the root `test/`) are counted but never judged: tests may do what app code must not.

## 2. Rules

| Rule | Fails when | Fix |
|---|---|---|
| `async-by-reference` | a promise-returning function goes by reference into a JSX `on*` prop (`onPress={retry}`), an `on*` object property (`{ onSync: sync }`, `{ onArchive }`), or the last argument of `addEventListener`/`addListener`/`add*Listener`/`subscribe`. Promise-returning: an `async` function or one annotated `Promise<...>`/`PromiseLike<...>` in the same file; a member (`model.reload`) whose type returns `Promise<...>` everywhere a member of that name is declared in the app; a name ending in `Async`; `Linking.openURL`, `Linking.openSettings`, `Share.share`, `StoreReview.requestReview`; any name in `asyncSafety.promiseFunctions` | `onPress={() => { retry().catch(reportError); }}`, or a void intent from the model |
| `void-callback-type` | an `on*` or `handle*` member typed `(...) => Promise<...>`, `PromiseLike<...>` or `unknown`. The rule reads type annotations only: the return must read as a type (`Promise<`, `PromiseLike<`, `unknown` not followed by `.` or `(`), so an implementation that returns a promise on purpose, `onSuccess: () => Promise.all([...])` in `useMutation` or `handleNotification: () => Promise.resolve({...})`, is not read | type it `(...) => void`; `no-misused-promises` then rejects a promise passed into it |
| `effect-stale-result` | a `useEffect`/`useLayoutEffect`/`useFocusEffect` with a block body whose code before its cleanup (the last top-level `return <expr>`; a bare guard-clause `return;` such as `if (id === null) return;` is skipped, not read as the cleanup) has an async continuation (`await`, `.then`/`.catch`/`.finally`, or a call to a same-file async function that sets state) and writes (a `useState`/`useReducer` setter of the file, `.setState(`, `router.`/`navigation.` navigation, or that async function; same-file async functions include `const load = useCallback(async () => ...)`), and whose cleanup neither aborts (`.abort(`, with every `.then`/`.catch`/`.finally` callback that writes and every stretch from one `await` to the next that writes reading `.aborted`, so one check after the first await does not cover a write after the second, and every same-file async function it calls reading `.aborted` too: passing the signal alone is not enough, since a port that resolves a Result or a cached value instead of rejecting still hands the stale answer to the write), nor flips a flag that each of those writing stretches reads, nor calls `.cancel(`/`.invalidate(`; or an effect that awaits a `watch*Async(...)` subscription without such a guard. Also fails, with its own message: a write whose argument awaits (`setTitle(await repo.get(id))`), which no guard can precede; and a cleanup that sets a mounted ref (`isMounted.current = false`) in an effect with dependencies or in `useFocusEffect` (a ref covers unmount only; with `[]` deps it is read like a flag). A cleanup that only returns an identifier (`return unsubscribe;`) is accepted as is. An effect whose only writes go through same-file latest-wins actions (each calls `<holder>.start()`, reads `.aborted`, and the file calls `<holder>.cancel()`, as in effects-and-races.md section 7) needs no cleanup of its own: the next run's `start()` aborts the older call and the unmount effect cancels the last | one `AbortController` per run (effects-and-races.md, section 2), or the `isActive` flag for async acquisition (section 5) |
| `abort-signal` | `signal.throwIfAborted()`; reading `signal.reason` / `<x>Signal.reason`; `AbortSignal.abort()`; `addEventListener(..., { signal })`; `error.name === 'AbortError'` (any comparison operator, either side); `instanceof DOMException` | decide by `signal.aborted`; remove listeners by hand (cancellation-and-deadlines.md) |
| `subscription-released` | the handle of `addEventListener`/`addListener`/`add*Listener`/`subscribe` (member calls) or of a free `add*Listener(...)`/`watch*(...)` call is dropped (a bare statement), or kept in a variable or property path that the file never releases (`.remove()`, `.unsubscribe()`, `.cancel()`, `.stop()`, `.close()`, `.dispose()`, `.release()`, `.disconnect()`, `.off()`), calls, returns or hands over; `Keyboard.removeAllListeners()` / `DeviceEventEmitter.removeAllListeners()`. Accepted for a dropped handle: an EventTarget `addEventListener` with `{ once: true }` or a `removeEventListener` for the same event literal in the file; a receiver the file tears down (`ad.destroy()`, `.dispose()`, `.close()`, `.terminate()`); a reasoned `// app-lifetime:` marker (section 3). `*Async` watchers are left to `effect-stale-result` | keep the handle and release it in the matching cleanup (listeners-and-timers.md, section 8) |
| `timer-cleared` | the id of `setTimeout`/`setInterval`/`requestAnimationFrame`/`requestIdleCallback` is dropped (a bare statement; the body of a `new Promise`, `.then`/`.catch`/`.finally` or `forEach` arrow), or kept in a variable or property path never passed to its own clear function (`clearTimeout`, `clearInterval`, `cancelAnimationFrame`, `cancelIdleCallback`) and never returned or handed over; or ids collected as arguments (`timers.push(setTimeout(...))`) in a file that never calls the clear function. An id returned (`return setTimeout(...)`, `() => setTimeout(...)`) is the caller's | clear it in the cleanup, `finally` or `stop()`; pause with `delayOrAbort` |
| `focus-scoped-work` | with `expo-router` or `@react-navigation/native` in package.json: a `useEffect`/`useLayoutEffect` in a screen folder (`featuresDir`, `routesDir`, or `asyncSafety.focusDirs`) that runs `setInterval`, a `watch*Async(...)` subscription or an expo-sensors `addListener` | `useFocusEffect`, and pause while backgrounded (`useIsAppActive`) |

## 3. Configuration

| Setting | Default | Override |
|---|---|---|
| Source folder | `src` | `--src-dir <dir>` or `rn-skills.config.json` `"srcDir"` |
| Screen folders for `focus-scoped-work` and the marker | `featuresDir` and `routesDir` from `resolveLayout` (`src/features`, `src/app`) | `"asyncSafety": { "focusDirs": ["src/features", "src/app"] }` |
| Extra promise-returning names for `async-by-reference` | none | `"asyncSafety": { "promiseFunctions": ["refreshTasks"] }` |

`rn-skills.config.json` is the optional repo file every skill's checkers read through check-lib;
`asyncSafety` is this skill's key. A malformed value is exit 2.

**The `// app-lifetime: <why>` marker.** A listener or timer that lives exactly as long as the app,
created once by the composition root, has nothing to release. Put the marker (a reason of at least 10
characters) on the call's line or one of the three lines above it. It is honoured only in `.ts` files
outside the screen folders: a component or a screen never lives as long as the app.

### When multi-package

Run the checker once per app: `node ${CLAUDE_SKILL_DIR}/scripts/check-async-safety.mjs . --src-dir
apps/<app>/src` (with `"asyncSafety": { "focusDirs": ["apps/<app>/src/features", "apps/<app>/src/app"] }`),
and once per shared package that holds hooks or services (`--src-dir packages/<pkg>/src`). The
react-native and router dependencies are looked up in the root package.json and every workspace's.

## 4. NOT APPLICABLE, notes and errors

| Line | When |
|---|---|
| `NOT APPLICABLE: react-native is not in package.json` | neither the root package.json nor any workspace depends on react-native |
| `focus-scoped-work not applied: neither expo-router nor @react-navigation/native is a dependency` | a note (the run still passes or fails on the other rules) |
| `ERROR [bad-input] no package.json in <root>` | the root has no package.json (exit 2) |
| `ERROR [bad-input] nothing to check: <src>/ does not exist` | the source folder is missing (exit 2) |
| `ERROR [bad-input] "asyncSafety.<key>" is not a list of names` | a malformed config value (exit 2) |

The checker prints no SKIP lines: everything it reads is the app's own code.

## 5. Known limits

- **Same-file knowledge.** A promise-returning function imported from another file is seen only when
  a member of that name is typed `Promise<...>` somewhere in the app, when its name ends in `Async`, or
  when it is listed in `promiseFunctions`. A name destructured from an object in the same file
  (`const { saveNote } = useNotesModel();`, or `{ reload: refresh }`) is looked up as that member, so
  `onPress={saveNote}` is flagged like `onPress={model.saveNote}`; a name passed in as a parameter
  (`function Row({ onSave }: Props)`) is the parameter's type's business (`void-callback-type`). A function-type alias (`onSave: SaveHandler`) is not
  followed by `void-callback-type`. A function wrapped in `useCallback(async ...)` is recognised (an
  app being brought into line has many; react-components-and-hooks removes them under the React
  Compiler); one wrapped in `useMemo`, or built by a factory (`const save = makeSaver(repo)`), is not.
- **Effects.** Only effects whose callback is an inline arrow with a block body (optionally wrapped in
  `useCallback`) are read. A cleanup that returns an identifier is trusted. Zustand writes are
  recognised in three forms: `useTasksStore.getState().replaceAll(...)`, `.setState(`, and a name the
  same file takes from a `use*Store(...)` hook (`const select = useTasksStore((s) => s.select)` or
  `const { select } = useTasksStore(...)`). Still missed: an action reached through a store not named
  `use*Store`, an action passed in as a prop or argument, a dispatch through a context or a custom
  hook (`useTaskActions().select(...)`). An effect that delegates to a custom hook taking a dependency list is invisible (and loses
  `exhaustive-deps` too; prefer inline effects).
- **TanStack mutation callbacks.** `onMutate`, `onSuccess`, `onError` and `onSettled` inside the
  arguments of `mutationOptions(`, `useMutation(` or `new MutationCache(` are skipped by
  `async-by-reference`: a mutation awaits what they return (verified in `@tanstack/query-core`
  5.104.0, `build/modern/mutation.js`), so `onSettled: invalidateAll` keeps the mutation pending until
  the invalidation ends, which networking-and-server-state wants. Wrapping it in a synchronous
  `.catch` wrapper would break that. Still flagged, because nothing awaits them: `new QueryCache({
  onError })` and the per-call `mutate(vars, { onSuccess })`. An options object built elsewhere and
  spread in is not recognised; write the callbacks inline (`onSettled: () => invalidateAll()`).
- **Latest-wins actions.** The latest-wins exemption is textual: the action must call `.start()` on a
  holder and read `.aborted`, and the file must call `.cancel()` on the same holder somewhere (the
  unmount effect). It does not prove that the `.aborted` read precedes every write; the action's race
  test does (test-recipes.md). An action reached through another file, or a latest request held in a
  ref (`latestRef.current.start()`), is not recognised: return `() => { latest.cancel(); }` from the
  effect as well.
- **Multiple awaits.** Each stretch between awaits that writes must read the guard, but the check is
  textual: a `.aborted` read placed after the write in the same stretch, or in a branch the write does
  not take, still satisfies it. Only a race test per await proves each guard (test-recipes.md,
  section 2).
- **Handles.** A handle passed to a function, put in an array or returned is trusted to be released by
  whoever receives it. A name reused for two different handles in one file can hide one of them.
- **Timers.** `setTimeout` on another object (`BackgroundTimer.setTimeout`) is not read.
- **Abort checks.** The checks read text: a cancellation decided through a helper in another file
  (`isAbort(error)`) is not followed; keep that decision on `signal.aborted`.

## 6. When a finding is wrong

There is no inline suppression besides the reasoned `app-lifetime` marker, on purpose. Make the
intent visible in code instead: keep the handle and release it; wrap the reference in a synchronous
handler; move a legitimately app-wide listener to the composition root with the marker. If a rule is
wrong for every app, change the checker and its fixtures (each rule keeps a `bad-*` case that fails).

## 7. Overlap with other skills

| Other skill's check | Relation |
|---|---|
| typescript-and-lint-rules: `no-floating-promises` (`ignoreVoid: false`), `asyncHandler`, `handlerBody`, `check-source` `sync-handler`/`handler-body`/`no-void-promise` | owns the inline handler forms; this checker adds references, types and everything after the handler |
| error-handling-typed-results: `catch-handled`, `adapter-boundary`, the global error net (`net-rejections`) | owns what a catch does and the last-resort net; this checker only requires that cancellation is read from the signal |
| react-components-and-hooks: `effect-cleanup` | checks that a subscribing effect returns a cleanup at all; `subscription-released` checks that each handle is released wherever it was created. An effect with no cleanup trips both |
| unit-and-component-tests: `test-sleep`, `fake-timers-in-logic` | test files; the templates' timer tests carry `// allow-fake-timers:` |
| networking-and-server-state | owns the ApiClient, query keys and retry policy; forwards TanStack's `signal` |

## 8. Verification record

Polish round, 2026-10-10 (latest): against the reference app (242 source files, now carrying this
skill's three canonical async modules and their tests) the checker reports 0 problems. In a scratch
copy of it, a guard-clause effect (`if (noteId === null) return;` before an AbortController effect)
stays silent; deleting its `if (controller.signal.aborted) return;` gives one `effect-stale-result`
finding, and `const { saveNote } = useModel(); <Pressable onPress={saveNote} />` with `saveNote: () =>
Promise<void>` gives one `async-by-reference` finding. That round's fixes, each with its fixture:
- the cleanup is the last top-level `return <expr>`; a bare `return;` guard clause is skipped
  (`pass-patterns` gained `use-note-model.ts`, silent; `bad-effect-stale-result` gained the same early
  return with no abort, 16 findings);
- an effect that only calls a same-file latest-wins action that the file cancels is accepted
  (`use-note-model.ts`); one whose holder is never cancelled is still flagged (`use-note-title.ts`);
- `async-by-reference` follows names destructured from an object to their member type
  (`bad-async-by-reference` gained `task-save-screen.tsx`, including a renamed `{ reload: refresh }`,
  11 findings);
- the `abort-signal` messages say expo/fetch rejects *most* aborted requests with a `FetchError` (an
  abort while the body is read rejects with the signal's reason or an `AbortError`, section 2 of
  cancellation-and-deadlines.md).

Earlier on 2026-10-10: the self-test has 24 runs (one or more planted bugs per rule, a workspace app
run with `--src-dir`, a pass case of legitimate shapes that must stay silent, planted bugs in
installed-skill folders and a vendored folder with a `SKILL.md` that stay silent, NOT APPLICABLE, a
missing router, and three bad-input errors), with the templates and examples as the good case, and
passes. Against the library's reference app (221 source files: every canonical file and adopted
template) the checker reports 0 problems; networking-and-server-state's connectivity adapter carries
the `// app-lifetime:` marker. With this skill's templates and examples copied into a scratch copy of
that app it reports 0 problems; deleting `if (signal.aborted) return;` from
`use-task-details-model.ts` gives one `effect-stale-result` finding, and a planted
`setRelated(await repo.related(id, signal))` after an abort-checked first await gives one.

That round's fixes, each with its fixture:
- `void-callback-type` reads type annotations only. `pass-patterns` holds `onSuccess: () =>
  Promise.all([...invalidateQueries])` inside `useMutation` and `handleNotification: () =>
  Promise.resolve({...})`, both silent; `bad-void-callback-type` still gives its 3 findings.
- `effect-stale-result` checks the guard in each stretch between awaits, flags a write whose argument
  awaits, reports a mounted ref in an effect with dependencies with its own message, and follows
  `useCallback(async ...)` loaders. `bad-effect-stale-result` gained the four shapes (14 findings);
  `pass-patterns` gained a two-await effect checked after each await and a mounted ref in a `[]`
  effect, both silent.
- `async-by-reference` follows `const handleSave = useCallback(async ...)` into `onPress={handleSave}`
  (`bad-async-by-reference`, 9 findings).

Earlier, on 2026-10-04: against a production Expo codebase (about 650 files, read only), the findings
after two false-positive fixes (a release written above the assignment; listeners on an ad object that
is destroyed) were four app-lifetime listeners without the marker and one `onUrl: (url) => unknown`
callback type. In the scratch copy, planting a removed `clearTimeout`, a dropped AppState subscription
and a polling effect that writes after a promise produced exactly those four findings.

Also on 2026-10-10, before that round: the abort guard was tightened (a cleanup's `abort()` counts
only when the continuations that write read `.aborted`; passing the signal alone no longer satisfies
it); `effect-stale-result` learned Zustand writes (`use*Store.getState().action(`, and actions a file
takes from a `use*Store(...)` hook); and `async-by-reference` stopped flagging the four mutation
callbacks that TanStack Query awaits (`useMutation({ onSettled })` stays silent while `new QueryCache({
onError })` and `mutate(id, { onSuccess })` are flagged). The search example's race test ("drops an
answer that resumes after a newer keystroke") and the details example's ("keeps the newer task when
the older request answers last") each fail when their `if (signal.aborted) return;` is deleted.
