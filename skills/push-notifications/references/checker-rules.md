# check-push rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-push.mjs [repo-root] [--contract <file>] [--json]`. App code
is every `.ts`/`.tsx` file under `srcDir` except tests (`*.test.*`, `*.spec.*`, `__tests__/`,
`testDir`); a push adapter is a `*-adapter.ts` (or `.ios`/`.android`/`.native`/`.web`) file under
`servicesDir`. Installed skills (`.agents/`, `.claude/`, `skills/`, any folder holding a `SKILL.md`)
and build output are never read.

## Contents

- 1 When it applies
- 2 Rules
- 3 Contract keys
- 4 Config keys
- 5 Reading a result

## 1. When it applies

| Repo fact | Result |
|---|---|
| no `package.json` | `ERROR [bad-input]`, exit 2 |
| `expo-notifications` not in `dependencies`/`devDependencies` | `NOT APPLICABLE: expo-notifications is not in package.json` |
| installed, no app code calls `getExpoPushTokenAsync`, `getDevicePushTokenAsync` or `addPushTokenListener`, and no push contract | `NOT APPLICABLE: ... (local notifications only)`: local-notifications governs it |
| a token API is called, or the contract exists | every rule below runs |

## 2. Rules

| Rule | Fails when | Fix |
|---|---|---|
| `push-contract` | a token API is called and the contract is missing, not JSON, or malformed (provider, requiresAccount, kebab-case unique kinds, channels with id and importance, defaultChannel among channels) | copy `templates/contracts/push.json`, fill it in |
| `push-token` | the contract exists but no app code requests a token | copy the adapter, or delete the contract |
| `push-adapter-only` | a token, permission, handler or response API of expo-notifications (`getExpoPushTokenAsync`, `getDevicePushTokenAsync`, `addPushTokenListener`, `setNotificationHandler`, `addNotificationResponseReceivedListener`, `getLastNotificationResponse(Async)`, `useLastNotificationResponse`, `clearLastNotificationResponse`, `requestPermissionsAsync`, `getPermissionsAsync`, `unregisterForNotificationsAsync`) used outside a push adapter, by named import or `Namespace.api` | go through `PushPort` |
| `permission-in-context` | a notification ask: `optInToPush(`, `<receiver>.requestPermission(` where the receiver's name contains `push` (`push.`, `services.push.`, `pushPort.`), or expo-notifications' `requestPermissionsAsync(` (named import or `Namespace.`), in a startup file (`<routesDir>/**/_layout.tsx`, `<featuresDir>/root-navigator/**`, `<servicesDir>/create-device-services.ts`) or inside `useEffect`/`useLayoutEffect`/`useFocusEffect`/`useMountEffect`. Other permission asks (`useCameraPermissions`' `requestPermission`, `MediaLibrary.requestPermissionsAsync`) stay silent (`pass-other-permission-in-effect`). Limits, by design (text heuristics, no type information): a push port renamed to something without `push` in it, a destructured `const { requestPermission } = push`, or an ask in a helper the effect calls is not seen; review effects that reach the push port | ask from an action handler |
| `expo-project-id` | provider `expo`: a `getExpoPushTokenAsync(` call whose arguments do not mention `projectId`, or an app config without `projectId` | `{ projectId }` from `readEasProjectId()`; `extra.eas.projectId` |
| `token-rotation` | a token is fetched and `addPushTokenListener` is used nowhere | `onTokenChange` + `registration.start()` |
| `channel-setup` | no `setNotificationChannelAsync` in app code | `PushPort.syncChannels` |
| `channel-contract` | `PUSH_CHANNELS` (each object's `id` and `importance`, in order) differs from the contract's `channels`, or the channels file is missing | make them equal; new behaviour, new id |
| `kinds-contract` | `PUSH_KINDS` (as a set) differs from the contract's `kinds`, the message file is missing, or it has no `safeParse(`/`parse(` call | add the kind to both; parse with valibot |
| `payload-parse` | `request.content.data` / `notification.content.data` read outside a push adapter | `parsePushData(response.data)` |
| `payload-navigation` | `router.push/replace/navigate/dismissTo`, `Linking.openURL` or `WebBrowser.openBrowserAsync` whose arguments contain `data.url`, `data.href`, `data.link`, `data.route`, `data.path`, `data.screen`, `data.deepLink` or `content.data` | `destinationFor` → typed href |
| `tap-handling` | app code lacks a launch-tap read (`getLastNotificationResponse` or `useLastNotificationResponse`), the response listener, or `clearLastNotificationResponse` | the template adapter + `startPushTapRouting` |
| `foreground-handler` | no `setNotificationHandler` in app code, or more than one; the one in the file that requests push tokens (the push adapter) is kept and every other call is reported (with local-notifications adopted: its adapter's, unless a file outside its folder passes `installForegroundHandler: false`) | one handler, one policy; with local-notifications adopted, pass `installForegroundHandler: false` to `createExpoLocalNotificationsAdapter` in the composition root (its guarded call site then does not count; never edit the copied adapter) |
| `deprecated-api` | `shouldShowAlert`, `getLastNotificationResponseAsync`, `clearLastNotificationResponseAsync` | `shouldShowBanner` + `shouldShowList`; the synchronous forms |
| `plugin-config` | the plugin is missing, listed without options, its `defaultChannel` (a literal, or a same-file string `const`) differs from the contract's, or it lacks `icon` or `mode`; or no app config exists at all | `['expo-notifications', { mode, icon, defaultChannel }]` |
| `fcm-config` | the app config does not mention `googleServicesFile` | `android.googleServicesFile` |
| `sign-out-unregister` | `requiresAccount: true` and `contracts/auth.json` `serverSignOutSteps` lacks `push-registration`; SKIP while `contracts/auth.json` does not exist | list it; pass `pushRegistrationStep(...)` |
| `push-wiring` | `createPushRegistration`, `usePushSync`, `usePushTaps` or `createPushKit` (the root kit, registered in `src/services/create-root-kits.ts`) is exported by an app file and called by no other app file; or a literal `requiresAccount: true`/`false` inside a `createPushRegistration(...)` call differs from the contract's `requiresAccount` | wire it (examples); pass the contract's value |
| `client-send` | app code mentions `exp.host/--/api/v2/push/send`, `api.expo.dev/v2/push/send`, `fcm.googleapis.com`, `api(.sandbox).push.apple.com`, or imports `expo-server-sdk` | send from the server |
| `push-credentials` | anywhere in the repo: a `.p8`/`.p12` file; a JSON file with `"type": "service_account"` and `"private_key"`; an `EXPO_PUBLIC_*` name containing `EXPO_ACCESS` or `PUSH` and ending in `TOKEN`, `KEY` or `SECRET` | delete, rotate (a person), keep keys in EAS and on the server |

Each rule is a text check, so it has limits: `permission-in-context` cannot see a prompt asked from
a function an effect calls in another file, `push-wiring` cannot see a call made with another name
and compares `requiresAccount` only when the call passes a literal (a variable or a config read is
not followed: keep the literal where the registration is created), `foreground-handler` keeps the token
file's handler only when that file also calls `setNotificationHandler`, `payload-navigation`
sees only the listed field names, and `push-wiring` proves that `usePushTaps` is called, not where:
the push root kit's effects call it beside the root Stack, below the navigator, and `push-wiring`
fails a kit that the registry never creates (`createPushKit` defined but never called); never call it
in `src/app/_layout.tsx` above a startup gate that renders nothing at first. No rule checks which ApiClient the registrar gets (the signed-in
one when `requiresAccount` is true): review it against architecture-and-contract.md section 10. The Jest tests of the templates (tap
dedupe, the opt-in order, the registration plan) cover what text cannot.

## 3. Contract keys (contracts/push.json)

`provider` (`expo` | `native`), `requiresAccount` (boolean), `kinds` (kebab-case, unique),
`channels` (`[{ id, importance }]`), `defaultChannel`, `files.message` (default
`src/core/push/push-message.ts`), `files.channels` (default `src/services/push/push-channels.ts`),
`server` (free-form facts for the backend; not read). The schema is `push.schema.json` beside it.

## 4. Config keys (rn-skills.config.json)

The layout keys `srcDir`, `routesDir`, `featuresDir`, `servicesDir`, `testDir`, `contractsDir`, and
`pushContract` (the contract path, repo-relative). `--contract` overrides `pushContract`.

## 5. Reading a result

```
FAIL src/app/_layout.tsx:6 [permission-in-context] requestPermission(...) in a startup file: ... Fix: ...
SKIP contracts/auth.json [sign-out-unregister] not yet created (auth-and-secure-storage creates it)
check-push: 42 files checked, 1 problems
RESULT: FAIL (1 problems)
```

Exit 0 pass (SKIP and NOT APPLICABLE included), 1 problems, 2 bad input. The only SKIP a passing run
may print is the `sign-out-unregister` one above, while the app has no auth contract yet.
