# Example: wiring the measurement layer into an app

Shapes to imitate after copying the templates; the files named here belong to other skills, so change
them the way their skills say. The order matches app-startup-and-bootstrap's startup table.

## 1. The composition root gets the perf port (architecture-and-boundaries)

"A new port adds one member here, one line in each factory, and nothing else":

```ts
// src/services/services-context.tsx (one member)
export type Services = {
  readonly clock: ClockPort;
  readonly directionGuard: DirectionGuardPort;
  readonly errorLog: ErrorLogPort;
  /** performance-budgets: clocks, process start, build header, share sheet. */
  readonly perf: PerfPort;
};

// src/services/create-device-services.ts (one line)
perf: createExpoPerfAdapter(),

// src/services/create-test-services.ts (one line)
perf: given.perf ?? missingPort('perf'),
```

The adapter reads the build's identity with expo-application, so install it once with
`npx expo install expo-application` (an Expo SDK module; dependency-management's policy applies).
The composition root's own tests list the ports (`create-device-services.test.ts` expects the exact
keys): add `'perf'` there in the same change. Tests that render the first screen need no perf fake while
they pass no perf log: `useColdStartMark` returns before it reads the port.

## 2. The JS entry mark in the startup decision (app-startup-and-bootstrap)

```tsx
// src/app/_layout.tsx (inside the first-render initializer, never at module scope)
function decideStartup(): StartupDecision {
  const services = createDeviceServices();
  markJsEntry(services.perf.epochMs());
  // ...config, language, the direction decision
}
```

## 3. The first screen marks itself drawn (the feature's model hook)

```ts
// src/features/tasks/use-tasks-model.ts
const services = useServices();
const query = useQuery(tasksQueryOptions(services.api));
useColdStartMark({
  perf: services.perf,
  perfLog: TEST_ONLY?.perf.perfLog ?? null,
  label: 'tasks',
  isReady: query.isSuccess,
});
```

`isReady` is what makes the number honest: the mark waits until the screen shows its real data, so a
launch that spends 600 ms on a spinner reports those 600 ms. A first screen whose data is already in
memory (a store hydrated before the screen mounts) passes `isReady: true`. `TEST_ONLY` is null in store
builds (app-variants-and-environment's literal gate), so nothing is logged there, and the hook costs
one effect.

## 4. Test builds get the log and the debug actions (debug-menu-and-test-hooks)

```ts
// src/test-only-entry.ts (inside the API the gate exposes)
perf: (() => {
  const perfLog = createKvPerfLogAdapter();
  // The template src/data/perf/tasks-benchmark.ts, bound to the device's real driver and files.
  const openBenchmark = createTasksBenchmarkOpener({
    openDriver: createExpoSqliteSqlDriver,
    files: createExpoFileSystemDatabaseFilesAdapter(),
    clock,
    errorLog,
  });
  const actions = createPerfDebugActions({ perfLog, perf, openBenchmark });
  return { perfLog, actions };
})(),
```

`createTasksBenchmarkOpener` opens the scratch file with the app's own data layer (the open path of
persistence-and-migrations, `perf-bench.db` instead of `app.db`), seeds the largest realistic data
with `seedLargestRealisticTasks` (the seed the Jest guard uses too), and returns `{ write, close }`,
where `write` is the app's per-change write (here: toggle one task) and `close` deletes the scratch
file, so every run starts from the same data. An app with other data replaces the seed and the write
in that one file.

## 5. Frame runners feed the recorder

```ts
// a canvas surface (skia-canvas-rendering)
useSurfacePlayer({ ...input, onFrameTime: recorder === null ? undefined : (dt) => {
  'worklet';
  sampleFrame(recorder, dt);
} });
```

`recorder` is `TEST_ONLY?.perf.actions.frames ?? null`.

## 6. Declare it

```json
// contracts/perf.json
{
  "$schema": "./perf.schema.json",
  "layer": {
    "jsEntryFile": "src/app/_layout.tsx",
    "firstScreenFiles": ["src/features/tasks/use-tasks-model.ts"],
    "testOnlyEntry": "src/test-only-entry.ts",
    "nativeModuleDir": "modules/process-start"
  },
  "canvasBudgetExempt": []
}
```

Then rebuild natively (an EAS build, or `npx expo prebuild --clean` and a local build) so the
`ProcessStart` module links, and run `check-perf-code.mjs .` until it prints `RESULT: PASS`.
