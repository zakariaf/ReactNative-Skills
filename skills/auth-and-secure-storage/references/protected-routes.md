# Protected route groups with Expo Router

How the session decides which routes exist, verified in Jest with Expo Router 57.0.24's in-memory
router (`src/services/session/session-guards.test.tsx`, through unit-and-component-tests'
`renderRouterWithProviders`) on 2026-10-10, and against the SDK 57 protected-routes documentation.
navigation-and-routing owns the navigator tree; this file covers only the session's part of it.

## Contents

1. The shape
2. What Stack.Protected does (verified)
3. The pitfall: a group without its own layout
4. While the session restores
5. SDK 57 limits and what is client-side only
6. Placing it in the app
7. Checks

## 1. The shape

```
src/app/
  _layout.tsx            root layout (navigation-and-routing): renders AppRoot
  (app)/_layout.tsx      the signed-in group's own Stack   ← required
  (app)/index.tsx        home
  (app)/tasks/[id].tsx
  (app)/delete-account.tsx
  checking-session.tsx   only while the session is restoring or unavailable ("checking your session")
  sign-in.tsx            signed-out only
  oauth-redirect.tsx     the Android redirect landing (always available)
```

```tsx
// src/features/root-navigator/app-stack.tsx (examples/app-stack.tsx)
const guards = sessionGuards(useSessionSnapshot());
return (
  <Stack screenOptions={{ headerShown: false, animation }}>
    <Stack.Protected guard={guards.isRestoring}>
      <Stack.Screen name="checking-session" />
    </Stack.Protected>
    <Stack.Protected guard={guards.isSignedIn}>
      <Stack.Screen name="(app)" />
    </Stack.Protected>
    <Stack.Protected guard={guards.isSignedOut}>
      <Stack.Screen name="sign-in" />
    </Stack.Protected>
    <Stack.Screen name="oauth-redirect" />
  </Stack>
);
```

Flows switch by changing the session, never by calling `router.replace('/sign-in')` after a sign-out
or `router.replace('/')` after a sign-in: the guard does it, so there is one source of truth and no
navigation race. (Expo's own example still calls `router.replace` after `signIn()`; with guards it is
redundant.)

## 2. What Stack.Protected does (verified)

| Situation | Result | Test |
|---|---|---|
| Signed out, a deep link to `/tasks/7` | lands on `/sign-in`; the task screen never renders | `sends a deep link into the app to sign-in while signed out` |
| Signing in on the sign-in screen | the guard opens `(app)`; `/` renders | `opens the app after sign-in and closes it after sign-out` |
| Signing out deep inside the group (`/tasks/7`) | `/sign-in`, and `router.canGoBack()` is false: the group's history is dropped | same test |
| A stored session at launch | the group opens straight away | `opens the signed-in group straight away for a stored session` |
| A stored session restored before the stack mounts (the startup gate), a deep link to `/tasks/7` | the task screen opens | `keeps a deep link into the group when the restore finished before the stack mounted` |
| The keychain locked (status `unavailable`), a deep link to `/tasks/7` | `/checking-session`; neither the task nor sign-in renders | `shows the checking-session route while the keychain is locked` |

When a guard turns false, the navigator removes every history entry of the guarded screens and moves
to its anchor or the first available screen (Expo's docs say the same). A screen exists in one
`.Protected` group only; declare it once. Guards nest (`isSignedIn` around `isAdmin`; check-auth
matches open and close tags by depth, so a screen after an inner guard still counts as inside the
outer one), and `Tabs.Protected` and `Drawer.Protected` work the same way.

## 3. The pitfall: a group without its own layout

Without `src/app/(app)/_layout.tsx`, `(app)` is not one route of the root Stack: its files become
separate children (`(app)/index`, `(app)/tasks/[id]`), and `<Stack.Screen name="(app)" />` names
nothing. The guard then protects **none** of those screens. The test
`protects nothing when the group has no layout of its own` proves it: a signed-out deep link opens the
task. Expo Router prints no error. check-auth's `protected-groups` requires the layout for every group
listed in `contracts/auth.json` `protectedGroups`.

## 4. While the session restores

Reading the Keychain takes a moment, and the splash covers it. The splash belongs to
app-startup-and-bootstrap, not to this skill: it is held once, at module scope, in `hold-splash.ts`,
and released once, in `AppRoot`, through `useStartupReady(gate, hideSplash)`. The session restore is
that startup gate's blocking task `restoreSessionTask(session)`, bounded by the gate's literal
`deadlineMs` (at most 3000 ms). Auth code calls no `SplashScreen` function at all.

- **The restore finished in time** (the usual case): `AppStack` first renders with the session known,
  so a deep link resolves against the right group straight away (test: `keeps a deep link into the
  group when the restore finished before the stack mounted`).
- **The restore missed the deadline** (status `restoring`), or the keychain is locked since the restart
  (status `unavailable`, a background launch): the gate opens anyway, the splash goes, and the Stack
  renders with only the `checking-session` route open (`guards.isRestoring`). It shows "checking your
  session" (a spinner and a message key, nothing protected), and the guards move on by themselves when
  the session settles (test: `shows the checking-session route while the keychain is locked`). A deep
  link that arrived during the miss lands on the group's first screen, not its target.
- That wait is bounded: `unavailable` happens only in the background, and the provider restores again
  when the app is active; in the foreground a read that fails twice signs out with reason
  `storage-unavailable` (values kept), so the sign-in route opens instead of an endless check
  (session-lifecycle.md section 2).

Never return `null` from `AppStack` while restoring: after the gate opened that is a blank frame with no
splash over it. Never render the Stack with every guard false either: the router would fall back to some
other screen (`oauth-redirect`, a not-found screen) for a frame, and a deep link resolved during that
frame lands in the wrong place. The guarded `checking-session` route is the one fallback while the
session is unknown.

## 5. SDK 57 limits and what is client-side only

- **`redirectTo` on `.Protected` arrives in SDK 58.** On SDK 57 the prop does nothing; order the screens
  so the first available one is the right fallback. check-auth reports `redirectTo` while
  `package.json` names Expo below 58.
- **Guards are client-side.** They decide what the app shows; they protect no data. Every request is
  authorized by the server (the bearer token), and a static web export still serves the JavaScript of
  protected routes to anyone who asks.

## 6. Placing it in the app

- `AppRoot` creates the session once (`useState(() => createAppSession(services, data))`) and passes it
  to `RootStack`, which renders `SessionProvider` around `AppStack`. Putting the provider in `AppRoot`
  would push the JSX depth past the lint limit of 5.
- `AppStack` is its own component (and file) because context flows down only: it reads both the
  session and `useScreenAnimation()` from providers above it (motion-and-animation).
- The sign-in screen is a feature like any other: `src/features/sign-in/` with a pure view and a model
  hook (`examples/use-sign-in-model.ts`, `examples/sign-in-screen.tsx`); the route file renders it.
- Route files stay thin (architecture-and-boundaries' `route-thin`): the Android redirect route calls a
  feature hook (`examples/use-oauth-redirect.ts`) instead of an effect of its own.

## 7. Checks

- `node ${CLAUDE_SKILL_DIR}/scripts/check-auth.mjs .` — `protected-groups`: every listed group has its
  own `_layout`, sits inside an `X.Protected`, every signed-out route sits inside one too, no
  `redirectTo` before SDK 58.
- `session-guards.test.tsx` — the behaviour itself, in Jest. The app's own AppStack gets a router test
  built from it (a signed-out deep link into a protected group lands on sign-in): the checker sees
  that a guard exists, not that it is bound to the right boolean.
- navigation-and-routing lists each guarded group in its `contracts/navigation.json` `protected` entry
  as `{ file, guard, screens }`, and its checker wants the guard text there to match the code
  (`isSignedIn` and `isSignedOut` from `sessionGuards(...)`); it also forbids `<Redirect>` in layouts and
  `router.replace` in effects, the same flow-by-guard rule as rule 9 here.
