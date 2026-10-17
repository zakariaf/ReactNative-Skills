# The ApiClient port and the fetch transport

How the app talks to its server: one port (`ApiClient`), one transport over `fetch`
(`src/api/fetch-api-client.ts`), and what the platforms underneath actually do. Verified on 2026-10-04
against an Expo SDK 57 app (`expo` 57.0.26, React Native 0.86.3) by reading the installed sources;
the re-verify commands are in section 9.

## Contents

1. The shape: port, transport, fake
2. What `fetch` is in an Expo SDK 57 app
3. Deadlines: why the client sets its own
4. Cancellation: one AbortController per attempt
5. Classifying a failure without reading error text
6. URLs, headers, bodies, idempotency
7. Base URL per variant, HTTPS, cleartext on iOS and Android
8. HTTP caching and cookies underneath the client
9. Verified facts and how to re-verify them

## 1. The shape: port, transport, fake

```
src/api/api-client.ts        ApiClient (the port), ApiRequest, NO_CONTENT
src/api/api-failure.ts       ApiFailure (the failure family), isRetryableFailure
src/api/fetch-api-client.ts  createFetchApiClient (the only app file that calls fetch), deviceFetch
src/api/build-url.ts         base + path + query, by string
src/api/to-api-failure.ts    status -> failure, rejection -> failure, JSON parsing
test/api/fake-api-client.ts  the scripted ApiClient every test above the transport uses
```

- **One port, `request<T>(ApiRequest<T>) => Promise<Result<T, ApiFailure>>`.** A request names its
  method, path, optional query and JSON body, the valibot schema its response must match, the caller's
  `signal` and an optional idempotency key. The port lives in `src/api/` (not `src/services/`) because
  the house layout puts the ApiClient, its schemas and query keys there.
- **It never rejects.** Offline, timeouts, cancellation, HTTP errors and invalid bodies are values; a
  thrown programmer error (a path without the leading slash, a body `JSON.stringify` cannot encode) is
  a bug and throws. error-handling-typed-results owns this split; the ApiClient is one of its
  boundaries.
- **The transport takes `fetch` as an argument.** The composition root passes `deviceFetch` (the
  global); tests pass a fake. Lint bans the global `fetch` in tests and outside `src/api/`, so a test
  can never hit the network by accident, and no other module can call the network at all.
- **The fake lives in `test/`, not `src/`.** No app file can import it, and it validates canned bodies
  through the request's schema exactly like the real client, so a test of a query also proves its
  schema. An unscripted request rejects and names itself.

## 2. What `fetch` is in an Expo SDK 57 app

On iOS and Android the global `fetch` is **expo/fetch**, not React Native's whatwg-fetch over
XMLHttpRequest. `expo/src/winter/runtime.native.ts` installs it at startup unless
`EXPO_PUBLIC_USE_RN_FETCH` is `1` or `true`; Expo's SDK 57 docs say the same ("On Android and iOS,
expo/fetch is also installed as the global fetch"). The same file installs spec-compliant `URL` and
`URLSearchParams` (whatwg-url-minimum), `TextDecoder`, `structuredClone`, and patches
`AbortSignal.timeout` and `AbortSignal.any` when Hermes lacks them.

| | expo/fetch (default) | React Native fetch (`EXPO_PUBLIC_USE_RN_FETCH=1`) |
|---|---|---|
| Native layer | `NSURLSession` (iOS), OkHttp (Android) through the Expo module `ExpoFetchModule` | `RCTNetworking` / React Native's OkHttp networking module |
| Rejection | `FetchError` with the message `fetch failed: <native reason>` | `TypeError('Network request failed')` |
| Aborted before start | `FetchError('The operation was aborted.')` with `cause: signal.reason` | `AbortError` |
| Aborted in flight | the native request is cancelled (`Fetch request has been canceled`) | `AbortError` |
| Streaming bodies | yes (`response.body` is a ReadableStream) | no |

Because the two disagree on every error message, **the client never reads error text** (section 5).
In Jest the global `fetch` is Node's; nothing in the app's tests reaches it.

## 3. Deadlines: why the client sets its own

| Platform | What expo/fetch sets | Effect without an app deadline |
|---|---|---|
| Android | the OkHttp client from React Native's `OkHttpClientProvider.createClient(context)`: connect, read and write timeouts of **0** ("No timeouts by default") | a request to a host that accepts the connection and never answers waits forever |
| iOS | `request.timeoutInterval = 0` on each `NSMutableURLRequest`, `URLSessionConfiguration.default` for the session | the session's idle timeout (60 s per Apple's documentation; not measured here) applies, per idle period, not per request |

So `createFetchApiClient` gives every attempt one deadline (`timeoutMs`, default 15 s) that covers
the response **and** reading the body: a server that sends headers and then stalls the body times out
too. The deadline is a `setTimeout` that aborts the attempt's `AbortController`, which is testable with
a 5 ms timeout and real time (no fake timers, which unit-and-component-tests keeps out of logic tests).
`AbortSignal.timeout` would also work on device (Expo patches it) but is driven by an internal timer
Jest cannot control.

Choose `timeoutMs` per client, not per request: 15 s suits list and detail reads on mobile networks;
an upload client gets its own instance with a longer deadline. TanStack's retry (section 4 of
queries-and-cache.md) retries a `timed-out` failure, so the deadline bounds each attempt and the retry
policy bounds the whole operation.

## 4. Cancellation: one AbortController per attempt

```ts
const controller = new AbortController();
const timer = setTimeout(() => { isTimedOut = true; controller.abort(); }, timeoutMs);
caller?.addEventListener('abort', abort);          // TanStack's signal, linked in
try { ...fetch(url, { ...init, signal: controller.signal })...; await response.text(); }
catch { return err(failureFromThrown({ isCancelled: isAborted(caller), isTimedOut, timeoutMs })); }
finally { clearTimeout(timer); caller?.removeEventListener('abort', abort); }
```

- The caller's signal (TanStack's `queryFn` context) is linked to the attempt's controller, never
  passed straight to `fetch`: the attempt needs its own controller for the deadline anyway, and one
  `finally` removes the listener, so a long-lived signal does not collect listeners.
- A signal that is already aborted returns `cancelled` without calling `fetch`.
- TanStack aborts the signal when the query is cancelled (`cancelQueries`, a newer fetch with
  `cancelRefetch`) and when the last observer unsubscribes **only if the queryFn read `signal`**
  (query-core 5.104 `removeObserver`: `#abortSignalConsumed`). A queryFn that never touches the signal
  lets every abandoned request run to the end and fill the cache for a screen that is gone.

## 5. Classifying a failure without reading error text

| What happened | How the client knows | Failure |
|---|---|---|
| The caller aborted | `caller.aborted` after the rejection | `cancelled` (never shown, never recorded) |
| The client's deadline fired | its own `isTimedOut` flag | `timed-out` (`afterMs`) |
| Any other rejection of `fetch` or of the body read | neither flag | `network-unavailable` |
| 401 / 403 / 404 or 410 | status | `unauthorized` / `forbidden` / `not-found` |
| 409, 412 | status, JSON `{ "code" }` body | `conflict` (`code`) |
| 429 | status, `Retry-After` in delta-seconds (capped at an hour; an HTTP date needs a clock and reads as null) | `rate-limited` (`retryAfterMs`) |
| 408, 5xx | status | `server-unavailable` (`status`) |
| other 4xx | status, JSON `{ "code" }` body | `rejected` (`status`, `code`) |
| 2xx whose body is not JSON or fails the schema | `parseJson`, `v.safeParse` | `invalid-response` (`path`), recorded once |

`network-unavailable` covers offline, DNS, TLS and refused connections alike: the UI tells offline
apart by asking the ConnectivityPort, not by parsing an error. A `rejected` 4xx with a code lets the
UI map server validation codes (`title-too-long`) to message keys.

## 6. URLs, headers, bodies, idempotency

- **Join by string, never `new URL(path, base)`.** URL resolution drops the base's own path:
  `new URL('/tasks', 'https://api.example.com/v1/')` is `https://api.example.com/tasks` (WHATWG URL
  spec; Node and Expo's whatwg-url-minimum agree). `buildUrl` trims trailing slashes from the base and
  requires paths to start with `/`.
- **Encode every path segment** (`'/tasks/' + encodeURIComponent(id)`) and let `buildUrl` encode the
  query; `undefined` parameters are left out, so `{ filter: filter === 'all' ? undefined : filter }`
  reads well.
- **Headers:** `Accept: application/json` always, `Content-Type: application/json` with a body,
  `Idempotency-Key` when the request carries one, plus whatever `options.headers()` returns for this
  request (the auth layer's `Authorization`; auth-and-secure-storage owns tokens and the single-flight
  refresh). A `headers()` that rejects (a locked keychain) is recorded and becomes `unauthorized`.
  auth-and-secure-storage provides both halves: `sessionHeaders(session)` for this option, and
  `sendWithSession(session, send)`, which renews once after `unauthorized` and signs out after a
  second one (its `examples/authorized-api-client.ts` wraps this client and maps the session's own
  failures into `ApiFailure`). Sign-in and token refresh use the plain client: nobody is signed in
  yet, or the session is the one refreshing.
- **Bodies:** JSON only in this client. An empty 2xx body is checked as `null`, so a 204 uses
  `NO_CONTENT` (`v.null()`). Uploads and downloads of files belong to media-images-and-files: its
  `FileTransferPort` (adapter `src/services/file-transfer/*-adapter.ts` over expo-file-system's
  `File.upload` and download) is the app's one second transport, for file bodies only. Its URL comes
  from `buildUrl` in `src/api`, its headers from `sessionHeaders`, its `Idempotency-Key` from the
  action, and the JSON it gets back goes through a schema in `src/api`. media-images-and-files'
  `transfer-outside-port` keeps those calls in that adapter; this skill's `network-call` does not see
  expo-file-system calls, and any other transport is still a finding.
- **Idempotency:** a create that may be retried (by TanStack, by the user tapping again after a
  timeout, after an offline pause) sends a client-made request id as `Idempotency-Key`; the server
  applies a repeated key once. The id is made when the user starts the action (the draft's id), not
  per attempt.

## 7. Base URL per variant, HTTPS, cleartext on iOS and Android

- The base URL is `EXPO_PUBLIC_API_URL`, set per EAS environment (so development, preview and
  production talk to their own servers), declared in `src/env.d.ts`, read with dot access in
  `src/config/environment.ts` (app-variants-and-environment owns the reader pattern) and checked once
  by `parseApiBaseUrl`: missing, relative, with a query or fragment, or `http://` outside development
  throws at startup with the variable's name. The composition root receives the checked value.
  Requests name paths only; a URL literal in `src/api/` is a finding (`base-url`).
- `EXPO_PUBLIC_*` values are public: an API key in one is readable by anyone with the app. A key the
  server must keep secret stays on a server (an Expo Router API route), never in the bundle.

| | iOS | Android |
|---|---|---|
| Default for release builds | App Transport Security: `NSAllowsArbitraryLoads` is false in Expo's SDK 57 template; `http://` to the internet fails | `usesCleartextTraffic` unset in release, which is false from Android 9 (API 28) |
| Debug builds | `NSAllowsLocalNetworking` true in the template, so local dev servers work | `src/debug` and `src/debugOptimized` manifests set `usesCleartextTraffic="true"` |
| The switch to avoid | `ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads: true` | `expo-build-properties` `android.usesCleartextTraffic: true` |

The trap this explains: a preview (release) build pointed at `http://10.0.2.2:3000` fails on Android
with a cleartext error while the development build worked, and the fix people reach for, switching
cleartext on globally, ships to the store. Give the API an HTTPS endpoint per environment instead;
`parseApiBaseUrl` refuses `http://` outside development so the mistake fails at launch.

## 8. HTTP caching and cookies underneath the client

- **Android:** React Native's OkHttp client has a 10 MB disk cache (`http-cache` in the app's cache
  folder), so `Cache-Control` headers from the server apply to expo/fetch GETs.
- **iOS:** `URLSessionConfiguration.default` uses the shared `URLCache` and `HTTPCookieStorage`.
- expo/fetch sends `credentials: 'include'` by default (cookies are stored and sent on both platforms).

TanStack Query is the app's cache; a stale HTTP cache underneath it makes a refetch return old data.
Let the API send `Cache-Control: no-store` (or `private, no-cache`) on authenticated JSON. A bearer
token in a header (auth-and-secure-storage) does not depend on the cookie jar.

## 9. Verified facts and how to re-verify them

| Fact | Verified | Re-verify (in an installed Expo SDK 57 app) |
|---|---|---|
| expo/fetch is the global fetch on iOS and Android unless `EXPO_PUBLIC_USE_RN_FETCH` | 2026-10-04, expo 57.0.26 source and docs.expo.dev v57 | `grep -n "useRnFetch\|install('fetch'" node_modules/expo/src/winter/runtime.native.ts` |
| expo/fetch error shapes | 2026-10-04, source | `cat node_modules/expo/src/winter/fetch/FetchErrors.ts node_modules/expo/ios/Fetch/FetchExceptions.swift` |
| Android OkHttp timeouts 0, 10 MB cache | 2026-10-04, react-native 0.86.3 source | `grep -n "Timeout\|cacheSize" node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/OkHttpClientProvider.kt` |
| iOS `timeoutInterval = 0`, default session configuration | 2026-10-04, source | `grep -n "timeoutInterval\|URLSessionConfiguration" node_modules/expo/ios/Fetch/*.swift` |
| `new URL` drops the base path | 2026-10-04, Node 26.4 | `node -p "new URL('/tasks','https://a.test/v1/').href"` |
| ATS and cleartext defaults of the template | 2026-10-04, expo-template-bare-minimum 57.0.28 | `npm pack expo-template-bare-minimum@sdk-57` and read `ios/HelloWorld/Info.plist`, `android/app/src/*/AndroidManifest.xml` |
| `usesCleartextTraffic` option | 2026-10-04, expo-build-properties 57.0.22 | `grep -n usesCleartextTraffic node_modules/expo-build-properties/build/pluginConfig.d.ts` |

None of these were measured on a device in this session; they are read from the shipped sources.
