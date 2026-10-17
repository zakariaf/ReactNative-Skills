# Converting at boundaries, and what every catch must do

Verified on 2026-10-03 by reading the installed sources of expo-sqlite 57.0.3, expo-modules-core 57.0.20,
expo-haptics 57.0.3, react-native 0.86.3 (whatwg-fetch) and by running node:sqlite on Node 26.4
(re-verify: `npm ls expo-sqlite expo-haptics react-native`, then reread the files and rerun the probes
quoted below). The device message forms are read from source, not observed on a device.

## Contents

1. Where the boundaries are
2. The conversion pattern
3. What vendors throw (verified shapes)
4. Recording: what, when, and what never
5. The three things a catch may do
6. Best-effort effects: the one licensed swallow
7. Timeouts are expected failures
8. Adapters: nothing escapes
9. Pitfalls

## 1. Where the boundaries are

A boundary is the one place that talks to something the app does not control. It converts every
exception from that thing into a typed failure, once, so nothing above it knows the vendor's error shapes.

| Boundary | Lives in | Converts |
|---|---|---|
| Port adapter (`<library>-<concern>-adapter.ts`) | `src/services/<concern>/` | SDK rejections and error codes (StoreKit, Play Billing, AdMob, haptics, notifications) |
| Repository | `src/data/` | SQLite errors from the `SqlDriver` (persistence-and-migrations owns the driver) |
| ApiClient | `src/api/` | `fetch` rejections, HTTP status, invalid bodies (networking-and-server-state owns the client) |
| Parser of outside input | next to its caller | `JSON.parse`, deep-link params, a pasted value, a file (valibot `safeParse`) |
| Native module call | its adapter | `CodedError` from Expo modules |

Above the boundaries (stores, model hooks, screens) nothing catches vendor errors: there are none left.

## 2. The conversion pattern

```ts
add: (draft) => {
  const title = draft.title.trim();
  if (title === '') return err({ kind: 'task-title-empty' });            // validation: no throw involved
  const task: Task = { id: draft.id, title, isDone: false };
  return attempt(() => {
    driver.run(INSERT_TASK, [task.id, task.title]);
    return task;
  }, failWith(title));                                                    // every throw becomes a TaskFailure
},
```

```ts
const failWith = (title: string) => (thrown: unknown): TaskFailure => {
  const failure = toTaskFailure(toStorageFailure(thrown), title);
  if (failure.kind === 'storage-unavailable') errorLog.record('storage', thrown);   // unexpected: record first
  return failure;
};
```

The full shapes: `examples/tasks/task-repository.ts`, `examples/tasks/to-storage-failure.ts` and its test
on real `node:sqlite` errors.

## 3. What vendors throw (verified shapes)

| Source | What arrives in `catch` | How to read it |
|---|---|---|
| expo-sqlite 57, iOS | an `Error` with `code` `ERR_INTERNAL_SQLITE_ERROR`; the message ends in `Error code 19: UNIQUE constraint failed: tasks.title` (`ios/SQLiteModule.swift` line 479, `convertSqlLiteErrorToString`, formats `"Error code \(code): \(message)"`) | the decimal after `Error code `, then `code & 0xff` |
| expo-sqlite 57, Android | the same `code`; the message ends in `Error code \u0013: UNIQUE constraint failed: tasks.title`: the code arrives as **one character** (`android/src/main/cpp/NativeDatabaseBinding.cpp` line 198, in `convertSqlLiteErrorToSTLString`, does `result += code;` with an `int`, which `std::string` takes as `operator+=(char)`; `clang++ -Wconversion` reports the int-to-char conversion, and that line compiled with Xcode 26.6's clang writes the byte 0x13 for code 19) | the character's code point; `/Error code (?:(\d+)\|([\s\S])):/` reads both platforms |
| either platform, no code readable | the message still holds SQLite's own `sqlite3_errmsg` text | fall back to the stable texts: `constraint failed` (19), `database or disk is full` (13), `database is locked` (5), `database table is locked` (6), `database disk image is malformed` (11), `file is not a database` (26) |
| node:sqlite (Jest, Node 26.4) | an `Error` with `code` `ERR_SQLITE_ERROR`, numeric `errcode` (extended: 1555 = primary-key clash, 1299 = NOT NULL, 787 = foreign key), `errstr` | `errcode & 0xff`; message `UNIQUE constraint failed: tasks.id` |
| Expo modules (`CodedError`) | an `Error` with a string `code` (`ERR_...`) and optional `info` | switch on `code`; unknown codes map to the catch-all kind and are recorded |
| `fetch` (whatwg-fetch inside React Native 0.86) | `TypeError('Network request failed')`, `TypeError('Network request timed out')`, `DOMException` named `AbortError` | offline and timeout are expected kinds; `AbortError` means the caller cancelled (not a failure to show) |
| `JSON.parse` | `SyntaxError` | `attempt(() => JSON.parse(raw), () => ({ kind: 'malformed' }))` |
| valibot `safeParse` | no throw: `{ success: false, issues }` | map issue paths and types to a failure; never surface issue messages |

SQLite primary codes worth naming: 5 BUSY, 6 LOCKED, 11 CORRUPT, 13 FULL, 19 CONSTRAINT, 26 NOTADB.
expo-sqlite does not turn on extended result codes on either platform, so its code is already the
primary one (and on Android every primary code is below 32, a control character). The Android form is a
bug in expo-sqlite, not a contract: a mapper that reads only `\d+` turns every Android constraint, full,
busy or corrupt error into the catch-all kind (and records it as unexpected), so a duplicate title shows
"storage unavailable". Keep a test for each form (`examples/tasks/to-storage-failure.test.ts` rebuilds
both from real node:sqlite errors) and reread the two files after an expo-sqlite upgrade.

The probes that produced the node:sqlite rows (Node 26.4):

```sh
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE t(id TEXT PRIMARY KEY)');d.prepare('INSERT INTO t VALUES (?)').run('a');try{d.prepare('INSERT INTO t VALUES (?)').run('a')}catch(e){console.log(e.code,e.errcode,e.message)}"
# ERR_SQLITE_ERROR 1555 UNIQUE constraint failed: t.id
# Also observed: PRAGMA max_page_count reached -> 13 "database or disk is full"; a write while another
# connection holds BEGIN EXCLUSIVE (timeout 0) -> 5 "database is locked"; a junk file -> 26 "file is not a
# database"; a foreign key with PRAGMA foreign_keys = ON -> 787 "FOREIGN KEY constraint failed".
```

## 4. Recording: what, when, and what never

- **Record unexpected failures, with the original error, before returning the typed failure.** After the
  conversion only `{ kind, params }` exists; the stack and the vendor message survive only in the log.
- **Do not record expected failures.** A duplicate title or an offline request is the user's situation,
  not a defect; recording it floods the log and hides real faults.
- Record through the error log port (`ErrorLogPort.record(source, error)`, owned by
  architecture-and-boundaries). Its `record` is synchronous and never throws, so it is safe in any catch
  and inside the global handler.
- Never record personal data as a param or a message: task titles, notes, emails and tokens stay out of
  logs. The error log and crash-reporting-and-observability own scrubbing; the boundary helps by
  recording the error object, not a message built from user input.

## 5. The three things a catch may do

Every `catch` block and every `.catch(...)` handler does exactly one of (console output and
debug-level logs do not count: nobody reads them on a user's phone):

1. **Map** the error to a `Result` or a typed state: `return err(toTaskFailure(error));`
2. **Record** it through the error log and continue with a defined fallback:
   `errorLog.record('sync', error); return cachedTasks;`
3. **Rethrow** it with context and the original as `cause`:
   `throw new Error('migrating tasks to v4 failed', { cause: error });`

What `check-error-spine` refuses:

| Code | Rule | Why |
|---|---|---|
| `catch {}` | ESLint `no-empty` | nothing happens |
| `catch { /* ignore */ }` | `catch-handled` | ESLint accepts a comment-only block; the error still vanishes |
| `catch (error) { console.warn(error); }` | `catch-handled` | console output reaches neither the error log nor the developer; on a user's phone nobody reads it |
| `catch { return; }` | `catch-handled` | returns nothing: the caller cannot tell success from failure |
| `catch { return null; }` around a read | `catch-handled` | a failure becomes "not found"; the error is gone (map it with `err(...)`, or record it) |
| `catch (error) { console.error('listing failed', error); return []; }` | `catch-handled` | the most common real swallow: the fallback is fine, the console is not a record |
| `catch (error) { logger.debug(error); return 0; }` | `catch-handled` | debug and trace levels are dropped in release builds |
| `catch (error) { if (error instanceof X) return false; return false; }` | `catch-handled` | testing the error passes nothing on |
| `.catch(() => undefined)`, `.catch(() => {})`, `.catch(console.error)`, `.catch(() => setStale(true))` | `catch-handled` | the rejection is dropped (the last one keeps a flag, loses the error) |
| `throw new Error('save failed')` in a catch | `rethrow-cause` | the original error and its stack are lost |
| `throw new Error(error.message)` | `rethrow-cause` | same: a new stack, the original gone |

**When the throw is the answer** (a parser, a validator, a feature probe), there is nothing to record:
the throw is the expected outcome. Convert it instead of catching it, and read the Result:

```ts
const isValidUrl = (raw: string): boolean =>
  attempt(() => new URL(raw), () => ({ kind: 'invalid-url' }) as const).ok;

function schemaBuiltBy(build: (driver: SqlDriver) => boolean): readonly SqlRow[] | null {
  const reference = openDriver(':memory:');
  try {
    // A variant that does not execute matches nothing: that is the answer, not a defect.
    const built = attempt(() => build(reference), () => ({ kind: 'variant-failed' }) as const);
    return built.ok && built.value ? schemaOf(reference) : null;
  } finally {
    reference.close();
  }
}
```

`catch { return false; }` around the same call fails `catch-handled`, because the checker cannot tell a
probe from a swallowed defect; `attempt` says which one it is. Recording such a failure would be wrong
too (rule 6: a log full of expected failures hides real defects).

What counts as handled: the body throws, calls `err(...)`, or passes the caught value on: to a call
(`errorLog.record('sync', error)`, `toFailure(error)`, `reject(error)`, `setState(toState(error))`), or
returned or assigned as a whole value (`return { kind: 'failed', cause: error }`). A catch without a binding
(`catch { ... }`) can only map with `err(...)` or throw: `catch { return err({ kind: 'malformed' }); }` is
fine, `catch { return cachedTasks; }` is not (bind the error and record it before returning the fallback).

Rethrowing the same value (`throw error;`) keeps its stack in JavaScript and is fine, though wrapping with
a sentence of context is usually better. Fire-and-forget work ends in `.catch(reportError)`, where
`reportError` records through the error log; async-safety owns the floating-promise rules.

## 6. Best-effort effects: the one licensed swallow

A cosmetic effect whose failure costs nothing (a haptic tap, a sound cue, a review prompt) may ignore its
failure, **inside its adapter only**, with a comment saying why on the `.catch` line or the line above:

```ts
tap: () => {
  // best-effort: haptics are decoration; a missed tap costs the user nothing.
  impactAsync(ImpactFeedbackStyle.Light).catch(() => undefined);
},
```

Why it can reject at all (expo-haptics 57.0.3, read from source): the JS wrapper throws
`UnavailabilityError` when the optional native module is missing (a development build made before
expo-haptics was added), and on Android the native call fails with a lost React context during a reload.
iOS `impactAsync` never rejects for Low Power Mode, and web implements it with `navigator.vibrate`. Write
the reason you verified, not a guess: the comment is the only review the swallow gets.

The error log adapter's own `record` is the other licensed case: it runs inside catches and inside the
global handler, so it must never throw, and there is nowhere left to report its own failure:

```ts
record: (source, error) => {
  try {
    insert(source, error);
  } catch {
    // best-effort: the error log must never throw; there is nowhere left to record this.
  }
},
```

`check-error-spine` accepts the `// best-effort:` marker in a `*-adapter.ts` file and reports it anywhere
else (`catch-handled`). Prefer recording the first such failure per session when the effect matters to
someone (audio-and-haptics-feedback decides for its cues).

## 7. Timeouts are expected failures

An awaited SDK call that can hang (a store product query, a network request without its own timeout)
gets a deadline in its adapter, and running out of time is a `timed-out` kind, not an exception. Use
async-safety's canonical `withTimeout` (`src/services/async/with-timeout.ts`; async-safety owns it and
its tests, so copy it from that skill rather than writing a local one):

```ts
withTimeout((signal) => Promise<Result<TValue, TError>>, afterMs, signal?)
// -> Promise<Result<TValue, TError | { kind: 'timed-out'; afterMs } | { kind: 'cancelled' }>>
```

The task receives a signal that aborts when the deadline passes or the caller's own `signal` aborts
first, so the abandoned work is cancelled instead of finishing (and writing) later. Pair it with
`attemptAsync` so the task itself never rejects, and hand the signal to the work:

```ts
fetchProducts: (ids, signal) =>
  withTimeout(
    (taskSignal) => attemptAsync(() => api.get('/products', { ids, signal: taskSignal }), toStoreFailure),
    8_000,
    signal,
  ),
```

`timed-out` is a failure to show (with a retry); `cancelled` means the caller left and is never shown or
recorded (async-safety owns that rule; a catch shaped `if (signal.aborted) return; record(error)` passes
`catch-handled`). An SDK call that takes no signal still gets the deadline, and its losing promise keeps
running, so it must be safe to abandon.

## 8. Adapters: nothing escapes

`check-error-spine` checks every `await` in `src/services/<concern>/*-adapter.ts`: it must sit inside a
`try` block that has a `catch`, await `attemptAsync(...)` / `withTimeout(...)`, or sit inside the
arguments of one of those calls, which is the usual shape (`adapter-boundary`):

```ts
pull: () =>
  attemptAsync(async () => {
    const response = await fetch(url);          // both awaits run inside the task attemptAsync guards
    return toCount(await response.json());
  }, toSyncFailure),
```

A rejection that escapes an adapter reaches a caller that expects a `Result`, becomes an unhandled
rejection, and is dropped silently in a release build unless the error net tracks it.

What the checker cannot see, and review must: a vendor promise returned without `await`
(`return sdk.load();`), a synchronous vendor call that throws (expo-sqlite's sync API, a native module),
and an `await` inside a nested function defined in a `try` but run later.

## 9. Pitfalls

- **Wrapping the whole function in `try`.** It turns bugs (a typo, a null access) into "storage
  unavailable". Wrap the vendor call only.
- **A mapper that throws.** `toFailure` runs inside the catch; a throw there escapes `attempt`. Read with
  `typeof` and `Reflect.get`, never `(thrown as Error).message`.
- **Catching to retry forever.** A retry loop without a limit and a delay is a busy loop; networking
  retries belong to TanStack Query's retry policy (networking-and-server-state).
- **Treating `AbortError` as a failure.** A cancelled request (screen left, newer query) is not shown and
  not recorded.
- **Converting twice.** A repository that calls an adapter receives a `Result`; it maps the failure
  (`err(toTaskFailure(result.error))`), it does not wrap the call in another `try`.
