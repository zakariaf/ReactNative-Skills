# Architecture and the server contract

How remote push is built in an Expo app so that it is testable, safe against forged payloads and
agreed with the server in writing. Verified on 2026-10-14 against expo-notifications 57.0.21
(Expo SDK 57); re-verify with `npm view expo-notifications@~57.0.21 version` and the installed
`node_modules/expo-notifications/build/*.d.ts`.

## Contents

- 1 The pieces
- 2 Why a port
- 3 Expo push service or native tokens
- 4 The registration
- 5 The server contract (contracts/push.json)
- 6 The payload
- 7 Taps and destinations
- 8 The foreground policy
- 9 Sign-out and account switches
- 10 Composition and tests
- 11 When multi-package

## 1. The pieces

| Piece | File | Job |
|---|---|---|
| Message schema | `src/core/push/push-message.ts` | `PUSH_KINDS`, the valibot schema, `parsePushData(data) → PushMessage \| null` |
| Destinations | `src/core/push/push-destination.ts` | `destinationFor(message, action) → PushDestination \| null`: the only map from data to a place |
| Foreground policy | `src/core/push/foreground-presentation.ts` | banner, list, sound, badge for a notification that arrives while the app is open |
| Registration plan | `src/core/push/registration-plan.ts` | `planRegistration(facts)`: register, unregister or nothing (pure); the saved record's codec |
| Registration types | `src/core/push/push-registration.ts` | `PushRegistration`, `PushRegistrar` (the server, as push sees it) |
| Port | `src/services/push/push-port.ts` | `PushPort`: permission, channels, token, rotations, taps |
| Adapter | `src/services/push/expo-notifications-push-adapter.ts` | the only file that calls expo-notifications' push APIs; installs the one foreground handler |
| Fake | `src/services/push/fake-push.ts` | in-memory port for every test |
| Saved record | `src/services/push/push-record-port.ts`, `kv-push-record-adapter.ts`, `fake-push-record.ts` | what the server last accepted, kept between launches (expo-sqlite/kv-store) |
| Channels | `src/services/push/push-channels.ts` | `PUSH_CHANNELS` and `namedPushChannels(t)` |
| Registration | `src/services/push/push-registration.ts` | `createPushRegistration`: serialized syncs, rotation, unregister; `pushRegistrationStep` |
| Opt-in | `src/services/push/push-opt-in.ts` | `optInToPush`: channels, then the prompt, then registration |
| Tap router | `src/services/push/push-tap-router.ts` | launch tap + listener, dedupe, parse, destination |
| Project id | `src/services/push/read-eas-project-id.ts` | the EAS project id from the build |
| Hooks | `src/hooks/use-push-sync.ts`, `src/hooks/use-push-taps.ts` | channels, then sync at launch/foreground/account change; route taps below the navigator |
| Root kit | `src/services/push/push-root-kit.tsx`, `push-context.tsx` | `createPushKit`: plugs push into app-startup-and-bootstrap's slots (provider for the in-context ask, effects beside the root Stack); `usePushServices` |
| Server side | `src/api/push/push-registrar.ts`, `src/api/session-api-client.ts` (examples) | the registrar over the signed-in ApiClient (section 10); the sign-out call signs with the step's access token |
| Contract | `contracts/push.json` (+ schema) | kinds, channels, default channel, provider, account scope, server facts |

Dependencies point one way: `src/core/push` is pure (valibot only); services import core; hooks import
services; the route table (`push-destination-href.ts`) is the app's (only the app knows its
routes), handed to the kit by the root-kit registry as `hrefForDestination`.

## 2. Why a port

- **Tests never touch the native module.** Every model, hook and service gets `createFakePush()`;
  only the adapter's own tests mock `expo-notifications`. A screen test that taps "Notify me" asserts
  `push.calls` (`['syncChannels', 'permission', 'requestPermission']`) instead of mocking the SDK.
- **One file knows the SDK's quirks:** the deprecated `*Async` response APIs, `shouldShowAlert`, the
  iOS `body` key, Android's `dataString`, the provisional status, the `ERR_NOTIFICATIONS_*` codes.
- **Expected failures are values.** `token()` returns `Result<PushToken, PushTokenFailure>`:
  `not-allowed`, `missing-project-id`, `network-unavailable` (the Expo token is fetched from Expo's
  server, so it fails offline), `token-unavailable` with the native code (no FCM config, no
  `aps-environment` entitlement, Expo Go on Android).
- **Local notifications share the module.** local-notifications has its own adapter over the same
  package (`src/services/local-notifications/expo-local-notifications-adapter.ts`, its own port). The one thing they must share
  is the foreground handler (section 8): this skill's adapter installs it and its policy has a branch
  for `isRemote: false`. The root-kit registry creates the local adapter with
  `createExpoLocalNotificationsAdapter({ errorLog, installForegroundHandler: false })`; the copied
  local adapter is never edited (local-notifications rule 11), and check-push does not count its
  guarded call site once that flag is passed.
- **The notification permission is one OS permission.** Both ports read and request it with the same
  five states (`granted`, `provisional`, `undetermined`, `denied`, `blocked`, a subset of
  permissions-and-system-prompts' `PermissionState`), so each port is a `PermissionAccess`. The app's
  `PermissionsPort` binds `access.notifications` to this port when push is adopted (to the local
  port otherwise); the explain, rationale and Settings sheets and the `notifications` entry in
  `contracts/permissions.json` are permissions-and-system-prompts'.

## 3. Expo push service or native tokens

The default is the **Expo push service** (`"provider": "expo"`): the device registers an Expo push
token (`ExponentPushToken[...]`), the server sends to `https://exp.host/--/api/v2/push/send` (with
the Expo access token when enhanced push security is on), and Expo talks to APNs and FCM with the
credentials stored in EAS. One API for both platforms, receipts, batching.

Choose `"provider": "native"` only when the server already talks to APNs and FCM HTTP v1 itself (or
through a vendor). Then the adapter returns the raw device token (`provider: 'apns'` on iOS,
`'fcm'` on Android), `getExpoPushTokenAsync` is never called, and the server must shape payloads the
way expo-notifications reads them (section 6).

The Expo token wraps the device token: when APNs or FCM rotate the device token, the Expo token for
it changes too, which is why the adapter converts every rotation with
`getExpoPushTokenAsync({ projectId, devicePushToken })` instead of fetching anew.

## 4. The registration

`createPushRegistration(deps)` keeps the server's view of this device true. Triggers:

| Trigger | Who calls | What happens |
|---|---|---|
| Launch | `usePushSync` (the app is active) | read permission → token → plan → register if new |
| Return to the foreground | `usePushSync` (`useIsAppActive` turns true) | same: catches notifications switched on or off in Settings |
| Account change | `usePushSync` (`accountId` changes) | registers again for the new account |
| Token rotation | `registration.start()` (`onTokenChange`) | registers the new token with `previousToken` |
| Opt-in | `optInToPush` after the prompt | registers right away |
| Sign-out | `pushRegistrationStep` (server phase) | unregisters with the still-valid access token (the saved token first, then a newer one) |

Decisions:

- **One sync at a time** (a promise queue). A rotation during the launch sync would otherwise send
  two registrations whose order the server cannot know.
- **Plan is pure** (`planRegistration`): the server accepted the same token, account and language
  less than 24 hours ago (`REREGISTER_AFTER_MS`) → nothing; otherwise register (a record dated in the
  future, after the clock was set back, counts as old). The server's last-seen time therefore stays
  within a day of the app's last use.
- **The last accepted registration is saved** (`PushRecordPort`, one kv-store key). A launch is
  often a new process: Android ends the app's process when a runtime permission such as
  `POST_NOTIFICATIONS` is revoked in Settings, and iOS often ends a backgrounded app while the person
  is in Settings. With a memory per run, that launch would find nothing to unregister and the server
  would keep the registration. The record is written after every accepted register or unregister and
  cleared at sign-out; a damaged or unreadable record reads as none (the next sync registers again,
  which the idempotent upsert absorbs).
- **No retry timers.** A failed registration is recorded (`errorLog`, source `network`) and the next
  trigger retries. A timer would keep a radio awake for something the next foreground does anyway.
- **Permission switched off → unregister the saved token**, at the first sync that sees it (the
  launch or the return to the foreground after Settings), from this process or an earlier one. iOS
  accepts pushes for a device whose notifications are off and silently drops them; the server would
  count them as delivered. Unreachable server: the record stays and the next trigger tries again.
  Refused (4xx): the record is forgotten, because the same call will never succeed; the server's
  `dropOn` duties cover what is left. What the app cannot guarantee: an install that is never opened
  again after notifications were switched off never syncs, so the server drops registrations not
  seen for 270 days (`not-seen-270-days`, the age at which FCM expires an unused token).
- **The permission is never requested here.** Only `optInToPush` asks, from a person's action.
- **`requiresAccount`** (contract): with `true` nothing registers while signed out; with `false` the
  device registers anonymously (broadcasts) and again with the account after sign-in.
- **Language rides along.** The OS draws the notification before any app code runs, so the server
  writes title and body in `registration.language`; the next sync after a language change sends it.

## 5. The server contract (contracts/push.json)

The file is the written agreement with whoever builds the sender. check-push reads `provider`,
`requiresAccount`, `kinds`, `channels`, `defaultChannel` and `files`; `server` is for people.

| Key | Meaning |
|---|---|
| `provider` | `expo` or `native` (section 3) |
| `requiresAccount` | registrations belong to a signed-in account; sign-out removes them (section 9) |
| `kinds` | every `data.kind` this build understands; equal to `PUSH_KINDS` |
| `channels` | Android channel ids and importance; equal to `PUSH_CHANNELS` (ids, order, importance) |
| `defaultChannel` | one of `channels`; also the plugin's `defaultChannel` |
| `files.message`, `files.channels` | where `PUSH_KINDS` and `PUSH_CHANNELS` live (defaults shown in the template) |
| `server.registerEndpoint` | `PUT /push/registrations/{token}`: idempotent upsert; body = `PushRegistration` |
| `server.unregisterEndpoint` | `DELETE /push/registrations/{token}`; 404 counts as done |
| `server.dataValues` | `strings`: every data value is a string (section 6) |
| `server.maxPayloadBytes` | 4096: the whole notification, title and body included (Expo, APNs, FCM) |
| `server.dropOn` | when the server deletes a registration: `DeviceNotRegistered` in a ticket or receipt, a revoked or expired session, not seen (no register call) for 270 days |

Server duties the app cannot enforce, to hand to the backend developer with the contract:

1. Send in batches of at most 100 messages; Expo accepts 600 notifications per second per project;
   retry 429 and 5xx with exponential backoff.
2. Read tickets at once and receipts about 15 minutes later (kept 24 hours); delete the
   registration on `DeviceNotRegistered`; alert on `InvalidCredentials` (credentials revoked) and
   `MessageTooBig`.
3. Turn on enhanced push security in the EAS dashboard and send the access token from the server only
   (expo-server-sdk 3.6.0 or later takes `accessToken`): without it a leaked token lets anyone push
   to that device in the app's name.
4. Set `channelId` to one of the contract's channels (a channel the device never created means the
   notification is not shown), `priority: 'high'` only for what is time-critical (normal may be
   delayed by Doze), a `ttl` that matches how long the news stays true.
5. Never put secrets, personal data or the content of private messages in title, body or data: the
   payload passes through Apple, Google and Expo and is shown on a locked screen. Default to
   neutral text ("A task was assigned to you"); showing a task title or a sender's name is a product
   decision weighed against that exposure, not a default.
6. Keep a last-seen time per registration (every `PUT` refreshes it; the app sends one at least daily
   while in use) and delete registrations not seen for 270 days: an install never opened again after
   notifications were switched off cannot unregister itself.
7. Scope every registration write to the caller. A `DELETE` removes a registration only when it
   belongs to the calling session's account (or, for an anonymous one, to the same installation);
   anything else answers 404 like a missing row, so a caller cannot probe or remove other people's
   tokens. A `PUT` of a token another account holds moves the row to the caller's account (one row
   per token): a token names one install, only that install and the push service know it, and the
   next person signing in on a shared phone must take it over even when the previous sign-out's
   `DELETE` failed (section 9). The residual risk, someone who learned a token redirecting it, is
   bounded: the rightful install re-registers at least daily while in use (`REREGISTER_AFTER_MS`)
   and takes the row back. The account always comes from the credentials, never from the body.
8. Keep tokens out of logs. The endpoints carry the token in the path, so redact
   `/push/registrations/{token}` in access logs, proxies and error trackers (log a hash). A team that
   cannot redact paths moves the token into the body (`PUT /push/registrations` and
   `POST /push/registrations/delete` with `{ token }`); change the registrar and
   `server.registerEndpoint`/`unregisterEndpoint` together.

## 6. The payload

`data` is untrusted input: anyone who holds a token (and the Expo token is sent to the app's server
in clear JSON) can send any JSON, and a newer server sends kinds an old build has never seen.

- **Shape:** `{ "kind": "<kebab-case>", "<id>": "<opaque id>" }`. Ids match `^[\w-]{1,64}$`: never a
  path, URL or text a person wrote. Unknown fields are dropped (`v.object`), unknown kinds parse to
  `null` (the notification still shows; a tap just opens the app).
- **Strings only.** Through the Expo push service JSON types survive (on Android the service puts
  the data in `data.body` as a JSON string and expo-notifications parses it back; on iOS it puts it
  under the `body` key of the APNs payload). A direct FCM data message turns every value into a
  string, and a payload of strings survives both paths.
- **Native senders must mirror Expo's layout** (verified in expo-notifications 57.0.21 source):
  - iOS: `content.data` of a remote notification is `userInfo["body"]` (`NotificationRecords.swift`),
    so the APNs payload carries `"body": { "kind": ..., "taskId": ... }` next to `aps`. Custom keys
    at the top level are invisible to `content.data`.
  - Android: when `data.body` is a JSON object string it becomes `content.data`; otherwise the FCM
    data map is copied as is (all strings) (`NotificationSerializer.java`).
- **Size:** 4096 bytes for the whole notification. Ids, not documents: the app fetches the task by
  id through the ApiClient after the tap.

## 7. Taps and destinations

- `lastResponse()` (expo-notifications `getLastNotificationResponse()`, synchronous in SDK 57) gives
  the tap that launched or last resumed the app; `onResponse` gives taps while it runs. At a cold
  start the same tap can come through both, so `startPushTapRouting` handles each notification id
  once and clears the last response, so a remount or Fast Refresh does not open it again.
- **Each router clears only its own taps.** The data is parsed first; a tap whose data is not a
  push message (a local reminder, another feature's notification) is left alone, and its launch tap
  stays set. local-notifications' reminder router follows the same rule, so neither loses a launch
  tap to the other, whichever kit's effects run first (`clearLastNotificationResponse()` is
  synchronous and global: one router clearing everything would decide by hook order).
- The action id of a tap on the notification body (`DEFAULT_ACTION_IDENTIFIER`) is mapped to
  `'open'` by the adapter; action buttons keep their own ids and `destinationFor` returns `null` for
  the ones it does not handle.
- `destinationFor` maps a parsed message to a `PushDestination` (`task`, `list`, `inbox`); the app's
  route table maps the destination to a typed `Href` (`examples/push-destination-href.ts`, the kit's
  `hrefForDestination`). A
  payload never names a route: it would open debug routes, routes a guard hides, or routes an old
  build does not have.
- `usePushTaps` runs in the push root kit's effects, which app-startup-and-bootstrap's `RootKits`
  slot mounts beside the root Stack, below the navigator: Expo Router refuses to navigate before the
  root layout has mounted. A destination inside a protected group meets the same
  `Stack.Protected` guard as a deep link: a signed-out person lands on sign-in.
- Deep links (deep-links-and-universal-links) and push taps can share a destination table; they never
  share a URL parser, because a push is not a link and needs no URL.

## 8. The foreground policy

With the app open the OS shows nothing by itself: expo-notifications asks the one handler set with
`setNotificationHandler` and waits at most 3 seconds (`SingleNotificationHandlerTask.swift` uses a
3 s timer; the TypeScript docs say the same). No handler, a timeout or a rejection → the notification
is not shown. A second `setNotificationHandler` call replaces the first silently, so the app has
exactly one, installed by the push adapter, deciding for remote pushes and local notifications
(with local-notifications adopted, its adapter is created with `installForegroundHandler: false`).

`foregroundPresentation({ isRemote, message })`:

| Notification | banner | list | sound | badge |
|---|---|---|---|---|
| local (the app scheduled it: a reminder the person set) | yes | yes | yes | yes |
| `task-assigned`, `list-shared` (work handed to the person) | yes | yes | yes | yes |
| `announcement`, unknown data | no | yes | no | yes |

On Android `shouldPlaySound: false` also suppresses the heads-up banner whatever the priority
(expo-notifications type docs), which is why the quiet row turns both off together.
`shouldShowAlert` is deprecated; use `shouldShowBanner` and `shouldShowList`.

## 9. Sign-out and account switches

- **Sign-out** (auth-and-secure-storage): `pushRegistrationStep(registration)` is a server sign-out
  step named `push-registration`, listed in `contracts/auth.json` `serverSignOutSteps`. It runs before
  the token wipe, with the still-valid session, under the shared 5 s deadline; a failure is recorded
  by the session manager and sign-out goes on. After the wipe the call could not be authorized. The
  step passes auth's `ServerSignOutContext` on as `UnregisterOptions` (`accessToken` and `signal`),
  and the registrar sends that token as the bearer on the `DELETE` itself
  (`withAccessToken(accessToken)`), so sign-out depends on no client and no session state. Tokens
  removed: the saved record's (what the server accepted) first, then this run's newest token when
  it differs (a rotation whose register failed: the server never learned it, and 404 counts as
  done); a fetch only when neither is known. The saved record is cleared whatever the server answers.
- **The server's own duty:** a session that expires or is revoked skips the server phase, so the
  server deletes the registrations tied to that session itself (`server.dropOn`).
- **Account switch** without sign-out (a second account): the next sync sees another `accountId`
  and registers again; the server moves the token to the new account (one row per token, server
  duty 7).
- **A sign-out whose `DELETE` failed** (offline, deadline): the saved record is cleared anyway, so
  the next person's first sync registers the same token under their account and the server moves
  the row (duty 7); until then the server drops it as a revoked session's (`server.dropOn`). The
  previous person's notifications stop reaching the phone at the latest at that next registration.
- `unregisterForNotificationsAsync()` (it tells APNs/FCM to stop issuing tokens) is not used at
  sign-out: the next person would have to grant the permission again for nothing.

## 10. Composition and tests

Push is a root kit: it joins app-startup-and-bootstrap's slots from the app's registry
(`src/services/create-root-kits.ts`) and never edits a root file. `examples/create-app-push.ts`
creates the adapter once (it installs the handler), the registration over
`createApiPushRegistrar({ api: signedInApi, withAccessToken })` and
`createKvPushRecordAdapter({ errorLog })`; with accounts, `startApp` runs it before the session (the
session needs the registration for its sign-out step) and hands both to the registry, which wraps
them in `createPushKit` (`examples/create-root-kits.ts`): the provider gives the in-context ask
`usePushServices()` (`push`, `registration`, `openSettings`), and the effects sync the channels and the
registration, watch token rotations (`registration.start()`) and route taps. The account comes from a
`PushAccountSource` over the session (`NO_PUSH_ACCOUNT` without accounts). Without accounts the
registry creates the push parts itself. With local-notifications adopted, the registry creates its
adapter with `installForegroundHandler: false` (section 2); with permissions-and-system-prompts
adopted, `permissions.access.notifications` is `{ permission: push.permission, requestPermission:
push.requestPermission }` and the kit's `openSettings` is `permissions.openSettings`.

**Which client the registrar gets.** `services.api` is networking-and-server-state's plain client: it
sends no credentials. The server ties a registration to an account only through the request's
credentials (`PushRegistration` has no account id), so with `requiresAccount: true` the registrar
must never get `services.api`: every `PUT` would be answered 401, mapped to `rejected`, and the
device would never register. It gets the signed-in client (auth-and-secure-storage's
`createAuthorizedApiClient`), which needs the session, and the session needs
the push registration for its sign-out step. `examples/session-api-client.ts` breaks that
cycle: `signedInApi` exists from the start, answers `unauthorized` without a request until
`createAppSession` calls `push.signedInApi.attach(session)` right after creating the session
(`examples/create-app-session.ts`), and then signs every request. With `requiresAccount: false` the
registrar needs a client that signs when a session exists and sends anonymously otherwise: a fetch
client with auth's `sessionHeaders(session)` (no header while signed out) attached the same way,
not the signed-in client, which refuses every call while signed out.

Tests:

| What | How |
|---|---|
| Pure policy | `push-message`, `push-destination`, `foreground-presentation`, `registration-plan` tests (fast-check for "never throws", "never registers without permission") |
| Registration | `createPushRegistration` over `createFakePush()`, `createFakePushRecord()` (pass a saved record to test a new process) and a recording registrar; `flushMicrotasks()` after a rotation |
| Opt-in order | `push.calls` equals `['syncChannels', 'permission', 'requestPermission']` |
| Taps | `startPushTapRouting` with `createFakePush({ lastResponse })` and `push.tap(...)` |
| Hooks | `renderHook` with the fake; AppState faked as in `use-is-app-active.test.ts` |
| Root kit | `push-root-kit.test.tsx`: the kit's provider and effects in a router layout, the app active; channels and the registration synced on mount, `start()` once and stopped on unmount, the launch tap opening its route, an account change syncing again |
| Adapter | iOS: Jest's automock of expo-notifications; Android: a factory mock (section "Jest" in testing-push.md) |

## 11. When multi-package

The core files go to the shared package that holds pure domain code; the port, adapter, fake and
registration stay in the app package (the adapter imports a native module, and the root-kit registry
lives in the app). `contracts/push.json` stays at the repo root; check-push takes the app folder as
its root argument, so pass `--contract ../../contracts/push.json` (a path relative to that root) or
set `pushContract` in that app's `rn-skills.config.json`.
