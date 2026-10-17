# Simulated clock, simulated connectivity and the debug switches

How a test build fakes the day and the network for the whole app without a second code path, and how
the switches survive a reload. Verified on 2026-10-10 in Jest against the canonical ports
(`ClockPort` from architecture-and-boundaries, `ConnectivityPort` and `createReachabilityHub` from
networking-and-server-state); not yet measured on a device.

## Contents

- One wrapper per port, made once
- The simulated clock
- The simulated connectivity
- The debug switches store
- Surviving a reload or a kill
- Tests
- Pitfalls

## One wrapper per port, made once

`createTestHooks({ services, storage, settings })` (in `src/services/test-hooks/`, a test-only
folder) runs once in the startup, right after `createDeviceServices()`:

1. creates the debug switches store, hydrated from the test-only key-value store;
2. wraps the real clock (`createSimulatedClock`) and, when the services hold one, the real
   `services.connectivity` (`createSimulatedConnectivity`);
3. returns `services`: the same object shape with `clock` and `connectivity` swapped for the
   simulated ports, which the startup hands to the app **instead of** the device services.

The connectivity port lives inside `Services` (networking-and-server-state adds it to the composition
root, and `AppProviders` hands `app.services.connectivity` to `QueryProvider`), so the swap has to
happen inside the services: a simulated port handed out beside them would leave TanStack Query,
banners, ads and purchases on the real one. `createTestHooks` is generic over the app's `Services`
(`HookableServices = Services & { connectivity?: ConnectivityPort }`), so it compiles before the app
has a connectivity port (nothing to simulate yet) and keeps the app's exact type after.

One wrapper reaches every reader: the Tasks list's "due today", TanStack Query's `onlineManager`, an
offline banner, ads and purchases all read the same port they read in production. A debug switch
that patched one screen would test that screen's copy of the logic, not the app.

The test-hook call sits in the app registry's `prepareRootKits`, which AppRoot's `startApp` runs
first in its state initializer (`useState(() => startApp(...))`), so React makes it once per tree,
before the data layer opens. `createDeviceServices()` (canonical, architecture-and-boundaries) stays
unchanged: the hooks wrap its result.

## The simulated clock

```ts
createSimulatedClock(real, () => store.getState().overrides.today)
```

- `today()` answers the simulated day when one is set, else the real one. It reads the switch on
  every call, so `date=` and the menu's day buttons apply at once.
- `nowMs()` and `msUntilNextLocalDay()` call the real clock every time. Timestamps, durations, rate
  limits and the next-day countdown never jump, and `useToday()` (dates-streaks-and-statistics) still
  turns at the real midnight. A simulated `nowMs()` would make every timer and every stored
  timestamp lie.
- `useToday()` re-reads `today()` at most a minute after a change, and at once on an AppState change.
  A screen that must show the new day immediately after the menu changed it re-renders when the menu
  closes (navigation focus) or after an app-state round trip; the debug link avoids the question by
  setting the day before it opens the target screen.

`check-test-hooks` (`simulated-clock`) runs the app's module: it moves the real clock after the
wrapper exists and fails a wrapper that captured `nowMs()`, replaced the countdown or cached the day.

## The simulated connectivity

```ts
createSimulatedConnectivity(realAdapter, isInitiallyOffline) -> { port, setOffline, stop }
```

- Built on `createReachabilityHub` (networking-and-server-state), so it implements all four
  `ConnectivityPort` members, `isOnline` stays derived from reachability, and unchanged reports are
  dropped (a listener never hears the same value twice).
- While simulating offline it reports `none`; otherwise it forwards the real adapter's reachability,
  including Android's `unvalidated`. Ending the simulation reports the real value at that moment.
- `stop()` releases the real adapter (tests; the app keeps the wrapper for its lifetime).
- `createTestHooks` subscribes to the switches store and calls `setOffline` when `isOffline` changes,
  so the menu switch and `offline=1` behave the same.

The simulation is a JS-level answer: native SDK traffic (an ad SDK's own requests) still uses the
real network. Ads and purchases skills read the port, so their offline paths are what the switch
tests. To prove the app copes with a real outage, turn the network off on the device as well.

## The debug switches store

`src/stores/debug-overrides/` follows state-management-zustand's store rules like any app store:

| File | What |
|---|---|
| `debug-overrides.ts` | the `DebugOverrides` type, defaults and the valibot codec of the stored text |
| `debug-overrides-reducer.ts` | pure reducer: `apply-overrides` (a link), `set-offline`, `set-motion`, `set-canvas-probe`, `advance-day`, `use-real-day`; the same object when nothing changes |
| `debug-overrides-reducer-cases.ts` | the rules as data (state-management-zustand's `check-reducers` runs them) |
| `debug-overrides-store.ts` | `createDebugOverridesStore({ storage, errorLog })`: hydrate, then reduce, persist, publish; `DebugOverridesStoreContext` and `useDebugOverridesStore(selector)` |
| `debug-overrides-selectors.ts` | primitives and references only |

- Never a module-level store: `createTestHooks` makes it once, and `TestHooksRoot` provides it.
- A store that cannot be read runs the session on the defaults and never writes (it would overwrite
  switches it could not read); a failed write publishes only `lastWriteFailure`.
- The app now has two persisting stores, so state-management-zustand asks for `contracts/stores.json`
  (copy its template; no cross-store writes).

## Surviving a reload or a kill

The switches live under their own key, `debug.overrides`, in the `expo-sqlite/kv-store` database
the preferences also use (rtl-and-direction's direction guard and the settings storage write other
keys there), read synchronously before the first render (`kv-debug-storage-adapter.ts`), never in
the app's SQLite tables or under another key. So:

- the direction restart, a crash-recovery reload and a killed app all come back with the same day,
  offline state, motion and probe;
- `launchApp: { clearState: true }` in Maestro, "Clear storage" on Android and deleting the app on iOS
  wipe them with the app's data, so every flow starts clean;
- production never opens the key: the adapter is reached only through the entry.

## Tests

| Test | Proves |
|---|---|
| `simulated-clock.test.ts` | the real day without a switch; `today()` only changes; time and countdown follow the real clock |
| `simulated-connectivity.test.ts` | forwarding, `none` while offline, the real value after, dropped repeats, `stop()` |
| `create-test-hooks.test.ts` | hydration before the first read; the clock and `services.connectivity` swapped inside the services (a reader of `services.connectivity` hears the switch while the device stays online); a change reaches the wrappers and the disk; unreadable and unwritable storage; services without a connectivity port; `stop()` |
| `debug-overrides-selectors.test.ts` | each selector returns a primitive or a reference already in the state |
| `debug-overrides-store.test.ts` | persist before publish, a failed write publishes only the failure, a no-op writes nothing |
| `debug-overrides-reducer.test.ts` | every case of the cases table |
| `kv-debug-storage-adapter.test.ts`, `fake-debug-storage.test.ts` | the adapter maps kv-store's calls and throws; the fake behaves like it |

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| "Due today" ignores `date=` | a service got the real clock (the startup handed `device` beside the hooks' services) | hand `testHooks?.services ?? device` only (`hooks-wired`) |
| `offline=1` changes nothing for TanStack Query or a banner | the simulated port was handed out beside the services, so `services.connectivity` is still the device adapter | let `createTestHooks` swap it inside the services (the template); the `create-test-hooks` test proves it |
| Timers fire at odd times in a simulated day | the wrapper simulated `nowMs()` too | keep `nowMs()` real (`simulated-clock`) |
| The offline banner stays after the switch is off | a hand-written port that never reports the real value again | build on the hub (`simulated-connectivity`) |
| Switches lost after the language reload | they were kept in memory or in a React state | the kv store, hydrated in `createTestHooks` |
| A switch from a previous flow leaks into the next | the flow launched without `clearState` | `launchApp: { clearState: true }` at the start of every flow |
