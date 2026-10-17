# The session: restore, sign-in, refresh, 401s and sign-out

The decisions behind `createSessionManager` (templates `src/services/session/`), each with the failure
it prevents, and the test that proves it. The manager is plain TypeScript over ports, so every rule
here is tested in Jest with fakes; nothing needs a device.

## Contents

1. The states and who reads them
2. Restore at startup
3. Sign-in: persist, then publish
4. Access tokens and the single-flight refresh
5. Which refresh failures end the session
6. A 401 from the server
7. Sign-out that clears everything
8. Races the generation number and the queue close
9. Where the session lives in the app
10. Test recipes

## 1. The states and who reads them

```
restoring ──► signed-in ◄──► signed-out
    │  ▲            │              ▲
    ▼  │            ▼ (signOut / dead refresh token / second 401)
 unavailable ──────────────────────┘ (fails again in the foreground: storage-unavailable)
```

| Status | Meaning | UI |
|---|---|---|
| `restoring` | the stored session is being read | under the splash while the startup gate waits (app-startup-and-bootstrap); after a missed deadline only the "checking your session" route is open, no route group |
| `unavailable` | the secure store could not be read in the background (a launch before the first unlock after a restart) | same as restoring; the provider restores again when the app comes to the foreground |
| `signed-in` | tokens in memory and on disk; `account` carries the non-secret facts | the signed-in group is open |
| `signed-out` | `reason`: `user`, `session-expired`, `unauthorized`, `account-deleted`, `fresh-install`, `corrupt`, `storage-unavailable` (the store failed twice in the foreground; values kept), or `null` (nothing stored) | the signed-out routes are open; a reason may pick a message ("your session expired", "sign in again") |

`SessionSnapshot` never holds a token. Components read it with `useSessionSnapshot()`
(`useSyncExternalStore`: no state copy, no effect that sets state), and the guards come from
`sessionGuards(snapshot)`. A Zustand account store, when the app wants one, mirrors only
`account` and `status` (state-management-zustand); the token never enters a store.

## 2. Restore at startup

1. The install marker decides whether this is a fresh install (secure-storage.md section 4).
2. Three reads: access token, refresh token, meta. A failed read never wipes. What it publishes
   depends on where the app is (`restore({ isForeground })`, which `SessionProvider` passes):
   - **In the background** (`isForeground: false`, also the default): `unavailable`, and a later
     `restore()` reads again. A keychain item with `AFTER_FIRST_UNLOCK` cannot be read before the first
     unlock after a restart, and a background launch (a push, a background task) can come first.
   - **In the foreground** the phone is unlocked, so a lock cannot explain the failure. The three reads
     run once more (a passing Keystore hiccup); if they fail again, `signed-out` with reason
     `storage-unavailable`, recorded once. The values are **kept**: a later launch may read them, and
     the next sign-in overwrites every key. Waiting instead would keep the app on "checking your
     session" forever on a phone whose Keystore or Keychain keeps failing (Android answers some Keystore failures with a
     `DecryptException` on every read), and the person could never reach sign-in.
3. Nothing stored: `signed-out` with reason `null`.
4. Something unusable (no access token, meta missing or not matching `SESSION_META_SCHEMA`):
   `signed-out` with reason `corrupt`, recorded once. The values are **kept**: a later build that
   reads them restores the session, and the next sign-in overwrites every key anyway. Wiping on an
   error path would destroy what a fixed build could still use (error-handling-typed-results'
   `no-destructive-recovery`).
5. Otherwise `signed-in` with the stored account.

`restore()` runs once per app run however often it is called (the provider's effect, a retry, a
test); only `unavailable` lets the next call read again. `SessionProvider`'s effect depends on the
status and on `useIsAppActive()`: it starts the restore on mount and again whenever the status is
`unavailable` while the app is active (it became active, or a background read finished while it
already was). An effect keyed only on "should restore" would never run again after a failed foreground
read, because that boolean stays `true`; that was the bug this design fixes.

**Splash screen.** The splash is app-startup-and-bootstrap's, and auth code calls no `SplashScreen`
function. It is held once, at module scope, in `hold-splash.ts`, and released once, in `AppRoot`,
through `useStartupReady(gate, hideSplash)`. The restore is that startup gate's blocking task
`restoreSessionTask(session)` under its literal `deadlineMs` (at most 3000 ms), so the splash covers
the read and the first frame after it already knows the session. A restore that misses the deadline
is not waited for: the gate opens, the session is still `restoring` (or `unavailable`), and `AppStack`
renders its guarded "checking your session" route until the session settles. `AppStack` never renders
`null`: after the gate opened that would be a blank frame with no splash over it (protected-routes.md
section 4). No protected screen renders, not even for one frame, before the stored session is known.

## 3. Sign-in: persist, then publish

```ts
const signedIn = await session.signIn({ grant, account });
```

- **One session, one token issuer.** The session holds exactly one `TokenRefresher`, so every sign-in
  method must end in tokens from that refresher's issuer. A session signed in with the app server's
  tokens (after Sign in with Apple) whose refresher is the OAuth provider sends the server's refresh
  token to the provider; it answers `invalid_grant` and the person is signed out about one access-token
  lifetime later. The default: when the app has a server (Sign in with Apple always needs one), every
  method is exchanged there (`POST /auth/oauth` with the provider's id token, `POST /auth/apple` with
  Apple's credential), the provider's tokens are dropped, and the refresher is
  `createServerTokenRefresher` over `POST /auth/refresh` (`examples/server-refresher.ts`). Only an app
  with no server and OAuth as its sole method uses the OAuth adapter as the refresher. Recording the
  issuer in the session meta and choosing a refresher per session is possible, but two issuers mean
  two revocation paths and two places where account deletion must reach: avoid it.
- The grant (the server's answer to a sign-in exchange, or, without a server, the OAuth token
  response) becomes a `TokenSet`: `expiresAtMs = now + min(expires_in, 24 h)`; a missing, zero, negative or non-finite
  lifetime means "no expiry known" (the server's 401 decides).
- The three values are written **refresh token first**: after a crash between two writes the newest
  refresh token is on disk, and a server that rotates refresh tokens has already invalidated the old
  one.
- Only after every write succeeded does the manager publish `signed-in`. The other order (publish,
  then write) is the classic bug: the UI shows the app, the write fails, and the next launch is signed
  out with no explanation.
- A failed write returns `secure-storage-unavailable` and publishes nothing. A half-written set reads
  as `corrupt` at the next launch (signed out), so no wipe is needed on this error path.
- The id token's claims are read for display only (`readIdTokenClaims`), never verified on the
  device. The server verifies signature, issuer, audience, nonce and expiry before it trusts a token.

## 4. Access tokens and the single-flight refresh

`accessToken()` answers the token in memory while it is fresh (more than `REFRESH_SKEW_MS`, 60 s,
before its expiry). Inside the skew it refreshes first:

- **One refresh at a time.** Every caller during a refresh shares the same promise
  (`singleFlight(m.refreshing, ...)`). Ten queries that need a token at the same moment start one
  refresh, not ten. With rotating refresh tokens (RFC 6819, OAuth 2.0 Security BCP), a second refresh
  with the already-used token is a replay: many servers then revoke the whole token family and sign
  the person out everywhere.
- **Only the session manager refreshes** (`single-flight-refresh`). Other code asks it for a token.
- A refresh answer without a refresh token keeps the previous one (RFC 6749 section 6 lets the server
  choose); a new one always replaces it, and is written first.
- **Offline tolerance.** When the refresh fails for a passing reason (no connection, a timeout, 5xx)
  and the access token has not actually expired yet, the current token still goes out: the server
  decides. Past its expiry, the failure is returned and the session stays signed in.
- Refreshed tokens that fail to save are kept in memory for this run and recorded; after a rotation
  the next launch's refresh then fails and signs out cleanly.
- **An abandoned refresh may still have rotated.** The token calls take no abort signal, so a refresh
  past its 15 s deadline is only ignored; the server may still have answered and rotated the refresh
  token. The session keeps the old one, and the next refresh answers `invalid_grant`: a clean
  sign-out, never a wrong session. A server that accepts the previous refresh token for a short grace
  period (many identity providers offer one) turns that into a normal refresh; ask for it when slow
  networks are common.

## 5. Which refresh failures end the session

| Refresh outcome (OAuth error code) | Kind | Session |
|---|---|---|
| `invalid_grant` (expired, revoked, already used) | `invalid-grant` | ends: sign out, reason `session-expired` |
| any other OAuth error code (`invalid_client`, `unauthorized_client`, ...) | `rejected` | ends, and is recorded (a client configuration defect) |
| `temporarily_unavailable`, `server_error` | `server-unavailable` | kept |
| no answer, TLS failure, a body that was not JSON | `network-unavailable` | kept |
| no answer within 15 s (`OAUTH_TIMEOUT_MS`, withTimeout from async-safety) | `timed-out` | kept |
| no refresh token at all, and the access token expired | | ends: `session-expired` |

The rule of thumb: only the server saying "this refresh token is dead" ends a session. A train
tunnel never signs anyone out.

## 6. A 401 from the server

Most requests never see a 401 because tokens refresh ahead of expiry. A 401 still happens: a server
that revoked the token, a clock that is off, a password change elsewhere. `sendWithSession(session,
send)` (template) handles it once for every request:

1. Ask for a token (signed out: answer `signed-out` without touching the network).
2. Send. Anything but `unauthorized` is the answer.
3. `renewAfterUnauthorized(rejectedToken)`: if another request already replaced that token, use the
   new one without refreshing; otherwise refresh (shared with everyone else waiting).
4. Send once more. A second `unauthorized` means the server no longer accepts this session: sign out
   with reason `unauthorized`.

The ApiClient (networking-and-server-state) reads the token through its `headers` option:
`sessionHeaders(session)` returns `{ Authorization: 'Bearer <token>' }`, or nothing while signed out.
`examples/authorized-api-client.ts` wraps the fetch client with both.

## 7. Sign-out that clears everything

`signOut(reason)` runs in two phases, in this order:

0. **Server phase** (only for `signOut('user')`, while signed in): every `serverSignOutSteps` entry
   runs at once with `{ accessToken, signal }`, under one `SERVER_SIGN_OUT_TIMEOUT_MS` (5 s) deadline
   (`withTimeout`, async-safety). Unregister this device's push token, end the server session: calls
   that need the session while it is still valid. A step that fails or misses the deadline is
   recorded by name; its signal aborts; sign-out goes on either way. After `session-expired`,
   `unauthorized` or `account-deleted` the server no longer accepts this device's token, so this
   phase is skipped and the server itself must drop what belonged to that session (its push
   registrations among them). During this phase the session still answers `accessToken()`, so a step
   may also send through the authorized ApiClient; pass the `signal`.
1. Bump the generation (section 8) and drop the tokens from memory.
2. Wipe every declared secure key (queued after any write in flight). A key that would not go away
   clears the install marker, so the next launch wipes it.
3. Publish `signed-out`. The guards close the signed-in group first, so its screens unmount before
   their data disappears.
4. Run every sign-out step in order: the TanStack Query cache (`queryCacheStep`: cancel, then
   clear), per-account Zustand stores (`storeResetStep`), per-account rows in SQLite, scheduled
   notifications for the account, background work. A failing step is recorded with its name and never
   stops the steps after it: one broken step must not leave the next person this person's data.
5. Revoke the refresh token at the provider (RFC 7009), best effort. An offline revoke is not
   recorded; a refused one is. The device is signed out either way.

Why two phases: a step after the wipe runs signed out. A push unregister sent through
`sendWithSession` then answers `signed-out` without throwing, so not even the step runner notices,
the device stays registered for the old account, and the next person on the phone receives the
previous person's notifications.

`contracts/auth.json` lists the step names (`signOutSteps`, `serverSignOutSteps`); check-auth finds
each one where the session is created (a step `x-y` is written `{ name: 'x-y', run }` or made by
`xYStep(...)`). Two sign-outs at the same time run once. Signing out while already signed out does
nothing, except while a sign-in is still writing: then the sign-out runs and the sign-in loses
(section 8). The shared sign-out is keyed on the generation its wipe ended, so a sign-in that lands
while the last sign-out's steps or revoke are still running is ended by the next `signOut()` instead
of being handed the old, finished promise.

**Account deletion** is a sign-out with reason `account-deleted`, after the server confirmed the
deletion (oauth-and-apple.md section 7).

**Switching accounts** is sign-out, then sign-in. Never keep two people's data in one cache: the query
cache is cleared by the sign-out step, and query keys need no account id.

## 8. Races the generation number and the queue close

| Race | Without the guard | The guard |
|---|---|---|
| A refresh finishes after sign-out | the refreshed tokens are written back: a signed-out person is signed in again at the next launch | every sign-in and sign-out bumps `generation`; a refresh that started under an older generation drops its answer and writes nothing |
| Sign-out while sign-in is writing | the sign-in publishes after the sign-out | the sign-out bumps the generation (it runs while a sign-in is in flight); the sign-in returns `sign-in-superseded` and publishes nothing; the wipe is queued after the write, so it lands last |
| Two writes reorder | an older token set overwrites a newer one | one serial queue for every secure-store write and wipe |
| Many requests need a token at once | many refreshes, a replayed rotating token | the single-flight refresh |
| Sign-in while the last sign-out's steps still run, then sign-out | the second sign-out gets the first one's promise, wipes nothing, and the new session stays signed in | the running sign-out is shared only until a sign-in bumps the generation past the one its wipe ended |
| Sign-out while restore is still reading (a revoked Apple credential at launch, a startup 401) | the restore puts the stored session into memory after the wipe: the snapshot says signed out, but `accessToken()` still hands out the last person's bearer token | the sign-out waits for the running restore before it bumps the generation, so it ends whatever the restore put back (test: "a sign-out during restore wins") |
| A refresh finishes during the server phase | its tokens land in memory after the wipe | the generation is bumped after the server phase, right before the wipe, so the answer is dropped |

## 9. Where the session lives in the app

| Piece | Home |
|---|---|
| Ports and adapters (`secureStorage`, `installMarker`, `oauth`, `appleSignIn`) | members of `Services`, created once in `createDeviceServices()` (architecture-and-boundaries' composition root) |
| The SessionManager | created once in `AppRoot` (a `useState` initializer) by `createAppSession(services, data)` (example), passed to `RootStack` |
| `SessionProvider` | inside `RootStack`, around `AppStack` (keeps the JSX depth under the limit) |
| Guards | `AppStack` reads `sessionGuards(useSessionSnapshot())` |
| Screens | model hooks call `useSessionManager()` for `signIn` and `signOut` |

The canonical startup order with this skill in place (app-startup-and-bootstrap owns it):
`RootLayout` (error net first, then the `hold-splash` import that holds the splash at module scope,
adapters and the language) → `DirectionGate` → `AppRoot` (`startApp`: database, error-net sink, the
session, then the startup gate; `useStartupReady(gate, hideSplash)` releases the splash) → providers →
`RootStack` (`GestureHandlerRootView` → `KeyboardProvider` → `MotionConfig` → navigation theme →
`SessionProvider`) → `AppStack` (guards and the checking-session route; no splash call).

The restore is the canonical blocking startup task (it is async and non-interactive; a session
behind biometrics is a lock screen after the splash release, never a gate task). It lives in its own
file, because the root files hold no promise code (app-startup-and-bootstrap's `startup-await`):
`restoreSessionTask(session)` returns `{ name: 'session-restore', run: async () => { await
session.restore(); return ok(undefined); } }`, passed as
`createStartupGate({ blocking: [restoreSessionTask(session)], deadlineMs, errorLog })` with a literal
deadline of at most 3000 ms. The task calls `restore()` without `isForeground`: a launch can happen in
the background (a push, a background task), so a failed read publishes `unavailable` and never signs
out, and `SessionProvider` reads again, with the foreground flag, once the app is active.
`restore()` never rejects, so the task only misses at the deadline. A miss starts the session as
unknown or unavailable: the gate opens, the splash goes, `AppStack` shows the "checking your session"
route, and the guards open the right group once the snapshot changes.

## 10. Test recipes

| What | How (all in Jest, `createSessionTestKit` or the fakes) |
|---|---|
| Restore, fresh install, locked keychain, corrupt meta | seed `createFakeSecureStorage({...})`, choose `createFakeInstallMarker({ isPresent: false })`, `failNext('read')` |
| A store that keeps failing in the foreground | `failNext('read')`, `restore({ isForeground: true })`: `storage-unavailable`, two reads, values kept; in the provider set `AppState.currentState` to `'active'` or `'background'` |
| Server steps | `serverSignOutSteps` that push what they saw (`accessToken`, stored key count); a held one with fake timers for the deadline (sign-out-steps.test.ts) |
| Sign-out keyed on the generation | a held local step, `signOut`, `signIn`, `signOut` again, release: a second wipe |
| Persist before publish | subscribe, read `secureStorage.stored()` inside the listener |
| Single-flight | `oauth.deferRefresh()`, three `accessToken()` calls, answer once, expect one `refresh` call |
| Sign-out race | `deferRefresh()`, start `accessToken()`, `signOut()`, then answer: nothing written back |
| Sign-out during sign-in | `secureStorage.holdWrites()`, start `signIn`, `signOut`, release: `sign-in-superseded` |
| Steps order and failure isolation | steps that push into an array or throw |
| Protected routes | `renderRouterWithProviders` with a root layout using `Stack.Protected` (session-guards.test.tsx) |
| 401 handling | a scripted `send` that answers `unauthorized` once or twice (send-with-session.test.ts) |

Device-only: the real Keychain/Keystore behaviour, the browser sheet, Apple's sheet. Check those by
hand on one iOS and one Android device before release (oauth-and-apple.md section 9).
