# Loading placeholders and busy controls

How long nothing shows, what shows after that, and where in-flight work shows its progress.

## Contents

1. The thresholds
2. The delayed flag
3. DelayedPlaceholder and SkeletonBlock
4. Why no shimmer and no centred spinner
5. Busy controls (useBusyAction)
6. No modal spinner
7. Pull to refresh on iOS and Android
8. Accessibility of loading
9. Testing timing
10. Verified facts

## 1. The thresholds

`templates/src/ui/feedback/feedback-timing.ts` holds the behavioural thresholds in one place. They
are perception limits, not design tokens (no colour, size or curve), and screens read them from
there rather than typing a number.

| Threshold | Value | Why |
|---|---|---|
| `PLACEHOLDER_TIMING.showDelayMs` | 300 ms | below it a load reads as instant, and a placeholder that appears and leaves inside it is only a flicker |
| `PLACEHOLDER_TIMING.minVisibleMs` | 500 ms | once shown, a placeholder that vanishes after 40 ms is a second flicker; half a second reads as a deliberate state |
| `NOTICE_TIMING.resultMs` | 4000 ms | reads a short sentence twice |
| `NOTICE_TIMING.actionMs` | 8000 ms | time to read and move a thumb to Undo |

The notice values are floors: feedback-ladder.md explains how the person's accessibility timeout
lengthens them on Android and why a notice with an action stays while a screen reader runs.

React's Suspense does not replace the show delay. Its `FALLBACK_THROTTLE_MS` (300 ms) keeps a
fallback that is already showing up a little longer before revealing the content, which is the
`minVisibleMs` half of the rule; a fresh fallback shows at once. Wrap a Suspense fallback in
`DelayedPlaceholder` too (states-and-the-switch.md section 3).

## 2. The delayed flag

`createDelayedFlag(timing, schedule)` (`delayed-flag.ts`) is the rule as a tiny external store,
free of React and of real timers:

```
work starts ──300 ms──▶ visible ──(work ends)──▶ stays until 500 ms after it appeared ──▶ hidden
work ends before 300 ms ─────────────────────────────────────────────────────────────────▶ never shown
work restarts while the hold runs ──▶ stays visible (no blink between two loads)
```

`useDelayedVisibility(isActive, timing?, schedule?)` wires it into React with
`useSyncExternalStore`: one flag per mounted placeholder (created in a `useState` initializer), its
`set` called from an effect when `isActive` changes, and `cancel` on unmount, which stops the
pending timer (async-safety's `timer-cleared` rule). Under StrictMode's development remount the flag
starts over, so the placeholder still waits 300 ms. The `schedule` parameter is the test seam.

## 3. DelayedPlaceholder and SkeletonBlock

```tsx
<DelayedPlaceholder
  isLoading={state.kind === 'loading'}
  placeholder={<TaskRowsSkeleton />}
  label={copy.loadingLabel}           // "Loading tasks"
  testID="tasks.state.loading"
>
  {settledContent}
</DelayedPlaceholder>
```

- For the first 300 ms it renders an empty `View` (`<testID>.pending`): blank on purpose, so a fast
  answer never flashes.
- Then the placeholder, wrapped in one accessible element (`accessibilityRole="progressbar"`, the
  translated label, `accessibilityState={{ busy: true }}`), so a screen reader hears "Loading tasks"
  once instead of a list of grey boxes.
- When loading ends during the hold, the placeholder stays until 500 ms passed; then the children.
- **Shape it like the content.** Rows of the real row height (`SkeletonBlock` with the row's
  minimum height), a title line at about 70 % width, a picture at its real size. Content that lands
  in the same boxes does not jump; a centred spinner replaced by a full list moves everything.
- `SkeletonBlock` is a still `sunken` block, hidden from screen readers.

## 4. Why no shimmer and no centred spinner

- **No shimmer.** A shimmer is a loop, and every loop needs a Reduce Motion alternative and a
  frame budget (motion-and-animation owns loops and the moment catalog; performance-budgets owns
  frame cost). A still block needs neither and reads just as clearly as "something is coming". An
  app that wants a shimmer declares it as a loop moment in motion-and-animation and keeps the
  still block as its reduced form.
- **No centred spinner for a screen.** It flashes on fast loads, says nothing about what is coming,
  and the content that replaces it reflows the screen. `bare-spinner` flags an `ActivityIndicator`
  in the features or routes folder of a file that never uses the delay. A spinner inside a control
  (a busy button in `src/ui`) is fine: it is the control's own state.

## 5. Busy controls (useBusyAction)

In-flight feedback lives on the control that started the work, never over the screen:

```ts
const save = useBusyAction(
  async () => {
    // mutateAsync rejects on failure: attemptAsync turns that into a Result, and the failure is shown.
    const saved = await attemptAsync(() => saveTask.mutateAsync(draft), apiFailureOf);
    const failureKey = saved.ok ? null : failureKeyOf(saved.error); // null: cancelled, never shown
    if (failureKey !== null) setSaveFailure(t(failureKey)); // inline next to the button
  },
  (error) => { errorLog.record('network', error); }, // a contract-breaking rejection only
);
// <Button label={copy.save} isBusy={save.isBusy} onPress={save.start} />
```

- `start()` ignores a press while the work runs, so a double tap never writes twice (the button's
  `isBusy` also disables it and shows its busy state: ui-component-library's `Button` and
  `BusyIndicator`).
- The work never rejects: it wraps the mutation in `attemptAsync(…, apiFailureOf)` and shows a
  failure through the ladder, inline next to the control when the person must act on it, or as a
  notice when nothing changed (`examples/use-tasks-model.ts`, the confirmed clear). `onError` gets
  only a rejection that breaks that contract (a bug), and the control is usable again either way.
  A busy action whose failure reaches only the error log is a silent failure: the button re-enables
  and the person never learns the save did not happen.
- The rest of the screen stays usable. If continuing really would corrupt state (a migration, a
  sign-out that clears data), say why in the code and show the busy state on the screen that owns it.

## 6. No modal spinner

A `Modal` holding an `ActivityIndicator` over the whole app for a 200 ms write is the most common
self-inflicted "the app froze": it blocks every other action, steals screen-reader focus, and on
Android a back press does nothing visible. `busy-overlay` flags a `<Modal>` that holds an
`ActivityIndicator` or `BusyIndicator`.

## 7. Pull to refresh on iOS and Android

`RefreshControl` (React Native 0.86) is controlled: `refreshing` must be set true by the app while
the refetch runs and false after, or the indicator never stops. iOS colours it with `tintColor`,
Android with `colors` (at least one) and positions it with `progressViewOffset` (use the header
height when the list scrolls under a translucent header).

**Feed `refreshing` from the person's pull only**, never from `ready.isRefreshing`. That flag is
TanStack's `fetchStatus === 'fetching'`, true for every background refetch: on focus, on reconnect,
and the invalidation after each write (the toggle and the soft delete included). Wired to
`refreshing`, the platform spinner appears after every write without a pull, on both platforms; on
iOS a `refreshing` set true from code also shows the `UIRefreshControl` and can push the rows down
by its height. TanStack's own React Native guidance keeps a separate refresh-by-user flag for this
reason. The model already has the tool:

```ts
// In the model hook: true from the pull until refetch() settled; a second pull is ignored.
const refresh = useBusyAction(
  async () => { await query.refetch(); },
  (error) => { errorLog.record('network', error); },
);
// isRefreshingByUser: refresh.isBusy, onRefresh: refresh.start
// In the view:
// <RefreshControl refreshing={model.isRefreshingByUser} onRefresh={model.onRefresh} />
```

`ready.isRefreshing` stays for an optional quiet header line ("Updating…", `feedback.updating`)
while a background refetch runs and the person did not pull (`examples/tasks-screen.tsx`).

## 8. Accessibility of loading

- One label for the whole placeholder (`progressbar` role, busy state), never per block.
- When the content arrives the screen reader does not announce it by itself: for a long load that
  ends while the person waits, the model may announce the result once ("12 tasks loaded") with
  accessibility-as-code's `useAnnounce()`; for an ordinary screen load, do not (it talks over them).
- A busy button keeps its label and adds `accessibilityState={{ busy: true }}` (TalkBack reads
  "busy"; VoiceOver reads the label and the dimmed state).

## 9. Testing timing

- The rule itself: `delayed-flag.test.ts` drives a manual scheduler (no fake timers, no React):
  fast work never shows, slow work shows at 300 ms, the hold keeps it 500 ms, a restart during the
  hold keeps it visible, `cancel` stops the timer.
- The hook: `use-delayed-visibility.test.ts` uses Jest's fake timers for the visible path, and the
  `schedule` seam to prove unmount leaves no timer (React's own scheduler also uses timers, so
  `jest.getTimerCount()` is not a reliable measure).
- The view: advance fake timers by 300 ms inside `act()` and find the placeholder by its
  `progressbar` role and label.

## 10. Verified facts

Verified on 2026-10-10 against the reference app's installed packages (React 19.2.3, React Native
0.86.3).

| Fact | Re-verify |
|---|---|
| `FALLBACK_THROTTLE_MS = 300` counts from `globalMostRecentFallbackTime` (set when a fallback commits): it delays revealing content, never showing a fallback (read in the source) | `grep -n "FALLBACK_THROTTLE_MS\|globalMostRecentFallbackTime" node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-dev.js` |
| `isFetching` / `fetchStatus === 'fetching'` is true for background refetches and invalidations, not only a pull | `grep -n "fetchStatus" node_modules/@tanstack/query-core/build/modern/query.js` |
| `progressbar` is an accessibility role | `grep -n "progressbar" node_modules/react-native/Libraries/Components/View/ViewAccessibility.d.ts` |
| `RefreshControl`: `refreshing` controlled, iOS `tintColor`, Android `colors` and `progressViewOffset` | `grep -n "refreshing\|colors\|tintColor\|progressViewOffset" node_modules/react-native/Libraries/Components/RefreshControl/RefreshControl.d.ts` |
| `useEffectEvent` is exported by React 19.2 | `grep -n "useEffectEvent" node_modules/react/cjs/react.production.js` |
