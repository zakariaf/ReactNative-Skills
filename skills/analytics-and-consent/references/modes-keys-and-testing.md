# Modes, keys, builds and testing

## Contents

- The project key and host
- Per-variant modes and EAS environments
- Reading the values at run time (and EAS Update)
- Off builds: E2E, screenshots, the network audit
- Verifying on a device (iOS and Android)
- Test recipes
- Troubleshooting

## The project key and host

A product analytics project key (PostHog's `phc_...`, Amplitude's API key, a Segment write key) is a
**publishable, write-only client key**: it can only send events into the project, and anyone with the
app can read it. It still never sits in source:

- the key and the host belong to the build's environment, not to git (one project per environment);
- a personal or secret API key (PostHog `phx_...`, an export or admin token) never reaches the app at
  all: it is a CI or EAS secret used by tooling only;
- the app never reads `EXPO_PUBLIC_ANALYTICS_*`: those are inlined into the bundle by Metro and
  survive in every OTA update; the values travel through `expo.extra` instead.

check-analytics `key-literal` fails a PostHog project key typed in code, any `EXPO_PUBLIC_ANALYTICS_*`
and any `process.env.ANALYTICS_*` read outside `app.config.ts` and `src/config/`.

## Per-variant modes and EAS environments

`app.config.ts` runs `analyticsExtra(variant, process.env, appId)`:

| Variable | development | preview | production |
|---|---|---|---|
| `ANALYTICS_MODE` | unset (off) or `test` | unset (off) or `test` | unset (live) or `off` |
| `ANALYTICS_KEY` | the test project's key (only with `test`) | the test project's key (only with `test`) | the live project's key |
| `ANALYTICS_HOST` | `https://eu.i.posthog.com` (or the region chosen) | same | same, one of `endpoints` |

Set them as EAS environment variables of each environment (`eas env:create --environment production
--name ANALYTICS_KEY --value <key> --visibility plaintext`; the key ends up inside the app anyway, so
a stricter visibility protects nothing).
Locally, a `.env.local` that git ignores (app-variants-and-environment owns `.env` rules). A mode
that sends without a key or with a non-https host throws at config time, so a production build never
ships analytics that silently goes nowhere; `ANALYTICS_MODE=live` in a testing variant and `test` in
production throw too.

## Reading the values at run time (and EAS Update)

The root-kit registry (`src/services/create-root-kits.ts`) reads `readAnalyticsExtra(Constants.expoConfig?.extra, Application.applicationId)`.
`expo.extra` is embedded in the binary at build time, and replaced by the manifest of a running EAS
Update. An update published with another variant's environment would point production users at the
test project, or the reverse; the reader compares the extra's `appId` with the binary's own
application id and turns analytics off on a mismatch (check-analytics-behaviour `extra-reader`).
Publish updates with the channel's environment (`eas update --environment production`; ota-updates
owns that rule).

## Off builds: E2E, screenshots, the network audit

Build E2E (e2e-maestro), store screenshots and the runtime network audit (privacy-and-store-declarations)
with `ANALYTICS_MODE=off` (the default of development and preview): the gate never constructs the SDK,
so these builds make no analytics request whatever the consent state. A Maestro flow can still drive
the consent prompt and the settings row: they work in every mode, only sending is off.

## Verifying on a device (iOS and Android)

On a `preview` build with `ANALYTICS_MODE=test`, on a named simulator and a named emulator (never the
booted one; ios-simulator-build, android-emulator-build):

1. Fresh install: no request to the analytics host before the prompt is answered. Check with the
   vendor's live events view staying empty, or with a proxy (Proxyman, Charles, mitmproxy) on the
   simulator's or emulator's traffic.
2. Answer "Share": the first catalog event appears in the test project within the flush interval
   (PostHog: 20 events or 10 s, `flushAt` / `flushInterval`), with the anonymous id, no person, and
   no `$ip` (the project's "Discard client IP data" setting, vendors-and-sdk-facts.md).
3. Turn the settings row off: no further events; the next yes starts under new anonymous and device ids (compare `$device_id` in the vendor's event view).
4. Background the app after a few events: they are flushed (`analytics.flush()` in the background
   flush: the analytics root kit's `analyticsFlusher`, which the root skeleton's flushers slot runs).
5. Tracking profile only, iOS: Apple's prompt appears right after "Share", never after "Don't share".
   Maestro's `launchApp` grants every permission, the ATT answer included: launch with
   `xcrun simctl launch <udid> <bundle id>` or `launchApp: { permissions: { all: unset } }` to see it.

Facts verified for this skill: the gate, sanitizer, config and mapping by Jest and
check-analytics-behaviour on Node, and PostHog's behaviour by reading its source (2026-10-14). The
device walkthrough above was not run for this skill (no native build): mark a report "device check
owed" until the developer runs it.

## Test recipes

- **Feature tests:** wrap the code in `<AnalyticsProvider analytics={createFakeAnalytics()}>` (or
  pass that wrapper to the render helper), act, then
  `expect(analytics.events()).toStrictEqual([{ name: 'task_created', props: { ... } }])`. The fake
  records whatever the consent, so a feature test checks what the feature sends; the gate's own tests
  check what leaves.
- **The gate:** `createAnalytics({ mode, store: createMemoryAnalyticsConsentStore(saved), createSdk: () =>
  createFakeAnalyticsSdk(), nowMs, onError })`, as `create-analytics.test.ts` does. Settle pending
  promises before asserting (the SDK starts asynchronously).
- **The adapter:** its own test (`<vendor>-analytics-adapter.test.ts`) mocks the vendor package with
  `jest.mock` and asserts the options and the five calls; it is the only test that imports the
  vendor package (check-analytics `test-isolation`).
- **The consent store:** `kv-analytics-consent-adapter.test.ts` with an in-memory kv-store stand-in.
- **Never** let a unit test construct the real SDK: it would try the network.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No events after "Share" | mode `off` (development default), a foreign `appId` in the extra, a failed start (see the error log) | build with `ANALYTICS_MODE=test` and a key; check `readAnalyticsExtra`; read the error log |
| Events stop after a no and a later yes | the SDK's persisted opt-out | the gate calls `optIn()` on every yes; keep `resume` |
| Requests at launch before consent | the SDK constructed outside `createSdk`, `PostHogProvider`, or an auto-start SDK | check-analytics `sdk-lazy`, `sdk-options`, `sdk-inventory` |
| `ANALYTICS_MODE=test is not allowed for production` at `expo config` | the production environment carries a test setting | fix the EAS environment |
| An event never arrives, no error | dropped by the sanitizer (recorded in the error log with the reason) | match the catalog spec |
| Screen names with ids in the dashboard | `usePathname()` or params sent | `useScreenViews` (route patterns) |
