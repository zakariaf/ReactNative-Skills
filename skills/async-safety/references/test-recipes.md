# Test recipes

Async bugs pass every test that resolves promises in the order they were started. These recipes make
the order the test's choice: controlled promises, out-of-order answers, unmount in the middle, fake
timers for debounce and deadlines, and assertions that nothing is left behind. They follow
unit-and-component-tests (await every RNTL call, render hooks through `renderHookWithProviders`, fakes
over mocks, fake timers only for UI timers or a marked timer helper).

## Contents

1. Controlled promises
2. Out of order: the newer answer wins
3. Unmount in the middle
4. Cancellation is not recorded
5. Fake timers: debounce, deadlines, pauses
6. Nothing left behind: listeners and timers
7. A fake port that records signals
8. What Jest cannot prove (and what does)

## 1. Controlled promises

`Promise.withResolvers()` (Node 26 in Jest) gives a promise and the functions that settle it. A fake
port returns one per call and keeps the settle functions, so the test decides when and in which order
each call answers:

```ts
type LoadCall = { readonly taskId: string; readonly signal: AbortSignal; readonly settle: (r: LoadResult) => void };

function createControlledTaskDetails(): { readonly port: TaskDetailsPort; readonly calls: LoadCall[] } {
  const calls: LoadCall[] = [];
  return {
    calls,
    port: {
      load: (taskId, signal) => {
        const pending = Promise.withResolvers<LoadResult>();
        calls.push({ taskId, signal, settle: pending.resolve });
        return pending.promise;
      },
      search: () => Promise.resolve(ok([])),
    },
  };
}
```

Use `Promise.withResolvers` in tests only; app code that needs a deferred builds it with `new Promise`.

## 2. Out of order: the newer answer wins

```ts
it('keeps the newer task when the older request answers last', async () => {
  const { port, calls } = createControlledTaskDetails();
  let taskId = 'task-1';
  const { result, rerender } = await renderHookWithProviders(() => useTaskDetailsModel(taskId), {
    services: { taskDetails: port, errorLog: createFakeErrorLog() },
  });
  taskId = 'task-2';
  await rerender(undefined);

  expect(calls[0]?.signal.aborted).toBe(true);           // the old request was cancelled

  await act(() => { calls[1]?.settle(ok(task('task-2'))); });
  await act(() => { calls[0]?.settle(ok(task('task-1'))); });   // the slow one lands last

  expect(result.current.state).toStrictEqual({ status: 'loaded', task: task('task-2') });
});
```

Delete the `signal.aborted` check from the model and this test fails: that is how to know it tests
the race (examples/use-task-details-model.test.ts does exactly this).

**One race test per await.** A run that awaits twice (load the task, then its related items) has two
places where a newer run can overtake it. Write the test for the later one too: settle the first call
of the old run, switch the input, then settle the old run's second call last and expect the newer
state. `check-async-safety` asks for a `signal.aborted` read in each stretch between awaits, but it
reads text: a check placed after the write, or in a branch that the write does not take, still
satisfies it. Only this test proves each check guards its write.

## 3. Unmount in the middle

```ts
const { unmount } = await renderHookWithProviders(() => useTaskDetailsModel('task-1'), { services });
await unmount();
expect(calls[0]?.signal.aborted).toBe(true);
await act(() => { calls[0]?.settle(ok(task('task-1'))); });   // a late answer must change nothing
```

For a screen, the same with `renderWithProviders` and `screen.unmount()`; for navigation-driven
blur, `renderRouterWithProviders` (unit-and-component-tests) and a navigation away.

## 4. Cancellation is not recorded

```ts
const errorLog = createFakeErrorLog();
// ... render, then unmount
await act(() => { calls[0]?.fail(new Error('fetch failed: cancelled')); });
expect(errorLog.recorded).toHaveLength(0);
```

And the inverse: a rejection while the request is still current is recorded once.

## 5. Fake timers: debounce, deadlines, pauses

- In a component or model test (outside the logic folders), `jest.useFakeTimers()` in `beforeEach`,
  `jest.useRealTimers()` in `afterEach`, no marker needed.
- In a logic-folder test (`src/core`, `src/services`, `src/stores`, ...), unit-and-component-tests
  bans fake timers unless the unit is itself a timer: the templates' tests carry
  `// allow-fake-timers: <why>` for that reason (`delay-or-abort.test.ts`, `with-timeout.test.ts`).
  Anything else in those folders takes time from the injected clock instead.
- Advance with the async variants so promise callbacks run between timers:
  `await act(async () => { await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS); })`.
- Never sleep in a test (`test-sleep`): no `await new Promise((r) => setTimeout(r, 50))`.

```ts
it('shows timed-out when the search hangs past the deadline', async () => {
  const { port } = createControlledSearch();          // its search never settles
  const { result } = await renderSearch(port);
  await act(async () => {
    result.current.onQueryChange('ta');
    await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + SEARCH_DEADLINE_MS);
  });
  expect(result.current.state).toStrictEqual({ status: 'failed', reason: 'timed-out' });
});
```

## 6. Nothing left behind: listeners and timers

- **Timers:** after the unit settles or unmounts, `expect(jest.getTimerCount()).toBe(0)` (fake timers
  on). A helper that forgets `clearTimeout` fails it.
- **Listeners on a fake:** give the fake a `listenerCount()` and assert it returns to 0 after the stop
  or unmount (examples/watch-sync-status.test.ts).
- **Listeners on a native module mock:** spy on the subscription's `remove`:
  ```ts
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove } as unknown as EventSubscription);
  const { unmount } = await renderHookWithProviders(() => useForegroundRefresh(refresh));
  await unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  ```
- **EventTarget listeners:** spy on `signal.removeEventListener` and expect the same function that
  was added (the templates' tests do).

## 7. A fake port that records signals

A fake that accepts a signal records it, so a test asserts that the work was cancelled, not only that
its result was ignored. When the fake models a cancellable call, make it reject (or resolve
`cancelled`) when its signal aborts, the way a real adapter does:

```ts
load: (taskId, signal) =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () => { resolve(err({ kind: 'cancelled' })); }, { once: true });
    pending.set(taskId, resolve);
  }),
```

## 8. What Jest cannot prove (and what does)

- **The device's AbortController.** Jest runs Node's, which has `throwIfAborted`, `reason` and the
  `{ signal }` listener option; the phone does not (cancellation-and-deadlines.md, section 1). The
  `abort-signal` rule of `check-async-safety` is the gate; a device run of the flow (e2e-maestro) is
  the proof.
- **expo/fetch's abort errors.** Jest never runs `expo/fetch`; the adapter's "ask the signal" shape is
  what makes the difference irrelevant.
- **Background timing.** iOS suspension and Android's cached-app freezer do not exist in Jest; test
  the pause logic with an injected `isActive` and the elapsed-time logic with the fake clock.
- **Covered screens staying mounted.** Prove that blur stops the work with a router test
  (`renderRouterWithProviders`, navigate away, expect the fake's `listenerCount()` or
  `jest.getTimerCount()` to drop), and keep `focus-scoped-work` green.
