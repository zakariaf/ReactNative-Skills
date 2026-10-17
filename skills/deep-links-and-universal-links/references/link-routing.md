# Routing incoming links: the gate, the allow-list, cold and warm starts

How an Expo Router app receives a link, why every link goes through one gate, what the gate decides,
and how the decision is tested. Verified on 2026-10-14 in this library's reference Expo app: Expo SDK 57
(expo 57.0.26), expo-router 57.0.24, expo-linking 57.0.11, React Native 0.86.3, Jest 29.7 with jest-expo 57
and RNTL 14. Re-verify on a new SDK: run the template tests
(`npx jest src/core/links src/features/deep-links src/services/deep-links src/hooks --selectProjects unit`)
and reread `node_modules/expo-router/build/getLinkingConfig.js` and `build/link/linking.js`.

## Contents

1. How a link reaches the router (read in source)
2. Why one gate, and why an allow-list
3. What the gate decides
4. The allow-list (`LINK_ROUTES`)
5. Where links may come from (origins)
6. Cold start, warm start and gated routes
7. Links never act
8. Neighbours: OAuth redirects, notifications, the debug link, outgoing links
9. Testing recipes
10. Pitfalls and the rule each one became

## 1. How a link reaches the router (read in source)

Expo Router builds React Navigation's `linking` config itself; the app writes no `linking` object and no
`Linking` listener. In expo-router 57.0.24:

- **Cold start.** `getLinkingConfig().getInitialURL()` reads the launch URL (`Linking.getLinkingURL()` on
  iOS, `getInitialURL` with a timeout on Android). When the app was opened from the home screen, there is
  no link and the router uses the root URL `Linking.createURL('/')` (`<scheme>:///`). The URL then goes
  through the `redirects` of the expo-router plugin config and, when `src/app/+native-intent.tsx` exports
  `redirectSystemPath`, through `redirectSystemPath({ path, initial: true })`. The value it returns (a
  string, a promise, or null) is the initial URL. It is memoised: called once per launch.
- **Warm start.** `subscribe()` listens to expo-linking's `url` event. Each URL goes through the same
  redirects and then `redirectSystemPath({ path, initial: false })`; a falsy answer means "no navigation,
  stay on the current screen", any string is routed.
- **`path` is not a path.** For a warm link it is the full URL (`tasks://tasks/task-7?x=1`); for a cold link
  it is the launch URL, or a bare path in tests (`renderRouter`'s `initialUrl`). Treat it as an arbitrary
  string.
- **What the router does with a URL.** `extractPathFromURL` strips an `http(s)` origin whatever the host
  (it never checks the host), turns a custom scheme's host into the first path segment
  (`tasks://tasks/7` is `/tasks/7`; `tasks:///tasks/7` too), maps `exp.host` and `u.expo.dev` links to `/`,
  and **decodes query values and joins them again without re-encoding**: `?q=a%26b` becomes `q=a&b`, a
  second key. Returning an already-encoded path (`/tasks/7?q=a%26b`) avoids that: a path starting with `/`
  is used as it is (verified in the router test: `highlight` arrives as `a&b`, whole).
- **A throw crashes.** `redirectSystemPath` runs during the root render (cold) or in the URL listener
  (warm). expo-router does not catch it; its own docs say to wrap the body in try/catch.
- **No app context.** `+native-intent` is evaluated outside the React tree: no providers, no hooks, no
  session. It can read modules (the gate registry, the inbox) but not React state.
- **Web is different.** `+native-intent` is native-only; on the web the server resolves the URL before any
  JavaScript runs (server redirects or a root-layout redirect). web-support owns the web side.

## 2. Why one gate, and why an allow-list

Expo Router makes **every file in `src/app` a URL**. Without a gate, `tasks://settings/delete-account`,
`tasks://checkout/confirm?amount=0` or a debug screen open from any web page, chat message, QR code or
other app, with any params. A link is untrusted input in the strongest sense:

- Any app can register the app's custom scheme. On iOS which app opens it is undefined; on Android the
  user picks from a chooser. So a custom-scheme link can be **received** (intercepted) by another app.
- Any app can **send** the app a link. On Android another app can fire an explicit intent at the app's
  exported activity with any URL, including an `https` URL of the app's own verified domain: App Links
  verification decides which app the system picks for a tapped link, not who may send one.
- Links are long-lived: old emails, cached pages and screenshots carry URLs from earlier app versions.

So: **one gate** (`redirectSystemPath` in `+native-intent`) sees every link of every kind, cold and warm,
and it opens **only allow-listed routes** with values that passed a closed pattern. Everything else lands on
the first screen (cold) or changes nothing (warm). The screen still parses its params with its own valibot
parser (navigation-and-routing's `paramParsers`), because in-app navigation never passes the gate.

## 3. What the gate decides

`routeIncomingLink(raw, policy, isGateOpen)` (`src/core/links/route-incoming-link.ts`) returns one of:

| Decision | When | `redirectSystemPath` returns |
|---|---|---|
| `home` | the bare scheme or `/` (a normal launch) | `/` cold, `null` warm |
| `open` | an allow-listed route, values of the right kind, origin allowed | the re-encoded href |
| `deferred` | an allow-listed route behind a closed gate | `/` cold, `null` warm; the inbox keeps it |
| `refused` | anything else, with a reason | `/` cold, `null` warm |

Refusal reasons (`LinkRefusal`): `too-long` (over 2048 characters), `unparsable`, `foreign-scheme`,
`foreign-host`, `credentials` (user info in the URL), `port`, `bad-encoding` (malformed `%`),
`unknown-route`, `bad-param` (right shape, wrong kind), `bad-query` (a value over 256 characters or with a
control character), `repeated-query` (a kept key given twice), `test-build-only`, `unverified-origin`.

Why each answer:

- **Cold refusal → `/`**: the router must render something; the first screen is the only screen that is
  always valid. Never print the refused URL anywhere (it can hold anything, navigation-and-routing's
  not-found rule says the same).
- **Warm refusal → `null`**: the person is somewhere in the app, maybe mid-edit. Navigating home would throw
  their work away for a link that opens nothing.
- **A crash → reported, then the same as a refusal.** `attempt(...)` (error-handling-typed-results)
  converts the throw; `report` hands it to the error net (`appErrorNet.report`), because the gate has no
  services context.
- **Synchronous.** A promise from `redirectSystemPath` holds the first screen until it settles, and a
  rejection is unhandled with the link lost. Short links and referral codes resolve in a landing route
  (`/l/[code]`) that shows progress, resolves through the `ApiClient` port and replaces itself with
  `router.replace` (networking-and-server-state).

## 4. The allow-list (`LINK_ROUTES`)

`src/features/deep-links/link-routes.ts` lists every route a link may open:

```ts
export const LINK_ROUTES: readonly AppLinkRoute[] = [
  { path: '/tasks/[taskId]', params: { taskId: 'slug' }, query: ['highlight'] },
  { path: '/tasks/new' },
  {
    path: '/lists/[listId]',
    params: { listId: 'uuid' },
    gate: 'signed-in',
    open: (values) => ({ pathname: '/lists/[listId]', params: { listId: values['listId'] ?? '' } }),
  },
  { path: '/verify-email', query: ['token'], verifiedOnly: true },
  { path: '/oauth-redirect' },
  { path: '/debug/setup', query: 'any', testBuildOnly: true },
];
```

- **`path`** is the URL, not the file: groups are not part of it (`(app)/tasks/[taskId].tsx` is
  `/tasks/[taskId]`). Catch-alls (`[...rest]`) are not linkable: they accept any depth.
- **`params`** gives each dynamic segment a kind: `slug` (`^[a-z0-9][a-z0-9-]{0,63}$`), `uuid` (lowercase
  RFC 9562), `int` (up to nine digits). A segment is decoded once and must match its kind, so `..%2F`,
  `%00`, uppercase and 5 KB strings never reach a screen. Add a kind to `PARAM_KINDS` with its test when an
  id has another shape; never a free-text kind.
- **`query`** lists the keys the screen reads. Other keys are **dropped, not refused**: platforms append
  `utm_*`, `fbclid`, `gclid` to shared links, and refusing them would break marketing links. A kept key may
  appear once, and never shares a name with a segment (`open()` receives both in one object, and the
  checked segment value must win; `linkRouteProblems` and `link-routes` refuse it). `'any'` passes every pair through and is allowed only with `testBuildOnly` (the debug link
  has its own strict parser in debug-menu-and-test-hooks).
- **`verifiedOnly`** accepts the route only from an http(s) link of a verified host (Android verifies both
  schemes for App Links; iOS delivers only https universal links). Use it for anything that
  carries a secret: email verification, password reset, magic sign-in. Verified links cannot be received by
  another app; custom-scheme links can. The secret itself is single-use, short-lived and confirmed on
  screen, because verified links can still be sent by anyone.
- **`testBuildOnly`** opens the route only in development and preview builds (`currentAppVariant()`).
- **`gate`** names the `Stack.Protected` guard the route sits behind; `open` builds the typed href for the
  deferred case (section 6). Only gated entries need `open`; it keeps typed routes on for the one place
  where JavaScript navigates to a link (an `as Href` cast is banned in app code by navigation-and-routing).

The table is data plus types only, so the checker loads it in Node and replays the gate (checker.md).

## 5. Where links may come from (origins)

`appLinkPolicy()` builds the policy from the build itself:

- **Schemes**: expo-linking's `collectManifestSchemes()`: the config's `scheme` plus the platform's
  `ios.scheme` or `android.scheme`, nothing else (read in expo-linking 57.0.11 `build/Schemes.js`; it has
  no bundle-id fallback). Each variant has its own scheme (app-variants-and-environment), so a development
  build never answers a production link. On iOS prebuild also registers `ios.bundleIdentifier` as a URL
  scheme (`@expo/config-plugins` `ios/Scheme.js`, kept for Google Sign-In): links on that scheme reach the
  app and the gate refuses them as `foreign-scheme` unless the app lists the id in `scheme`. That is the
  intended fail-closed behaviour.
- **Hosts**: `Constants.expoConfig.ios.associatedDomains` (`applinks:` entries, `?mode=` stripped) and the
  hosts of `android.intentFilters` with `autoVerify: true`. Both survive in the public config: verified on
  2026-10-14 with `APP_VARIANT=production npx expo config --type public --json`, and in source
  (`@expo/config` removes only `mods`, `hooks`, `_internal`, `ios.config`, `android.config` and the update
  signing fields).

Both come from the running config, which after an `eas update` is the update's manifest: publish every
update with the build's `APP_VARIANT`, or the gate accepts another variant's scheme and hosts
(universal-and-app-links.md, section 6).

The OS delivers verified links only for those hosts, so accepting exactly them costs nothing and refuses an
`https` URL of another host that some app fired at the activity. `*.example.com` matches subdomains, not
`example.com` itself; list the root separately.

## 6. Cold start, warm start and gated routes

| Situation | What happens |
|---|---|
| Cold, ungated route | `open`: the router renders the route directly. With `unstable_settings.anchor` in the group layout, the anchor screen sits below it, so Back has somewhere to go |
| Warm, ungated route | `open`: the router pushes the route on the current stack |
| Gated route, gate open (warm) | `open` at once |
| Gated route, gate closed or not yet known (any cold start) | `deferred`: the inbox keeps `{ gate, target }`; the gate returns `/` (cold) or `null` (warm) |
| The gate opens later | the first screen behind the guard calls `useOpenPendingLink(gate)`: it takes the link once and pushes it, so Back returns to that screen |

Why the inbox: on SDK 57 a link into a `Stack.Protected` group whose guard is false lands on the first
reachable screen, and after sign-in nothing returns the person to the link (navigation-and-routing pins
it; SDK 58 adds `redirectTo` on `Stack.Protected`). The gates register through `useLinkGate(gate, isOpen)`
from the component that owns the guard; `+native-intent` cannot read React state. At a cold start the
gates have not registered yet, so every gated cold link is deferred and opened from the first screen, one
consistent path. The inbox holds one link in memory: the newest wins, a kill drops it (that is its expiry),
and sign-out calls `pendingLinks.clear()`.

No root wiring: this kit is not one of app-startup-and-bootstrap's root kits and never edits the root
skeleton. Expo Router calls `+native-intent` itself, outside React and before the root layout renders, so
the gate needs no provider, no startup task and no effect beside the root Stack; the only React pieces
are `useLinkGate` in the component that owns a guard and `useOpenPendingLink` in the first screen behind
it. The notification kits (push-notifications, local-notifications) that do plug into the root slots
route their taps themselves and never through this gate.

## 7. Links never act

A link opens a screen; the person acts. No route opened by a link performs a mutation, purchase, payment,
deletion, sign-in or settings change on arrival:

- The task link shows the task; "Complete" is a button.
- The email-verification link shows "Verify this address" and the server checks the single-use token on
  the tap; the account screen confirms.
- An invitation link shows who invited whom and to what, then "Join".
- A "pay" or "subscribe" link opens the paywall (in-app-purchases), which shows the price.

Why: a link can be sent by anyone, prefetched by mail scanners, or opened twice (the launch URL is
re-delivered after a reload). An action on arrival is cross-site request forgery for apps. The
`gate-behaviour` replay cannot see effects, so this is a review rule: a linkable route's model hook runs
no mutation in an effect.

A link's params never become an href either. A post-sign-in return is not a `returnTo`, `next` or
`redirect` query param handed to `router.replace`/`router.push` (`?next=/settings/delete-account` would
skip the allow-list and land the person on any screen): the gated entry records the link in the
pending-link inbox (`gate` + `open()`, section 6) and the first screen after sign-in opens it through
`useOpenPendingLink`, re-decided by the same allow-list. navigation-and-routing's typed routes and its
`href-cast` rule (no `as Href`) are what stop `router.replace(params.next)` at compile time.

## 8. Neighbours: OAuth redirects, notifications, the debug link, outgoing links

- **OAuth redirect (Android).** expo-web-browser reads `<scheme>://oauth-redirect?code=...` itself while
  the auth session is open and hands the result to the code that called `openAuthSessionAsync`; Android
  also delivers the same URL to the app as a link. The route only has to exist (no not-found flash) and
  step back; it never reads the code (auth-and-secure-storage owns the route and the PKCE check). List it
  as `{ path: '/oauth-redirect' }` with no query keys, so the gate drops `code`, `state` and `error` and
  the authorization code never lands in route params, navigation state or screen tracking, where logs
  could pick it up. Google's iOS client uses the reversed
  client id scheme (`com.googleusercontent.apps.<id>:/oauthredirect`); add that scheme in the config and it
  reaches the policy through `collectManifestSchemes()`.
- **Notification taps.** A push or local notification carries a `kind` and ids, never a URL
  (push-notifications' `parsePushData`, local-notifications). The tap handler maps the parsed message to a
  typed href in its own code. If a notification ever carries a URL, it goes through `routeIncomingLink` like
  any link (`initial` follows whether the tap launched the app).
- **The debug link.** debug-menu-and-test-hooks owns `<scheme>://debug/setup?...` (an Expo Router route
  rendering `TEST_ONLY?.DebugSetupRoot`). List it as `{ path: '/debug/setup', query: 'any',
  testBuildOnly: true }` so test builds let it through and production refuses it before the route renders.
- **Outgoing share links.** Share the `https` URL of the verified host (`https://tasks.example.com/tasks/7`),
  built in `src/config` (links live there; the lint config bans remote URLs elsewhere). People without the
  app get the web page; people with it get the app. Never share a custom-scheme link: it opens nothing
  without the app, and any app may answer it. `examples/share-task-link.ts` shows the shape.
- **Share intents (not covered here).** Receiving files or text from another app's share sheet (an iOS
  share extension, an Android `SEND` intent) needs a share library and native configuration, and this
  skill does not cover it. Know what the gate does to it: a library that hands over through a URL such as
  `<scheme>://dataUrl=<key>` is refused as `unknown-route`, so the hand-off leads to the first screen.
  Whoever adds share receiving lists a landing route for it in `LINK_ROUTES` with a closed kind for the
  key (never the file path or contents in the URL) and reads the shared item from the library's own
  store on that screen.
- **Opening other apps.** `Linking.openURL` only with URLs the app builds; never a URL taken from a link's
  params (`open-redirect`). On iOS, `canOpenURL` needs `LSApplicationQueriesSchemes`.

## 9. Testing recipes

| What | Where | How |
|---|---|---|
| Parser facts | `src/core/links/incoming-link.test.ts` | vectors: own scheme, verified host, foreign scheme and host, user info, port, `//`, malformed `%`, over-long |
| Decisions | `src/core/links/route-incoming-link.test.ts` | each refusal reason; static beats dynamic; query re-encoding; deferred vs open; fast-check: never throws, idempotent on its own hrefs |
| Gate contract | `src/features/deep-links/redirect-system-path.test.ts` | cold `/` vs warm `null`; deferred goes to the inbox; a crash is reported |
| Policy | `src/features/deep-links/app-link-policy.test.ts` | mock `expo-constants` and `expo-linking`; schemes and hosts come from the config |
| In the real router | `src/features/deep-links/deep-links-navigation.test.tsx` | a `'+native-intent'` entry in the route map; cold via `initialUrl`; warm by calling the router's `url` listener; gated cold link opens from the first screen with Back to it |
| Inbox and gates | `src/services/deep-links/*.test.ts`, `src/hooks/use-*-link*.test.ts(x)` | once, newest wins, per gate; gate closes on unmount |
| Devices | device-testing.md | `simctl openurl` / `adb am start` on named devices, Maestro `openLink`, cold and warm |

Router-test facts (expo-router 57.0.24, RNTL 14.0.1): `renderRouter`'s `initialUrl` is parsed against a
base, so only the path and query reach `redirectSystemPath` (a scheme URL loses its host); warm links are
full URLs. The router subscribes to `url` events through expo-linking once per test file, at the first
render, and the Jest config restores spies before every test, so the template test mocks `expo-linking`
with a factory that records the listener on the module (no `jest.spyOn`). expo-router's testing library
registers its own expo-linking mock when the test helper is imported; `expo-router` is imported first
(the lint import order puts packages before `@test/*`), so the router keeps the test's mock.

## 10. Pitfalls and the rule each one became

- **A second listener.** `Linking.addEventListener('url')` in a hook beside the router: every link
  navigated twice, and the hook opened links the gate refused (`one-listener`).
- **Listening only after the navigator is ready.** A link sent right after launch was lost: React
  Native's `Linking` delivers a link once, as the launch URL or as an event to the listeners attached then.
  Expo Router reads the launch URL itself; a hand-written listener started late misses it.
- **Returning `path` "for now".** A `+native-intent` that returned the path unchanged shipped and opened
  any screen from any link (`intent-gate`).
- **`navigate('/')` for a refused warm link.** Lost an unsaved form for a link to an old page; return
  `null`.
- **Query values decoded and rejoined.** A highlight value with `&` became two keys; the gate re-encodes.
- **`useLocalSearchParams<{ id: string }>()`.** Repeated keys arrive as arrays and any text arrives; the
  screen parses (navigation-and-routing).
- **A secret on the custom scheme.** A password-reset token in `tasks://reset?token=...` reached another
  app that registered `tasks` (`link-secret`).
- **A debug link in production.** Opened an empty debug route from a support article (`link-test-only`).
