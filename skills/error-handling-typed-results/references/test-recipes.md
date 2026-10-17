# Test recipes for the error spine

Jest 29 + jest-expo 57 + React Native Testing Library 14 (async API), as unit-and-component-tests sets
them up. Verified on 2026-10-03: every recipe here runs in the templates' tests or in the examples' tests
inside a copy of the reference harness (re-verify: `npx jest --ci <file>`).

## Contents

1. Asserting Results
2. Every kind has a message in every locale
3. Mappers against real engine errors
4. The error net with fakes, and with the real ErrorUtils
5. Error boundaries: unit and through Expo Router
6. Input survives a failure
7. Writing the failing test first

## 1. Asserting Results

Results are plain data: assert the whole value.

```ts
expect(repository.add({ id: 'task-1', title: '  ' })).toStrictEqual({
  ok: false,
  error: { kind: 'task-title-empty' },
});
```

- `toStrictEqual`, not `toMatchObject`, so a new param on the failure is a deliberate test change.
- An async boundary resolves, it never rejects: `await expect(sync.pull()).resolves.toStrictEqual(...)`.
  A test that needs `.rejects` against a boundary has found a leak.
- Test titles start with a third-person verb (`returns`, `keeps`, `records`): the config's
  `jest/valid-title` rule enforces `^(can|[a-z]+s)\b`.

## 2. Every kind has a message in every locale

```ts
import ar from '@/i18n/catalogs/ar.json';
import en from '@/i18n/catalogs/en.json';

import { TASK_FAILURE_KINDS } from '@/core/tasks/task-failure';
import { TASK_FAILURE_MESSAGE } from '@/features/tasks/task-failure-message';

const CATALOGS = { en, ar } as const;

describe('task failure messages', () => {
  it.each(Object.keys(CATALOGS))('has a message for every failure kind in %s', (locale) => {
    const catalog: Readonly<Record<string, string>> = CATALOGS[locale as keyof typeof CATALOGS];
    for (const kind of TASK_FAILURE_KINDS) {
      expect(catalog[TASK_FAILURE_MESSAGE[kind]]).toBeDefined();
    }
  });
});
```

`check-error-spine` checks the source catalog statically (`failure-message-key`); this test covers every
locale and runs with the suite.

## 3. Mappers against real engine errors

A mapper is only as good as the errors it was tested with. Throw real ones: run SQL on `node:sqlite` in a
root `test/` file (the root program has Node types; `src/` has none):
`examples/tasks/to-storage-failure.test.ts`.

- jest-expo runs tests in a separate realm: an error thrown by `node:sqlite` is **not**
  `instanceof Error` there (verified on 2026-10-03). Read fields with `typeof` and `Reflect.get`.
- Drive every code the mapper names with a real engine error, not only the easy constraint: a full
  database (`PRAGMA max_page_count` set to the current page count), a lock (a second connection with
  `timeout: 0` while the first holds `BEGIN EXCLUSIVE`), a junk file (`file is not a database`).
- Add one case per device-only shape, **built from a real error's message**: the iOS form
  `Error code 19: <message>` and the Android form, where expo-sqlite 57 writes the code as one character
  (`` `Error code ${String.fromCharCode(19)}: ${message}` ``; read from source, see
  boundaries-and-catches.md section 3). A test with only the iOS form passes while every Android error
  falls into the catch-all kind. Add one for a value that carries nothing (`undefined`, `{}`) to prove the
  mapper is total.

## 4. The error net with fakes, and with the real ErrorUtils

`templates/src/services/error-net/error-net.test.ts` drives `createErrorNet` with fake hooks: a fake
`ErrorUtils` (getter and setter around a variable) and a fake tracker that stores its options. Each test
calls the installed handler or `tracker.onUnhandled(...)` directly and asserts the sink and what was
forwarded. Cases worth keeping when changing the net:

- a fatal error is recorded, then forwarded with `isFatal: true`;
- an unhandled rejection is recorded as non-fatal and forwarded as non-fatal;
- reports before `connect` are buffered, bounded, flushed oldest first (and synchronously, so a report
  made just before a reload is already in the sink when `connect` returns);
- a throwing sink is caught and logged, and the previous handler still runs;
- `install()` is idempotent, a second net replaces (not stacks) the first, uninstall restores.

jest-expo loads React Native's real `ErrorUtils` (from `@react-native/js-polyfills/error-guard.js`), so
`app-error-net.test.ts` and `install-error-net.test.ts` assert that the real handler is swapped and
restored. `install-error-net.test.ts` imports the installer inside `jest.isolateModules` so the module
cache does not leak into other tests, and uninstalls before it ends.

## 5. Error boundaries: unit and through Expo Router

These tests follow unit-and-component-tests' rules (its `check-test-code` reads them) and, for the
crash screen, accessibility-as-code's (its `check-a11y-code` reads `*-screen.test.tsx`). The helpers
they import come from those skills: `@test/render-router-with-providers` (unit-and-component-tests)
and `@test/a11y/find-inaccessible-pressables` (accessibility-as-code).

**Render without providers on purpose, and say so.** The root boundary and its fallback render outside
every provider the root layout mounts, so their tests render with plain `render(...)` and carry the
documented marker once in the file header: `// no-providers: <why>` (the reason at least 10
characters). `renderWithProviders` there would hide exactly the context dependency that turns a render
error into an unrecorded crash.

Unit (the factory alone): render the returned component with an `error` and a `retry` and assert it
records once, renders the fallback, and calls `retry` only on a press (`userEvent.setup()`, then
`user.press(getByRole('button', { name }))`), with fake timers advanced a minute to prove nothing
retries by itself. user-event advances Jest's fake timers by itself.

Through the router (the real `Try` boundary picks up the export), with `renderRouterWithProviders`,
never Expo Router's `renderRouter` (with RNTL 14 it leaves fake timers on and its matchers throw;
unit-and-component-tests' `expo-router-testing` rule):

```tsx
import { Stack } from 'expo-router';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

await renderRouterWithProviders({
  _layout: { default: () => <Stack />, ErrorBoundary: RootBoundary },
  index: BrokenScreen,                       // a component that throws while rendering
});
expect(await screen.findByRole('button', { name: 'Restart' })).toBeOnTheScreen();
```

The helper puts the test providers above the router, where the app has none; the stand-in fallback
reads none of them, so the test still proves the routing half, and the fallback's own test proves the
no-provider half. The same render with a `_layout` whose `default` throws proves the startup case: the
root layout's own `ErrorBoundary` export catches an error thrown by the layout itself (its providers
included), so `record` runs for a crash during the first render (`create-route-error-boundary.test.tsx`
keeps both tests).

React logs caught render errors with `console.error`; silence it per test with
`jest.spyOn(console, 'error').mockImplementation(() => undefined)` (the config restores mocks after each
test).

The crash screen (`crash-screen.test.tsx`): assert the copy by text and the one way out by role and
name, prove nothing calls `onAction` without a press, and end with accessibility-as-code's audit,
`expect(findInaccessiblePressables(screen.container)).toStrictEqual([])`. No style assertion: the
background is a prop it forwards, and the fallback's test proves the pairing.

The app's own fallback (`crash-fallback.test.tsx` in the templates does this): render it with **no
provider at all** (`render(<CrashFallback onRestart={fn} />)`, not `renderWithProviders`). That is how it
renders under the root layout, and an error there is a fatal crash nothing records, so this test is the
only proof that it reads no provider context and that its copy and background resolve without one. Call
`recordShownLanguage(null)` (from `src/i18n/translate-now.ts`) before each test so no earlier provider's
language leaks in, assert the source-language copy (`createTranslateNow` then follows jest-expo's mocked
device locale) and `toHaveStyle({ backgroundColor })` with the light theme's background, which is what
`useTheme()` returns outside `ThemeProvider`. That style assertion is one contract (outside the theme
provider, AppText's default text colour is readable only on that background). The other is direction:
`it.each(LANGUAGES)` records each language with `recordShownLanguage({ language, digits: 'automatic' })`
and asserts `toHaveStyle({ writingDirection: directionOf(language) })` on `crash.title`, which only the
fallback's own `TextLocaleProvider` can make right (it covers the app's RTL languages without naming
them). The file header justifies both with `// allow-style-assertion: <why>`; assert nothing else by
style.

## 6. Input survives a failure

`examples/tasks/use-add-task-model.test.ts`: a fake repository returns a typed failure on demand; after
`add()` the title is still in the model and the failure message is set; a successful add clears the field.
Use `renderHook` and wrap every state change in `await act(...)` (RNTL 14 is async). The hook's
repository and id source are injected, so the file says `// no-providers: <why>`; a model hook that
reads its services from context renders through `renderHookWithProviders` (unit-and-component-tests)
with fakes passed in instead.

## 7. Writing the failing test first

For a new failure kind, in this order (tdd-workflow owns the general loop):

1. Add the kind to the family; `tsc` and lint now fail at every switch and table that must handle it.
2. Write the boundary test that produces it (a real engine error where possible) and watch it fail.
3. Map it in the boundary; add its message key to every catalog; extend the per-locale test.
4. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-error-spine.mjs .` until `RESULT: PASS`.
