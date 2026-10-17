# The Result spine: mechanism, Result, failures, exhaustive handling, messages

Verified on 2026-10-03 against TypeScript 6.0.3, typescript-eslint 8.70.1 and the canonical ESLint config
(re-verify: `npx tsc --version`, `npm ls typescript-eslint`, and a planted switch in the probe below).

## Contents

1. Pick the mechanism
2. The Result type and why it looks like this
3. attempt and attemptAsync
4. Designing a failure family
5. Layering failures across boundaries
6. Handling every failure
7. Never dropping a Result
8. From failure to message
9. Pitfalls

## 1. Pick the mechanism

Ask one question first: **can this happen in a correct program?**

| Situation | Mechanism | Examples (Tasks app) |
|---|---|---|
| Expected failure with reasons | return `Result<T, F>`; `F` is a `kind` union | duplicate task title, storage full, offline, sign-in cancelled, corrupt row |
| Expected absence, no reason needed | return `T \| null` | `findTask(id)` finds nothing; a hit test misses |
| The throw is the answer (a parser, a validator, a feature probe) | convert with `attempt(...)` and read `.ok` / `.value`; never a swallowing `catch` | `isValidUrl(raw)`, `canSegmentWords()`, a schema probe |
| Broken invariant, contract misuse, impossible state | `throw new Error(message, { cause })` | a hook used outside its provider; a config value outside its union |
| Render error | the route's `ErrorBoundary` records it and shows the crash screen (the only place it is recorded: render errors never reach the net) | a component reads an undefined field |
| Anything else nobody caught | the global error net records it | a throw in an `onPress`, an unhandled rejection |

The line between "expected" and "bug" is about **who owns the cause**. The environment (the disk, the
network, the OS, the user's input, a store SDK) owns expected failures: they will happen on real devices,
so they are values the caller must handle. The code owns invariants: when one breaks, the program is
wrong, and the right reaction is a loud failure in development and a recorded crash in production, not a
branch every caller writes.

When a vendor call answers by throwing (`new URL(raw)`, `new Intl.Segmenter(...)` on an engine without
it, a statement probing an old schema), the throw is the expected answer, not a defect: convert it, and
do not record it (rule 6). `attempt` does that without a hand-written catch, so nothing looks like a
swallow:

```ts
export function isValidUrl(raw: string): boolean {
  return attempt(() => new URL(raw), () => ({ kind: 'invalid-url' }) as const).ok;
}
```

Two consequences:

- A function that returns `Result` does not also throw for expected failures. A thrown expected failure
  either crashes (an event handler) or is swallowed by a caller that never expected it.
- Pure code in `src/core/` stays total: every input gets a value, uncertainty is an explicit output (a
  `kind`, a clamped number, `null`). It throws only for a broken invariant.

## 2. The Result type and why it looks like this

The canonical file is `src/core/result.ts` (this skill's template, synced into the app once):

```ts
export type Result<TValue, TError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError };

export function ok<TValue>(value: TValue): Result<TValue, never>;
export function err<TError>(error: TError): Result<never, TError>;
export function attempt<TValue, TError>(run: () => TValue, toFailure: (thrown: unknown) => TError): Result<TValue, TError>;
export async function attemptAsync<TValue, TError>(task: () => Promise<TValue>, toFailure: (thrown: unknown) => TError): Promise<Result<TValue, TError>>;
```

Why this shape and not another:

- **A discriminated union on `ok`.** `if (!result.ok) return result;` narrows both branches with no helper.
  TypeScript checks every access; `result.value` does not exist until `ok` is known to be `true`.
- **Plain data, not a class.** Results compare with `toStrictEqual` in tests, cross a worklet or a
  serialization boundary unchanged, and need no `instanceof` (which fails across JavaScript realms, see
  section 9). The React Compiler treats them as ordinary values.
- **Zero dependencies and one shape.** A second Result (neverthrow, fp-ts `Either`, Effect, ts-results, a
  home-grown `Outcome<T>`) forces adapter code between the two and splits the team's vocabulary.
  `check-error-spine` refuses both a second Result/Either type and an import of a known result library
  (`single-result`).
- **`ok`/`err` return `Result<T, never>` / `Result<never, E>`.** They widen into any compatible Result, so
  a function's declared return type does the checking.
- **When multi-package:** the Result module lives once, in the TypeScript-source core package
  (`packages/core/src/result.ts`, imported as `@<org>/core/result`), and every app and package imports
  it from there; a package never ships its own copy.
- **The operator set stays small on purpose.** Narrowing with `if (!result.ok)` reads better in
  TypeScript than `map`/`flatMap` chains, needs no learning, and keeps stack traces flat. Add a helper
  only when three call sites need it, in this file, with a test.

## 3. attempt and attemptAsync

They are the boundary's tools: one vendor call, one mapper.

```ts
const stored = attempt(() => driver.run(INSERT_TASK, [id, title]), toStorageFailure);
const pulled = await attemptAsync(() => api.get('/tasks'), toSyncFailure);
```

- `attemptAsync` takes a **function**, not a promise. A call that throws synchronously before it returns
  its promise (a bad argument, a missing native module) is converted too; `attemptAsync(api.get(...))`
  would throw past it.
- The mapper must be **total**: it receives `unknown` and must never throw. Read fields with `typeof`
  and `Reflect.get`, not casts (section 9). A throwing mapper turns `attemptAsync` back into a rejection.
- Use them only around the dangerous call, never around app logic: wrapping a whole function body hides
  bugs as expected failures.

## 4. Designing a failure family

```ts
export type TaskFailure =
  | { readonly kind: 'task-not-found'; readonly taskId: string }
  | { readonly kind: 'task-title-taken'; readonly title: string }
  | { readonly kind: 'task-title-empty' }
  | { readonly kind: 'storage-full' }
  | { readonly kind: 'storage-busy' }
  | { readonly kind: 'storage-unavailable'; readonly code: number | null };
```

- **`kind` is a stable kebab-case literal.** The canonical ESLint config already rejects a non-kebab
  `kind` value (`kindValue`, `kindTypeValue`). Stable means: a kind is never renamed once shipped,
  because logs, analytics and tests name it.
- **Params are typed data the screen or a test needs**: ids, limits, the conflicting title, a numeric
  code. Never the message a person reads. A message baked into the failure is English in an Arabic UI,
  cannot use ICU plurals or the user's digits, and drifts from the catalog. `check-error-spine` refuses a
  `message` (and similar) field in a `*Failure` type and literal UI text in an `err({...})`
  (`failure-text`). A task's `title` param is the user's data, not UI text, and is fine.
- **Never a string, a number or an `Error` as the failure** (`failure-shape`). A string cannot be
  switched on exhaustively; an `Error` subclass hierarchy cannot be checked for completeness, is not
  serializable, and breaks `instanceof` across realms. `Result<T, string | Error | unknown | any>` is
  refused for the same reason, and so is a bare string-literal union (`Result<T, 'empty' | 'offline'>`):
  it cannot gain a param later without touching every site; `{ kind: 'empty' }` can.
- **One family per boundary.** `TaskFailure` for the task repository, `SyncFailure` for the sync adapter,
  `PurchaseFailure` for the purchase port. A family stays small enough to switch on fully (4 to 10
  kinds). A shared catch-all kind (`storage-unavailable`, `unknown`) carries a machine code and means
  "the raw error was recorded in the error log".
- Keep the kinds as data when tests or catalogs need to enumerate them:
  `export const TASK_FAILURE_KINDS = [...] as const satisfies readonly TaskFailure['kind'][];`

## 5. Layering failures across boundaries

Each layer names failures in its own words, once:

```
expo-sqlite throws Error("... Error code 19: UNIQUE constraint failed: tasks.title")          iOS
                   Error("... Error code \u0013: UNIQUE constraint failed: tasks.title")     Android
  -> toStorageFailure(thrown)            { kind: 'constraint', detail: 'unique' }        src/data/
  -> toTaskFailure(storage, title)       { kind: 'task-title-taken', title }             src/data/tasks/
  -> taskFailureMessage(failure)         { key: 'tasks.error.title-taken', values }      src/features/tasks/
  -> t(key, values)                      "A task called Buy milk already exists."         the screen
```

The two device forms are read from expo-sqlite 57.0.3 source (iOS `SQLiteModule.swift` formats the
decimal; Android `NativeDatabaseBinding.cpp` appends the `int` code to a `std::string` as one character),
not observed on a device; boundaries-and-catches.md section 3 has the details. A mapper that reads only
the decimal turns every Android storage error into the catch-all kind.

- Propagate with narrowing: `if (!result.ok) return result;` when the error types match; map otherwise:
  `if (!result.ok) return err(toSyncFailure(result.error));`.
- A store or model hook never sees a vendor type, and a screen never sees a data-layer failure it was not
  given a message for.

## 6. Handling every failure

**A `switch` on `kind` is the default.** The canonical config sets
`@typescript-eslint/switch-exhaustiveness-check` with `considerDefaultExhaustiveForUnions: false`: a
`default:` does not excuse a missing case of a union (verified on 2026-10-03: a `switch` over
`number | null` with a `default` still failed with "Cases not matched: null"). Adding a kind is then a
lint error at every switch that must handle it.

```ts
switch (failure.kind) {
  case 'task-title-taken':
    return { key, values: { title: failure.title } };
  case 'task-not-found':
  case 'task-title-empty':
  case 'storage-full':
  case 'storage-busy':
  case 'storage-unavailable':
    return { key, values: {} };
}
```

**A `Record<F['kind'], X>` table is the other default** (message keys, icons, retry policy):
`{ ... } as const satisfies Record<TaskFailure['kind'], string>` fails to compile until a new kind has an
entry.

**Not an `if/else` chain on kinds.** The final `else` silently absorbs every kind added later.
Comparing one kind in a guard is fine (`if (failure.kind === 'storage-unavailable') record(...)`) when the
other kinds genuinely need nothing.

`noFallthroughCasesInSwitch` (tsconfig) still allows grouped empty cases, as above.

## 7. Never dropping a Result

ESLint's `no-floating-promises` sees a dropped `Promise`, never a dropped `Result`: `await save(task);`
compiles, lints clean and loses the failure. These shapes slip through every lint rule:

| Code | ESLint | check-error-spine |
|---|---|---|
| `repository.add(draft);` (sync Result) | nothing | `result-ignored` |
| `await sync.pull();` (`Promise<Result>`) | nothing (it is awaited) | `result-ignored` |
| `if (title !== '') repository.add(draft);`, `else repository.rename(id, title);`, `for (const t of titles) repository.add(t);`, `case 'add': repository.add(draft); break;` | nothing (`curly` is off) | `result-ignored` |
| `onPress={() => repository.add(draft)}` | nothing (the arrow returns it) | `result-ignored` |
| `titles.forEach((title) => repository.add({ id: title, title }));` | nothing | `result-ignored`: forEach throws every Result away, the silent batch data loss of rule 12 |
| `const result = repository.add(draft); if (!result.ok) ...` | | handled |

A batch write loops with `for...of`, branches on each Result, and reports what failed (or stops at the
first failure inside a transaction); `const results = titles.map(...)` is fine when the results are read.

The structural fix for handlers: a screen calls a **void intent** of its model hook (`model.add()`), and
the hook handles the Result. The checker indexes every function, method and port member whose declared
return type is `Result<...>` or `Promise<Result<...>>`, **with its owner**: a free function, a member of a
type, interface or class (`TaskRepository.add`), or a member of an object bound to a const. It flags a
call that starts a statement (after `;`, `{`, `}`, a `case`/`default` label, the `)` of an `if`, `for`,
`while` or `with` head, `else` or `do`) and ends at its `;`, the expression body of an arrow handed to
`forEach`, or an `on*` arrow body (`() => ...`, `(text) => ...`, `() => void ...`):

- a call without a receiver (`save(task);`) only when that function is declared in the same file or is a
  named import (`import { save }`, also `{ save as store }`, also through a barrel's `export { save } from`)
  of the file that declares it; never when the file binds the name itself (a local function, a `const`, a
  destructured name, a parameter), so a `refresh()` in a settings hook is not the Result-returning
  `refresh()` some other module declares;
- a call on a namespace import (`import * as tasks ...; tasks.refresh(raw);`) when that module exports the
  Result function;
- a call on a receiver (`repository.add(draft);`) only when the receiver is known to hold the owner: it
  is annotated with the owner type in the same file (`repository: TaskRepository`, including a props type
  property), created from it (`= createTaskRepository(...)`, `new TaskStore()`), named like an instance of
  it (`taskRepository`, `repository`; `sync` for a `SyncPort`), or is the owning variable itself.

So `selected.add(id)` on a `Set` and `positions.set(id, n)` on a `Map` never match a Result-returning
`TaskRepository.add`. Exported functions have explicit return types (lint), so the index is reliable.

## 8. From failure to message

- One table per failure family maps each kind to a catalog key; params become ICU values, never
  concatenated text: `examples/tasks/task-failure-message.ts`.
- `check-error-spine` reads every `Record<X['kind'], ...>` table and fails when a value is not a key of the
  source catalog (`failure-message-key`; default `src/i18n/catalogs/en.json`, or `--catalog`, or the
  `sourceCatalog` key of `rn-skills.config.json`). The i18n checker cannot see these keys: they are not
  literal `t('...')` calls.
- A unit test proves every kind has a message in every locale (recipe in `test-recipes.md`).
- The UI never renders `error.message`, `String(error)` or `${error}` (`ui-error-message`): that text is
  English, technical and sometimes holds user data (a file path, an email). It goes to the error log.
- How the message is shown (inline, banner, dialog, Undo) belongs to `ui-states-and-feedback`.

## 9. Pitfalls

- **`instanceof Error` fails across realms.** Verified on 2026-10-03: an error thrown by `node:sqlite`
  inside a jest-expo test is not `instanceof Error` in the test's realm. Native-module errors can behave
  the same. A mapper reads `Reflect.get(thrown, 'message')` / `'code'` with `typeof` checks.
- **`catch (error)` is `unknown`** (`useUnknownInCatchVariables`): narrow before reading anything.
- **`JSON.parse` throws `SyntaxError`**: parse outside input with `attempt(() => JSON.parse(raw), ...)`
  and validate the result with valibot's `safeParse`, mapping issues to a failure (the issue path and
  type, never the issue message text).
- **Only `Error` objects are thrown** (`@typescript-eslint/only-throw-error`); a thrown string loses its
  stack and reaches React Native's handler as a "SyntheticError".
- **`err(...)` as a statement** is dropped like any Result; the checker flags it.
