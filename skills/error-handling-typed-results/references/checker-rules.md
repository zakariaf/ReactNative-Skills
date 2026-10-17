# The checkers: rules, limits and configuration

Both checkers are zero-dependency Node scripts on check-lib. Run them from the app repo root:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-error-spine.mjs .      # the Result/failure spine
node ${CLAUDE_SKILL_DIR}/scripts/check-error-net.mjs .        # the global error net and root boundary
```

Exit 0 pass (SKIP and NOT APPLICABLE included), 1 problems, 2 bad input. Each problem line is
`FAIL <file>:<line> [<rule>] <message> Fix: <fix>`; the last line is `RESULT: PASS` or
`RESULT: FAIL (<n> problems)`. Both are heuristic source scans (comments and strings are blanked first);
they catch what a reviewer would otherwise check by eye, not everything.

## Contents

1. Configuration
2. check-error-spine rules
3. check-error-net rules
4. SKIP and NOT APPLICABLE
5. When a finding is wrong
6. Known conflicts with other skills' canonical code

## 1. Configuration

| Setting | Default | Override |
|---|---|---|
| App source folder | `src` | `--src-dir <dir>` or `rn-skills.config.json` `"srcDir"` |
| Routes folder | `src/app` (or `app/` when only that exists) | `--routes-dir <dir>` or `"routesDir"` |
| The Result module | `<coreDir>/result.ts` (`src/core/result.ts`) | `--result-module <file>` or `"resultModule"` (read by this skill), or move `"coreDir"` |
| Services folder (adapters at `<servicesDir>/<concern>/*-adapter.ts`) | `src/services` | `"servicesDir"` |
| Features folder (model hooks `use-*.ts`) | `src/features` | `"featuresDir"` |
| Source catalog for failure-message keys | `<i18nDir>/catalogs/en.json` | `--catalog <file>` or `"sourceCatalog"` (read by this skill) |

`rn-skills.config.json` is the optional repo file every skill's checkers read through check-lib's
`resolveLayout()`; `sourceCatalog` and `resultModule` are the keys this skill adds.

### When multi-package

Run both checkers once per app: `node ${CLAUDE_SKILL_DIR}/scripts/check-error-spine.mjs . --src-dir
apps/<app>/src --catalog apps/<app>/src/i18n/catalogs/en.json --result-module packages/core/src/result.ts`
and `check-error-net.mjs . --src-dir
apps/<app>/src --routes-dir apps/<app>/src/app`. Shared packages are checked by the spine checker with
`--src-dir packages/<pkg>/src --result-module packages/core/src/result.ts` (their adapters and
failures follow the same rules); the net belongs to each app.

## 2. check-error-spine rules

| Rule | Fails when | Fix |
|---|---|---|
| `result-module` | `src/core/result.ts` is missing, or lacks `export type Result<...>` with `ok: true` / `ok: false`, `export function ok`, `export function err` | copy `templates/src/core/result.ts` |
| `single-result` | another `type`/`interface`/`class` named `Result` or `Either`, or an import of a result library (neverthrow, ts-results, true-myth, fp-ts Either/TaskEither, oxide.ts, @badrap/result, purify-ts, option-t, typescript-result, better-result, effect) | import from `@/core/result` |
| `failure-shape` | `err('...')`, `` err(`...`) ``, `err(42)`, `err(new Error(...))`, `err(null)`, `err(undefined)`; a `Result<T, E>` whose error type is, or is a union with a member that is, `string`, `String`, `Error`, `TypeError`, `RangeError`, `SyntaxError`, `unknown`, `any`, `object`, `{}`, `null`, `undefined` or `void` (`Result<T, string \| Error>`, `Result<T, TaskFailure \| null>`); a string-literal union as the error type | a `{ kind, params }` failure |
| `failure-text` | an `err({...})` literal with `message`, `title`, `text`, `label`, `description` (and similar) set to a string literal or a `t(...)`/`formatMessage(...)` call; any other key (except `kind`) whose literal value reads as a sentence: it has a space and ends in `.`, `!`, `?` or `…`, or starts with a capitalised word and more words (`reason: 'This task is locked.'`, `hint: 'Try again later'`); a `type XFailure` with a `message`-like field. Codes stay silent (`detail: 'unique'`, `column: 'tasks.title'`) | kind + typed params; message keys at the edge |
| `catch-handled` | once `console.*` calls and debug-level logs (`<x>.debug/trace/verbose(...)`) are removed, a catch block or `.catch` handler that neither throws, nor calls `err(...)`, nor passes the caught value on (to a call, or returned or assigned as a whole value). That covers empty, comment-only and console-only bodies, `catch { return null; }`, `catch { return false; }` around a probe, `catch (error) { console.error(..., error); return []; }`, `catch (error) { logger.debug(error); return 0; }`, `.catch(() => undefined)` and `.catch(() => setStale(true))`; a `.catch` given a function named `noop`/`ignore*`/`swallow*`/`console.*`; and a `// best-effort:` marker outside a `*-adapter.ts` | when the throw is the expected answer (a parser, validator or feature probe): `attempt(() => new URL(raw), () => ({ kind: 'invalid-url' }) as const)` and read `.ok` / `.value` (boundaries-and-catches.md section 5); otherwise map, record the unexpected error with a fallback, or rethrow with `cause` |
| `rethrow-cause` | `throw new SomeError(...)` inside a catch block or `.catch` handler without `cause` in its arguments | `throw new Error('context', { cause: error })` |
| `adapter-boundary` | an `await` in `src/services/<concern>/*-adapter.ts` outside a `try` that has a `catch`, unless it awaits `attemptAsync(...)` or `withTimeout(...)` or sits inside the arguments of such a call (the task callback: `attemptAsync(async () => { const r = await fetch(url); return await r.json(); }, toFailure)` passes) | move the awaits into the task `attemptAsync` runs |
| `result-ignored` | a call to a function, method or port member declared to return `Result<...>` / `Promise<Result<...>>` that is a whole statement (`save(task);`, `await sync.pull();`, `void save(task);`, also right after a `case`/`default` label, the `)` of an `if`/`for`/`while`/`with` head, `else` or `do`: `if (ok) save(task);`), the expression body of an arrow handed to `forEach` (`titles.forEach((title) => repository.add(...))`, `async (t) => await ...` too), or the body of an `on*` arrow (`() => ...`, `(text) => ...`, `() => void ...`). A call without a receiver counts only when the file declares that Result function or imports it by name from the declaring file (aliases and one barrel re-export followed), and never when the file binds the name itself (a local function, `const`, destructured name or parameter); a call on a namespace import counts when that module exports it; a call on any other receiver only when the receiver is known to hold the member's owner (annotated or created with the owner type in the file, named like an instance of it, or the owning const); see result-and-failures.md section 7 | bind it and branch on `ok`; handlers call a void intent |
| `ui-error-message` | in a `.tsx` file or a `src/features/**/use-*.ts` hook: `error.message` (also `err`, `e`, `failure`, `cause`, `reason`, `thrown`, `caught`, `result.error.message`), `String(error)`, `` `${error}` ``, except as the key a translation call receives: the first argument of `t(...)` (`t(fieldState.error.message ?? 'forms.field.invalid')`) or the `id` of `formatMessage({ id })`. Passed as a value (`t('x', { detail: error.message })`) it still fails | a message key from the failure table |
| `failure-message-key` | a value of a `Record<X['kind'], ...>` table (annotated or `satisfies`) is not a key of the source catalog | add the key to every locale, or point the kind at an existing key |
| `no-destructive-recovery` | `deleteDatabase*()`, `.clear()`, `.clearAll*()`, `removeItem*()`, `deleteItemAsync()`, `.deleteAsync()`, `.delete()`, `reset*()`, `wipe*()`, `purge*()`, or SQL `DROP TABLE` / `DELETE FROM` / `TRUNCATE` inside a catch block, a `.catch` handler or a failure branch | keep the data (see never-lose-data.md) |

Known limits:

- `result-ignored` indexes declared return types. A member whose Result type is only inferred (an object
  literal without an annotated type), a destructured member (`const { add } = repository; add(x);`), a
  default import, and a receiver whose owner type is declared in another file under an unrelated name are
  not seen. Statement forms it does not see: a short-circuit or ternary statement (`isReady &&
  repository.add(x);`, `cond ? save(a) : save(b);`), a comma expression, a `.map(...)` whose array of
  Results is itself a bare statement, `.then(() => repository.add(x))`, and a block-bodied callback that
  returns the Result to a caller who drops it (`items.some(...)`). Each is rare in code that passes the
  canonical lint (`no-unused-expressions` reports the first three); review them by eye. A function name shared by unrelated modules (`load`, `save`, `refresh`, `validate`) is
  resolved through the file's own imports and declarations, so it never collides. A built-in collection
  (`Set.add`, `Map.set`, `Array.push`) is never flagged unless its receiver is named like the port
  (`repository.add` on a variable that really is a `Set` would be: rename the variable).
- `ui-error-message` and forms-and-input: with react-hook-form and the valibot resolver, a field error's
  `message` is whatever the schema says. When the schema's messages are catalog keys, translate them
  (`t(fieldState.error.message ?? 'forms.field.invalid')`), which passes; showing `fieldState.error.message` as
  is fails, because then it is either English or a raw key.
- `catch-handled` accepts a catch that passes the error to any call except console and debug-level logs,
  so `catch (error) { logger.warn(error); return []; }` passes: the checker cannot tell a real logger from
  a print. Review the logger; the error log port (`errorLog.record`) is the default. Passing the error to
  a call inside a condition (`if (isAbort(error)) return null;`) also counts as handled.
- Files under test folders (`*.test.ts(x)`, `__tests__/`, `__mocks__/`, `test/`) are skipped by every rule
  except the file count.

## 3. check-error-net rules

| Rule | Fails when | Fix |
|---|---|---|
| `net-single` | no app file calls `<x>.setGlobalHandler(...)`, or more than one does (the most net-like file is the net; the others are reported) | one net: `templates/src/services/error-net/` |
| `net-chains` | the net never calls `getGlobalHandler()`, or the function it gives `setGlobalHandler` (a local function by name, or inline) never calls the handler it kept (the variable assigned from `getGlobalHandler()`, or one alias of it such as `const previous = current[CHAINED] ?? current`), neither directly nor through one local function it calls. `setGlobalHandler(previous)` (the restore) is not judged | record, then call the previous handler |
| `net-rejections` | the net has no member access to `enablePromiseRejectionTracker` with an `onUnhandled`; or a development-only test (see below) governs code that tracks rejections (`enablePromiseRejectionTracker`, `enableRejectionTracker`, `rejectionOptions`, `onUnhandled`, `allRejections`) | track rejections in every build |
| `net-every-build` | the net module, the module that exports the `createErrorNet` instance, or the installer the entry imports contains any other development-only test (a flag such as `const isTracking = __DEV__;`, a `__DEV__` buffer size): code fed by such a flag is out of sight of the other rules | remove the test: the net behaves the same in every build |
| `net-guarded` | a call of the connected sink sits outside a `try` block that has a `catch`. The sink is `connect`'s parameter, a variable it is stored in (`sink = next`) and the parameter of any local function it is handed to (`deliver(next, report)` makes `deliver`'s first parameter a sink); a `try` elsewhere in the file does not count. Without a recognisable `connect`, the file needs some `try { ... } catch` | call the sink inside `try`/`catch` |
| `net-connected` | no app file other than the net calls `<instance>.connect(...)` on the instance the `createErrorNet` file exports (importing it, or being that file), and none passes the instance to a function imported from another file whose parameter at that position calls `.connect(...)` itself or hands the parameter on, once more, to a function that does (`connectErrorLog(appErrorNet, services.errorLog)`); a `.connect(...)` on anything else in that file (`socket.connect()`) does not count. A call under a development-only test counts as no call (the message says so). A net not built on `createErrorNet` passes when some file calls a `connect*` function the net module exports | connect in the composition root, before any provider renders, in every build |
| `net-installed` | the root layout (or a local `package.json` `main`, App.tsx/index.ts without Expo Router) does not start with a side-effect import of a module that calls `install*()` at module scope and reaches the net within three imports; or the import comes after a binding import; or the entry installs in its own body | `import '@/services/error-net/install-error-net';` first |
| `net-chains`, `net-installed` (guards) | a development-only test governs the global handler (`setGlobalHandler`, `getGlobalHandler`, a call of the kept previous handler: `if (__DEV__) previous(error, isFatal);`) or an install call (`if (__DEV__) appErrorNet.install();` in the installer) | remove the test |
| `root-boundary` | with expo-router: the root layout exports no `ErrorBoundary` (`export function`, `export const`, `export { X as ErrorBoundary }`); without it: no file implements `componentDidCatch` | export the boundary from the root layout |
| `boundary-records` | the boundary's implementation (followed through an import or re-export) calls no `record`/`report`/`log`/`capture` function and no `onError` (console calls do not count); or the root layout's `record:` option is a function whose body, once `console.*` calls are removed, calls nothing (`() => undefined`, `(error) => { console.warn(error); }`), or a reference named `noop`/`ignore*` | record once when it mounts, through the error net |
| `no-auto-retry` | inside `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask` or `setImmediate`: a call to `retry`, `restart`, `reset*`, `reload*` (`reloadAppAsync`), `onRestart`, `onAction`, `onRetry` or `onReset`, or a navigation away (`router.` / `navigation.` / `navigator.` / `nav.` + `replace`, `push`, `back`, `navigate`, `dismissAll`, `dismissTo`, `dismiss`, `reset`, `goBack`, `popToTop`); or one of those handed to a timer as a reference (`setTimeout(onRestart, 3000)`, `setTimeout(router.back, 2000)`). Checked in the boundary implementation and in the `Fallback` the root layout passes to it (through its import), plus the `.tsx` components that file imports | leave the fallback only from its button |

**Development-only tests.** `__DEV__` (also `!__DEV__`), `process.env.NODE_ENV !== 'production'`,
`process.env.NODE_ENV === 'development'` and their mirrored forms. The code a test governs: the whole `if`
statement (both branches) when it is an `if` head; the rest of the enclosing block when either branch is
only a `return` or `throw` (`if (!__DEV__) return;`); otherwise the enclosing statement, or the object
literal the test sits in (`enableRejectionTracker: __DEV__ ? fn : null`). In the net module, the instance
module and the installer every test is a problem (the rule follows what it governs, `net-every-build`
when it governs none of those); elsewhere only a test that governs the `connect` call matters. The net
templates contain none. Known limit: a flag read from another module (`import { isDebugBuild } from
'@/config/build'`) is not followed; keep build checks out of the net entirely.

## 4. SKIP and NOT APPLICABLE

| Line | When |
|---|---|
| `NOT APPLICABLE: react-native is not in package.json` | both checkers, when the repo is not a React Native app |
| `SKIP src/i18n/catalogs/en.json [failure-message-key] not yet created (i18n-strings-and-catalogs creates it)` | there are failure-message tables but no source catalog yet |
| `SKIP src/app/_layout.tsx [net-installed] not yet created (app-startup-and-bootstrap creates it)` and the same for `[root-boundary]` | expo-router is installed but the root layout does not exist yet |
| `SKIP src/app/_layout.tsx [net-connected] not yet created (app-startup-and-bootstrap creates it)` | the same, and no app file connects the net yet (the composition root runs from the root layout) |

A missing `package.json` or source folder is exit 2 (`ERROR [bad-input]`), never a pass.

## 5. When a finding is wrong

The checkers have no inline suppression, on purpose. When a finding is a false positive, change the
code so the intent is visible (rename a colliding method, move a legitimate cleanup out of the error path
into a named function, map the error before logging), or, if the rule itself is wrong for every app,
change the checker and its fixtures (one `bad-*` case per rule must keep failing).

One such case is deliberate: `no-destructive-recovery` flags any `.delete()` in a failure branch,
including deleting a temp file the same function just wrote (`.<name>.partial` after a failed atomic
move). The checker cannot tell the app's own scratch file from user data, and a rule that trusted the
file name would let a real delete through. Discard the temp file through a named helper (for
example `discardPartial(file)`) called in the `if (!moved.ok)` branch, as data-export-and-restore does: the
intent is visible and the rule stays strict.

## 6. Known conflicts with other skills' canonical code

Verified on 2026-10-03 by running both checkers over the library's reference app with every shared
canonical source file and the templates of architecture-and-boundaries, design-system-structure,
persistence-and-migrations and i18n-strings-and-catalogs, each at the path its first line names.
`check-error-net` passes there; `check-error-spine` reports the finding below until its owner changes
the file. Fix it in the app the way the right column says, and drop the row when the owner ships it.

| Finding | Owner | The change that makes it pass |
|---|---|---|
| `src/data/app-database.ts [catch-handled]` (`schemaBuiltBy`: `catch { return null; }` around a schema variant that may not execute) | persistence-and-migrations | the throw is the expected answer, so convert it: `const built = attempt(() => build(reference), () => ({ kind: 'variant-failed' }) as const); return built.ok && built.value ? schemaOf(reference) : null;` inside the existing `try { ... } finally { reference.close(); }` (boundaries-and-catches.md section 5) |

Resolved on the same date: architecture-and-boundaries' memory error log carries the `// best-effort:`
marker in its last-resort catch (the self-test case `pass-catch-handled-canonical-error-log` runs that
canonical file unchanged), and design-system-structure's root paint hands a failed
`SystemUI.setBackgroundColorAsync` to the provider's `onError`. The canonical adapter template of
architecture-and-boundaries (`attemptAsync(async () => toValue(await ...), ...)`) passes because
`adapter-boundary` treats the task callback as guarded.
