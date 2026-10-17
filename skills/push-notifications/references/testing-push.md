# Testing push

Three levels: Jest proves the logic with fakes (every commit), a named simulator or emulator proves
the native path without a server (while building), and physical devices prove delivery end to end
(before every release). Verified on 2026-10-14 with jest-expo 57.0.5, Xcode 26.6 and Android API
level 36; re-verify with `npx jest --ci src/services/push src/core/push src/hooks/use-push-*`.

## Contents

- 1 Jest
- 2 iOS simulator
- 3 Android emulator
- 4 Sending a real push in development
- 5 The device checklist
- 6 E2E with Maestro

## 1. Jest

- **Default off.** No test reaches the real SDK: models and hooks get `createFakePush()`, and a
  screen that asks reads `usePushServices()`, which throws outside the push kit's provider, so a
  screen test that touches push without wrapping it in `<PushProvider value={...}>` (fakes) fails
  loudly instead of calling a native module.
- **Fake recipes:**
  - order of calls: `expect(push.calls).toStrictEqual(['syncChannels', 'permission', 'requestPermission'])`;
  - a prompt refusal: `createFakePush({ permission: 'undetermined', promptAnswer: 'denied' })`;
  - Settings switched off: `push.setPermission('denied')`, then `registration.sync(id)` → `'unregister'`;
  - a new process after Settings: `createFakePushRecord(saved)` passed as `record`, permission
    `'denied'`, then `registration.sync(id)` → `'unregister'` and `record.read()` → `null`;
  - a rotation: `push.rotateToken({ ...FAKE_PUSH_TOKEN, value: 'new' })`, then `await flushMicrotasks()`;
  - a launch tap: `createFakePush({ lastResponse: { id, action: 'open', data } })`; a later tap: `push.tap(...)`;
  - an offline token: `push.setToken(err({ kind: 'network-unavailable' }))`.
- **The registrar** is a plain object recording calls (`push-registration.test.ts`); the real one
  over the ApiClient is tested with `createFakeApiClient` (networking-and-server-state). Once
  `examples/push-registrar.ts` and `examples/session-api-client.ts` are copied, tdd-workflow reports
  them untested until their tests assert these cases:
  - `register` answered 401 (`unauthorized`) → `rejected` (the device is not registered; the next
    trigger retries);
  - `unregister` answered 404 → done (the server no longer holds it);
  - a retryable failure (offline, timeout, 5xx) → `unavailable`, never `rejected`;
  - the sign-out `DELETE` goes through `withAccessToken(accessToken)` and carries
    `Authorization: Bearer <that token>`, not the session client's;
  - the session client before `attach(session)` answers `unauthorized` without sending a request,
    and signs every request after it.
- **The adapter (iOS project):** `jest.mock('expo-notifications')` (Jest's automock keeps the enums
  and `DEFAULT_ACTION_IDENTIFIER`, and turns functions into mocks). Listener functions return
  `undefined` under the automock, so give them `{ remove: jest.fn() }` in a `beforeEach`. Read the
  installed handler from `setNotificationHandler.mock.calls` and call `handleNotification` with a
  notification whose `request.trigger.type` is `'push'` (remote) or anything else (local).
  Type the mock as `jest.requireMock<ExpoNotificationsSdk>('expo-notifications')`, the module type
  the adapter exports: the test may not import expo-notifications itself, not even a type (the
  canonical ESLint vendor ban covers type imports in every file but an adapter).
- **The adapter (Android project, `*.android.test.ts`):** jest-expo's Android environment looks like
  Expo Go, where importing expo-notifications throws ("removed from Expo Go with the release of SDK
  53"), and the automock loads the real module first. Mock with a factory that lists the functions and
  enum values the test needs (`expo-notifications-push-adapter.android.test.ts`).
- **A test that creates the real adapter** (a registry or push-parts test): it imports
  expo-notifications in the unit project, and jest-expo
  prints the "removed from Expo Go" `console.warn` on every run. Mock it in that test with a factory
  that lists only what creating the adapter touches; a bare `jest.mock('expo-notifications')` does
  not help, because the automock loads the real module (and its warning) to copy its shape
  (verified on 2026-10-14 with jest-expo 57.0.5):

  ```ts
  jest.mock('expo-notifications', () => ({
    AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
    setNotificationHandler: jest.fn(),
  }));
  ```
- **Hooks:** `renderHook` from RNTL 14 is async (`await renderHook(...)`, `await act(...)`); fake
  AppState as `use-is-app-active.test.ts` does (`Object.defineProperty(AppState, 'currentState', ...)`
  and a spied `addEventListener`).

## 2. iOS simulator

A simulator receives remote pushes (Xcode 14+, iOS 16+), and `simctl` can deliver one without APNs,
the server or credentials. Always name the device: create one for the purpose and use its UDID.

```sh
UDID=$(xcrun simctl create tasks-push "iPhone 17")   # newest installed runtime
xcrun simctl boot "$UDID"
# install and launch a development build, grant the permission in the app (the in-context button)
xcrun simctl push "$UDID" com.example.tasks.dev examples/task-assigned.apns
```

- The payload file (`examples/task-assigned.apns`) puts the data under `"body"`: expo-notifications
  reads a remote notification's data from `userInfo["body"]` on iOS. With `"Simulator Target Bundle"`
  in the file the bundle id argument may be omitted.
- Test each app state: foreground (the handler decides: a `task-assigned` shows a banner, an
  `announcement` only lands in the list), background, and killed (tap → `lastResponse()`).
- A simulator push proves the payload, the handler and the tap routing; it does not prove the token,
  the credentials or the server: that is section 4.
- Delete the simulator afterwards: `xcrun simctl delete "$UDID"`.

## 3. Android emulator

- Create an AVD with a **Google Play** system image (FCM needs Google Play services) and name it for
  the purpose (`tasks-push`); start it by name and address it by serial (`adb -s emulator-5554 ...`).
- There is no `simctl push` equivalent for FCM: send a real push (section 4) to the emulator's
  token. `adb -s <serial> shell cmd notification post ...` posts a *local* notification from the
  shell: useful to look at the channel, not a test of push.
- Check channels: `adb -s <serial> shell dumpsys notification | grep -A3 <package>` lists the
  channels the app created with their importance; Settings → Apps → Tasks → Notifications shows the
  translated names.
- Android 13+ permission states: `adb -s <serial> shell pm revoke <package> android.permission.POST_NOTIFICATIONS`
  resets to "not granted" for testing the prompt path; `pm grant` grants without a prompt.

## 4. Sending a real push in development

- The Expo push notifications tool (expo.dev/notifications) sends to one Expo push token; paste the
  token from a development build's debug screen (debug-menu-and-test-hooks), never from logs in a
  release build.
- From a terminal (development only, never from the app, never with the production access token):

```sh
curl -H 'Content-Type: application/json' -X POST https://exp.host/--/api/v2/push/send -d '{
  "to": "ExponentPushToken[...]",
  "title": "Task assigned",
  "body": "A task was assigned to you",
  "data": { "kind": "task-assigned", "taskId": "t-1" },
  "channelId": "task-updates"
}'
```

  With enhanced push security on, add `-H "Authorization: Bearer $EXPO_ACCESS_TOKEN"` from a
  development token the developer gives you; stop and ask rather than look for one.
- Read the ticket in the response; for a ticket id, `POST https://exp.host/--/api/v2/push/getReceipts`
  with `{ "ids": ["..."] }` about 15 minutes later shows APNs/FCM errors (`DeviceNotRegistered`,
  `InvalidCredentials`, `MismatchSenderId`).

## 5. The device checklist

Before a release, on one named iPhone and one named Android phone (13+), with a build from the
release profile and the staging server:

1. Fresh install: no prompt at launch; the in-context action shows the explanation, then the prompt.
2. Refuse: the screen says so and offers nothing that does nothing; on iOS a second visit offers
   Settings; on Android the second refusal leads to Settings next time.
3. Allow: the server shows one registration with platform, provider, language.
4. Foreground: a `task-assigned` shows a banner with sound; an `announcement` only lands in the list.
5. Background and killed: tapping each kind opens its screen once (not twice), with the right id.
6. A kind this build does not know (send `task-archived`): shown, tap opens the app, nothing breaks.
7. Turn notifications off in Settings, return to the app: the registration is removed (Android
   restarts the app after the revoke; the saved record still names the token).
8. Change the app language, return: the next push arrives in the new language.
9. Sign out: no push for that account arrives any more; sign in as someone else: theirs do.
10. Android: Settings lists the channels with translated names; muting one silences only that kind.
11. Reinstall: a new token registers; the old one returns `DeviceNotRegistered` and the server
    deletes it.

## 6. E2E with Maestro

Maestro flows cannot receive a real push, but they can test the in-context ask and the screens a
tap opens: drive the opt-in button, handle the system dialog (`- tapOn: "Allow"` on iOS,
`"Allow"` on Android 13+), and open destinations through the app's debug deep links instead of taps.
On iOS, `xcrun simctl push` from the flow's runner script (with the simulator's UDID) delivers a
notification during a flow. Flow conventions and device binding are e2e-maestro's.
