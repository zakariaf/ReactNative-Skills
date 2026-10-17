# Async checks and server errors

How a field asks a question whose answer lives elsewhere ("is this list name free?"), and how the
server's refusal of a submitted form lands on the right field. The hook builds on async-safety's
canonical helpers (`createLatestRequest`, `delayOrAbort`, `withTimeout`), whose behaviour that skill
proves.

## Contents

- When a check is async, and when it is not
- useAsyncFieldCheck: the contract
- The races it closes, and the tests that prove them
- Timing
- Wiring it to a field and to submit
- The check port
- Server refusals at write time
- Mapping codes to fields
- Pitfalls

## When a check is async, and when it is not

| The answer comes from | Where the check lives |
| --- | --- |
| the value itself (length, shape, range) | the schema |
| data already in memory (open titles in a store) | the schema, through a factory (`taskEditorSchema(openTitles)`) |
| the device's database (a SQLite lookup) | an async check: the query is I/O even when fast |
| a server (name availability, a promo code) | an async check, and the server judges again at write time |

A schema never awaits (rule 3). An async check never replaces the server's own check at write time:
between the check and the submit someone else can take the name.

## useAsyncFieldCheck: the contract

```ts
const nameCheck = useAsyncFieldCheck(check);       // check: (value, signal) => Promise<Result<Verdict, Failure>>
nameCheck.onValueChange(text, isShapeValid);        // from the field's change handler
nameCheck.state;                                    // idle | checking | passed | refused | unavailable, with the value
nameCheck.hasPassed(value);                         // true only for a pass of exactly this value
```

- **Only a valid shape starts a check.** `onValueChange(text, false)` cancels any running check and
  returns to `idle`: an empty or too-long name is the schema's message, not the server's.
- **It waits for typing to pause** (`debounceMs`, 400 by default) with `delayOrAbort`, so typing
  "Groceries" asks once, not nine times.
- **The newest value wins.** Each value starts a new request through `createLatestRequest`, which
  aborts the previous one; an answer for an older value is dropped (`signal.aborted` after the await).
- **Each check has a deadline** (`deadlineMs`, 8000 by default) through `withTimeout`; a check that
  hangs or fails becomes `unavailable`: submit stays blocked and the field says so
  (`forms.check.unavailable`), with no endless spinner.
- **Leaving the screen cancels it.** The effect's cleanup aborts the current request; the check's
  signal aborts, so a fetch stops.
- **The state names its value.** `{ status: 'passed', value: 'Groceries' }`: submit compares it with
  the value being sent, so a pass for "Grocer" never lets "Groceries" through.
- **A failure is a value.** The check returns a `Result`; a rejected promise (a bug) is recorded with
  the error log and never reaches the screen as a crash.

## The races it closes, and the tests that prove them

`templates/src/hooks/use-async-field-check.test.ts` drives fake timers and a deferred fake check
whose answers the test releases in any order:

| Race | Test |
| --- | --- |
| typing fast asks once, for the last value | "waits for typing to pause, then asks once for the newest value" |
| an old answer arrives after a newer value was typed | "drops an older answer that arrives after a newer value was typed" |
| an invalid value starts no request and clears the last answer | "asks nothing about a value whose shape is invalid" |
| a check that never answers | "turns a check that hangs into unavailable at the deadline" |
| the screen goes while waiting | "asks nothing once the screen is gone, even after the pause" |
| the screen goes while the check runs | "aborts the signal of a check still running when the screen goes" |

## Timing

| Setting | Default | Why |
| --- | --- | --- |
| `debounceMs` | 400 | longer than the gap between keystrokes of most typists, short enough to feel live |
| `deadlineMs` | 8000 | a phone on a slow network still answers; a hung request does not block for ever |

Pass another `AsyncFieldTiming` for a check that is cheap and local (a SQLite lookup: debounce 150,
deadline 2000). Never debounce with `setTimeout` by hand in a model: the helpers clear their timers
and listeners on every path (async-safety).

## Wiring it to a field and to submit

The model owns both the form and the check (`examples/list-name-availability.ts`):

1. Wrap the field's `onChangeText`: hand the text to react-hook-form and to the check, with the
   shape verdict from the schema (`v.is(LIST_NAME_SHAPE, text)` on the field's own sub-schema).
2. Show the state on the field: `status` = `t('forms.check.checking')` while checking; `error` = the
   schema's error first, then the refusal's key, then `forms.check.unavailable`.
3. In `save`, require `nameCheck.hasPassed(draft.name)`; if not, look at why:
   - still `checking` (Save tapped during the pause or the request): not an error. Announce
     `forms.check.pending` ("Still checking. Save again once it’s done.") and focus the field, whose
     status line already says "Checking…". A field error here would be wrong ("unavailable" while
     the check is merely running) and would stay after the answer lands, until the next edit.
   - `refused` or `unavailable`: `setError('name', { type: 'availability', message: <key> })` with
     the refusal's key or `forms.check.unavailable`, and stop. The submit then focuses the field
     like any error.
4. The server still answers `rejected` with a code if the name was taken meanwhile (below).

## The check port

The check is a function the model receives (from a service, a repository or the API layer), never a
fetch in the hook:

```ts
type FieldCheck = (value: string, signal: AbortSignal) => Promise<Result<FieldCheckVerdict, FieldCheckFailure>>;
type FieldCheckVerdict = { kind: 'passed' } | { kind: 'refused'; messageKey: MessageKey };
```

- It honours the signal (passes it to `fetch` through the `ApiClient`, networking-and-server-state).
- It never rejects for an expected failure (offline, 5xx, timeout): those are `err(...)`.
- The refusal carries a catalog key chosen by the app (`lists.name.taken`), not the server's text.
- Server data is TanStack Query's, but an availability probe is not cached server state: a fresh
  answer per value is the point, so it is a plain port call, not a `useQuery`.

## Server refusals at write time

networking-and-server-state's failure kinds reach the form like this:

| Failure | In the form |
| --- | --- |
| `rejected` with a known `code` | `setError(field, { type: 'server', message: KEY_OF[code] })` on the field the code names; the field shows it and submit focuses it |
| `rejected` with an unknown code | the form-level failure sentence (`<feature>.save.failed`), input kept |
| `conflict` | the form-level message that the item changed; reload it and let the user decide (no silent overwrite) |
| `network-unavailable`, `timed-out`, `server-unavailable` | the form-level failure sentence with a retry; input kept (and the draft, if any) |
| `unauthorized` | auth-and-secure-storage's flow; the input is kept for after sign-in when possible |

`setError` takes a **catalog key**, never the server's message (`error-message-key`): the server's
text is in one language and not reviewed. A typed table proves every code has a key at compile time.

## Mapping codes to fields

```ts
const FIELD_OF: Readonly<Record<TaskRejectCode, { field: keyof TaskEditorInput; key: MessageKey }>> = {
  'title-too-long': { field: 'title', key: 'task-editor.title.too-long' },
  'title-taken': { field: 'title', key: 'task-editor.title.duplicate' },
  'estimate-out-of-range': { field: 'estimateMinutes', key: 'task-editor.estimate.out-of-range' },
};
```

`examples/server-field-errors.ts` shows the whole mapping: parse
the `code` with a valibot `picklist`, look it up, `setError` with `{ shouldFocus: true }`. A server
error stays until the user edits that field (react-hook-form clears a field's error when it next
validates it).

## Pitfalls

- **Checking on blur only.** The user blurs by tapping Save; the check starts and the submit sees
  `checking`. Check while typing (debounced) and let submit require `passed` for the value.
- **A spinner without a deadline.** On a dead network the field says "Checking…" for ever and Save
  never works. The deadline turns it into `unavailable`.
- **Trusting the pass at write time.** Another user can take the name between the check and the
  save; the server's `rejected` code must still map to the field.
- **Calling the check from `useEffect` on the watched value.** An effect per value change re-runs
  after every render and races; the change handler is the event that caused it.
- **Starting the check for an empty value.** The server answers "invalid" in English; the schema's
  message was the right one.
