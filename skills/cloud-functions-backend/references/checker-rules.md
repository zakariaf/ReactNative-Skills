# check-functions.mjs: rules, configuration and limits

What each rule of `scripts/check-functions.mjs` catches, how the checker finds the functions folder, and what it cannot see. Run it from the repo root: `node ${CLAUDE_SKILL_DIR}/scripts/check-functions.mjs .`

## Contents

- Finding the functions folder
- The rules
- rn-skills.config.json keys
- What the checker cannot see

## Finding the functions folder

In this order, first match wins:

1. `--functions-dir <dir>` (repo-relative).
2. `rn-skills.config.json` `"functionsDir"`: a folder or a list of folders.
3. Every `source` in `firebase.json` `"functions"` (an object, or a list of codebases; a codebase without `source` means `functions`).
4. `functions/`.

A folder that does not exist, or holds no `.ts`/`.js` source, is exit 2 (nothing to check is never a pass). The scan uses the repo walk that skips `node_modules`, build output and every installed skill (any folder holding a `SKILL.md`, `.agents/`, `skills/`, `.claude/`), plus the functions folder's own `lib/`, `dist/`, `build/`, `coverage/` and `.firebase/`. When the folder came from the config or `firebase.json`, a `note: functions folder <dir> (<source>)` line says so. The checker prints no SKIP lines.

## The rules

| Rule | Fails when | Fix |
|---|---|---|
| `missing-app-check` | an `onCall` (named import, `require` destructuring, or a namespace such as `functions.https.onCall`) has no options object or no literal `enforceAppCheck: true` (and `setGlobalOptions` does not set it); a callable that binds a non-empty `secrets: [...]` lacks `consumeAppCheckToken: true`; a wrapper call sets `enforceAppCheck` to anything but `true` | make it through `defineCallable`, or add the options |
| `missing-auth-check` | a file with an `onCall` never compares `request.auth` with `undefined`/`null`, negates it (`!request.auth`), or calls a `require...Auth(...)`/`assert...Auth(...)`/`ensure...Auth(...)` helper | return `unauthenticated` first |
| `unvalidated-input` | `request.data` (or `req.data`, or the handler's own parameter `.data`) is read anywhere but as an argument of a call whose name contains `parse` (`v.parse`, `v.safeParse`, `parseEnvelope`); a wrapper call has no `input:` schema | parse first, use only the parsed output |
| `env-secret` | `process.env.<NAME>` where the name holds KEY, SECRET, TOKEN, PASSWORD, PASSWD, AUTH, CREDENTIAL(S), PRIVATE or BEARER; `process.env[...]`; destructuring `process.env`; `<SECRET>.value()` of a `defineSecret` param in a file with no `secrets: [<SECRET>]` | declare with `defineSecret`, bind on the function, read `.value()` in the handler |
| `literal-key` | an Anthropic, OpenAI-style, Google API, Stripe live, GitHub, Slack or AWS key, or a private key block, in any functions source (tests too); a long opaque literal assigned to a secret-like name; a secret-like name with a long value in a committed `.env*` file of the folder (`*.local` skipped) | delete it, rotate it, use a bound secret |
| `unbounded-instances` | a 2nd-gen trigger (`onCall`, `onRequest`, `onSchedule`, `onMessagePublished`, `onDocument*`, `onObject*`, `onTaskDispatched`, `before*`, ...) lacks any of `region`, `maxInstances`, `timeoutSeconds`, `memory` in its own options and in `setGlobalOptions` | set the four globally, override per function |
| `v1-api` | an import of `firebase-functions/v1`; the root `firebase-functions` import while `functions/package.json` declares firebase-functions below 6 (where the root was 1st gen); `functions.config()`; `.runWith(`; a 1st-gen chain such as `pubsub.schedule(...).onRun(` or `firestore.document(...).onCreate(` | rewrite as a 2nd-gen trigger; move config to params |

Tests (`*.test.*`, `*.spec.*`) are exempt from `env-secret` only.

## rn-skills.config.json keys

| Key | Default | Meaning |
|---|---|---|
| `functionsDir` | (firebase.json, then `functions`) | the functions folder, or a list of them |
| `callableWrappers` | `["defineCallable"]` | names of functions that wrap `onCall`; each call is checked for `input:`, `enforceAppCheck` and `consumeAppCheckToken` with secrets, while the wrapper's own `onCall` is checked like any other |

## What the checker cannot see

It reads source text, not a type-checked program, so these stay review items:

- `enforceAppCheck` set from a variable or a param expression fails (the rule wants the literal `true`); a spread (`...opts`) is not followed.
- "Cost-bearing" means "binds a secret". A paid call made with ambient credentials (a Google API through the default service account) binds none: set `consumeAppCheckToken: true` on it by hand.
- The auth check is file-wide: one `if (!request.auth)` covers every `onCall` in that file. Keep one callable per file.
- A handler that destructures `({ data }) =>` is not followed.
- `.value()` binding is matched per file: the binding and the read live in the same file (the template's shape).
- The order "kill switch before the paid call", "quota after the cache", "no PII in logs" and "claims with `create()`" are proven by the template's unit tests and the emulator tests, not by this checker.
