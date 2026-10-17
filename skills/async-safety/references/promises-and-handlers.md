# Promises and handlers

Who owns a promise, why a callback slot is the place promises get lost, and the shapes that close
the gap: synchronous handlers, void callback types, and no promise-returning function passed by
reference. Read it before wiring a handler, a model field or a listener.

## Contents

1. Every promise has an owner
2. The hole the linters leave (verified table)
3. Passing a promise-returning function by reference
4. Callback types return void
5. Model hooks: void intents over async internals
6. Reporting what a fire-and-forget task throws
7. Combining promises: all, allSettled, race, any
8. Loops, sequencing and parallel work
9. What happens to an unhandled rejection on a device

## 1. Every promise has an owner

A promise is owned when something will see its rejection: it is `await`ed inside a `try` (or a
caller who awaits), it is `return`ed to such a caller, or it ends in `.catch(reportError)`. A promise
nobody owns fails silently: in a release build React Native does not even log it (section 9).

typescript-and-lint-rules states and lints the inline forms (its rule 10): `no-floating-promises` with
`ignoreVoid: false` (so `void task()` is not ownership), the `asyncHandler` selector (no `async` inline
`on*` handler, no `async` `handleX`, no `handleSubmit(onValid)` straight into a prop) and `handlerBody`
(a handler has a block body and returns nothing). This skill does not restate those checks; it closes
what they cannot see: references, callback types, effects, listeners, timers and cancellation.

The one shape for starting async work from something synchronous:

```ts
const onSave = (draft: TaskDraft): void => {
  save(draft).catch(reportError);   // the handler returns nothing; the promise is owned
};
```

## 2. The hole the linters leave (verified table)

React Native's Strict TypeScript API (the `react-native-strict-api` condition in `tsconfig.base.json`)
types many callback props as returning `unknown`, and a few accept a promise outright (`RefreshControl`
`onRefresh`). `@typescript-eslint/no-misused-promises` only reports a promise-returning function where
a `void` return is expected, so for those props it stays silent. Verified on 2026-10-04 by running the canonical ESLint config (typescript-eslint 8.70.1) over
React Native 0.86.3 code, passing `async function save(): Promise<void>` by reference:

| Slot | Declared return | `no-misused-promises` | Caught by this skill |
|---|---|---|---|
| `Pressable` `onPress`, `onLongPress` | `unknown` | silent | `async-by-reference` |
| `TextInput` `onSubmitEditing`, `onChangeText` | `unknown` | silent | `async-by-reference` |
| `RefreshControl` `onRefresh` | `void \| Promise<void>` (a promise return is allowed; `RefreshControl.js` calls it and drops the result) | silent | `async-by-reference` |
| `Keyboard.addListener(event, save)` | `unknown` | silent | `async-by-reference` |
| `Linking.addEventListener('url', save)` | `unknown` (types only) | silent | `async-by-reference` |
| `Dimensions.addEventListener('change', save)` | `Function` (types only) | silent | `async-by-reference` |
| `FlatList` `onEndReached` | `void` | reported | also reported |
| `AppState.addEventListener('change', async () => {})` | `void` | reported | not needed |
| `setTimeout(save, ms)`, `requestAnimationFrame(save)`, `queueMicrotask(save)` | `void` | reported | not needed |
| an app primitive whose prop is `onPress: () => void` (`PressableSurface`) | `void` | reported | also reported |

Re-verify: put the probe in a scratch copy of the app and run `npx eslint <file> --max-warnings 0`;
read a prop's type in `node_modules/react-native/types_generated/Libraries/...`.

The last row is the structural fix: when every callback type the app declares returns `void`, the
linter catches the promise for you (rule 2 and section 4).

## 3. Passing a promise-returning function by reference

`onPress={retry}` hands `retry`'s promise to a slot that throws it away. The rejection is never seen:
no lint error, no type error, no log in a release build. The same for `onRefresh={model.reload}`,
`onPress={ImagePicker.launchImageLibraryAsync}`, `Keyboard.addListener('keyboardDidHide', saveDraft)`
and a model that returns `{ onSync: sync }` where `sync` is `async`.

The fix is always the same synchronous wrapper:

```tsx
<TaskButton onPress={() => { retry().catch(reportError); }} />
```

or, better, a model whose field is already a void intent (section 5), so the view passes
`onPress={model.onRetry}` and there is nothing to wrap.

What `check-async-safety` treats as promise-returning (`async-by-reference`): an `async` function or
one annotated `Promise<...>` in the same file; a member (`model.reload`) whose type returns
`Promise<...>` everywhere the app declares a member of that name; any name ending in `Async` (Expo's
convention: `launchImageLibraryAsync`, `requestPermissionsAsync`, `mutateAsync`); `Linking.openURL`,
`Linking.openSettings`, `Share.share`, `StoreReview.requestReview` (with those receivers); and the names listed in
`rn-skills.config.json` `"asyncSafety": { "promiseFunctions": [...] }` (a store's async actions
imported from another file, for example). TanStack Query's `refetch` and `fetchNextPage` resolve even
on error by default, so they are not on the list.

## 4. Callback types return void

Type every `on*` prop and model field, and every `handle*` member, as returning `void`:

```ts
export type TaskRowProps = {
  readonly title: string;
  readonly onToggle: () => void;                       // not () => Promise<void>, not () => unknown
};
```

Why `void` and not `Promise<void>`: a `Promise<void>` return invites the caller to pass an async
function and the component to ignore its result, which is the hole again, one layer down. Why not
`unknown`: it is what lets React Native's own props swallow promises (section 2). With `void`,
`no-misused-promises` reports `onToggle={toggleAsync}` at the call site, so the type does the review.
`void-callback-type` fails `on*`/`handle*` members typed `(...) => Promise<...>`, `PromiseLike<...>` or
`unknown`. A function-type alias (`onSave: SaveHandler`) is not followed; keep callback types inline.

A component that must know when the work finishes (a button showing busy) takes the state, not the
promise: `isBusy` from the model, which owns the promise.

## 5. Model hooks: void intents over async internals

The model hook owns the async work and exposes void intents; the view never sees a promise:

```ts
export function useTaskEditorModel(): TaskEditorModel {
  const { tasks, errorLog } = useServices();
  const [isSaving, setIsSaving] = useState(false);
  const [failure, setFailure] = useState<TaskFailure | null>(null);
  const save = async (draft: TaskDraft): Promise<void> => {
    setIsSaving(true);
    try {
      const result = await tasks.save(draft);           // a Result (error-handling-typed-results)
      setFailure(result.ok ? null : result.error);
    } finally {
      setIsSaving(false);
    }
  };
  const onSave = (draft: TaskDraft): void => {
    if (isSaving) return;                               // a write never runs twice
    save(draft).catch((error: unknown) => {
      errorLog.record('service', error);
    });
  };
  return { isSaving, failure, onSave };
}
```

The view passes `onPress={() => { model.onSave(draft); }}` and renders the button busy and disabled
from `isSaving`. The `if (isSaving) return;` guard ignores a second tap while the save is in flight
(effects-and-races.md, section 9). Two taps within one frame can both still see `false`, so a
double-submit that must never happen keeps the in-flight flag in a ref (`savingRef.current`) as well.
The promise lives and dies inside the model, where a test can await it.

## 6. Reporting what a fire-and-forget task throws

`.catch(reportError)` needs a `reportError` that never throws. The canonical error log port
(`ErrorLogPort.record(source, error)`, owned by architecture-and-boundaries) is that function; a model
builds it once: `const reportError = (error: unknown): void => { errorLog.record('service', error); }`.
error-handling-typed-results owns what a catch may do (map, record with a fallback, or rethrow with
`cause`; never `.catch(() => undefined)`), so this skill only requires that the promise reaches one.

Cancellation is the exception to "record every rejection": a request your own code aborted is not a
failure. Ask the signal first: `.catch((error: unknown) => { if (!signal.aborted) reportError(error); })`
(cancellation-and-deadlines.md, section 3).

## 7. Combining promises: all, allSettled, race, any

| Combinator | Use when | Watch out |
|---|---|---|
| `Promise.all` | every result is needed, and one failure fails the whole | the other promises keep running after the first rejection; pass them one signal and abort it in a `catch` when the rest is wasted work |
| `Promise.allSettled` | each item is handled on its own (sync five lists; show which failed) | it never rejects, so check every `status`; an item that should have been fatal is easy to miss |
| `Promise.race` | a deadline or the first of equals | the loser keeps running and may still write later: give it a signal and abort it (`withTimeout` does) |
| `Promise.any` | the first success of equivalent sources | rejects with an `AggregateError` only when all fail |

`Promise.race([task, timeout])` without a cleared timer leaves the timer pending; without an abort,
the task finishes and writes after the caller moved on. That is why the template `withTimeout` clears
its timer in `finally` and aborts the task's signal.

## 8. Loops, sequencing and parallel work

- Independent awaits run together: `await Promise.all(ids.map((id) => repository.load(id, signal)))`.
- Await in sequence only when order matters (migrations v1 → v2 → v3) or a rate limit demands it;
  then say so in a comment.
- A long sequential loop checks `signal.aborted` between items, so leaving the screen stops it.
- `array.forEach(async (item) => ...)` starts every callback and owns none of them. `no-floating-promises`
  is silent (forEach returns void); `no-misused-promises` reports it (an async function where a void
  callback is expected). Use `for...of` with `await`, or `Promise.all` over `map`.
- An `async` Promise executor (`new Promise(async (resolve) => ...)`) loses its rejections; lint reports
  it (`no-async-promise-executor`). Write a plain `async` function.

## 9. What happens to an unhandled rejection on a device

React Native 0.86 enables Hermes' promise-rejection tracker only in development: a red box in a debug
build, nothing at all in a release build, on iOS and Android alike. error-handling-typed-results owns
the global error net that turns the tracker on in every build and records what reaches it. The net is
the last resort, not the plan: a rejection it records was already a silent failure for the user (the
save did not happen, the screen kept spinning). Every rule in this skill exists so that the net stays
quiet.
