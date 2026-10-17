# The consent gate: opt-in, lazy SDK, withdrawal and forget

How `createAnalytics` (templates/src/services/analytics/create-analytics.ts) decides whether an
event leaves the device, and why each rule is there.

## Contents

- Why opt-in is the default everywhere
- Ads consent is not analytics consent
- The consent record and its version
- The gate's life cycle
- Why the SDK is created lazily (opt-out flags are not enough)
- Saying no, and forget
- When and how to ask
- Modes: off, test, live
- Failure handling
- Tests

## Why opt-in is the default everywhere

One default, the strictest common one, so the app is right in every store and region without a
geography switch:

- **Apple, App Review Guideline 5.1.1(ii)** (read 2026-10-14): "Apps that collect user or usage data
  must secure user consent for the collection, even if such data is considered to be anonymous at the
  time of or immediately following collection. Paid functionality must not be dependent on or require
  a user to grant access to this data. Apps must also provide the customer with an easily accessible
  and understandable way to withdraw consent."
- **EU and UK (ePrivacy Article 5(3), GDPR):** reading or storing information on the device (an
  analytics install id is exactly that) needs consent unless strictly necessary for the service the
  user asked for; product analytics is not. Some regulators allow narrow consent-free audience
  measurement under strict conditions; that is a legal decision for the developer, not a code default.
- **Google Play** asks whether collection is optional, and may call it optional only if every user,
  in every region, can opt in or out.

So: until the user said yes to the current question, the consent state is `'unknown'`, the gate
drops every event, and no vendor SDK exists in the process. This is not legal advice; when the
developer's legal review chooses another model (for example a US-only app with an opt-out), record
that decision before changing the gate, and stop and ask first.

## Ads consent is not analytics consent

Google's UMP form (`ConsentPort`, owned by admob-ads-and-consent) asks for consent on behalf of
Google and the ad vendors of the IAB TCF list. Its `canRequestAds` says nothing about the app's own
product analytics vendor, which is not a TCF vendor the user saw. Never derive analytics consent
from `canRequestAds`, and never show the analytics question inside Google's form
(check-analytics `consent-source` fails a `setConsent()` call whose argument reads `canRequestAds`,
the `ConsentPort` calls or the ATT answer; a value copied into another variable first is not
followed, so the review holds that line too).

An answer the app makes up is no answer either. `consent-source` also fails `setConsent('granted')`
written as a literal where no user acted: anywhere in `src/services/` (the composition root
included), at module scope, directly in a component's or hook's body (a render), or as the callback
of `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useFocusEffect` (Expo Router and React
Navigation), `useMemo`, `useState` or `useReducer`. The
literal is fine inside a handler the view calls on a tap: an inline arrow (`onShare: () => ...`,
`onPress={() => ...}`) or a named lower-case helper in the model (`const answer = (choice) => ...`).
The check is textual and judges the innermost function around the call, so it does not see a
literal routed through a helper (`grantAll()` called from an effect), a variable holding
`'granted'`, or a lower-case function that runs at startup; the review holds those lines. The two answers live side by side:

| Question | Who asks | Where the answer lives |
|---|---|---|
| Ads (personalised ads, ad measurement) | Google UMP through `ConsentPort` | UMP's own storage (TCF string) |
| Apple tracking (IDFA) | Apple's ATT prompt through `ConsentPort.requestTracking()` | iOS Settings |
| Product analytics | the app's own prompt through `AnalyticsPort.setConsent()` | the consent record (kv-store) |

The ATT half is shared: analytics never imports `expo-tracking-transparency`; the tracking profile
passes the canonical `createExpoTrackingConsentAdapter({ onError })` as `tracking`
(att-and-tracking.md).

## The consent record and its version

`analytics-consent.ts` saves `{ choice, version, decidedAtMs }` through `AnalyticsConsentStorePort`
(`kv-analytics-consent-adapter.ts`, key `analytics.consent` in `expo-sqlite/kv-store`). The record
never leaves the device.

- `ANALYTICS_CONSENT_VERSION` is the version of the question. Raise it whenever
  `contracts/analytics.json` `collects`, `sdk` or `endpoints` change: every earlier answer then reads
  as `'unknown'` and the user is asked again before the new collection starts (consent is given for
  specific purposes; a new purpose needs a new answer). Never lower it. `contracts/analytics.json`
  `"consent": { "version", "covers" }` ties the two together: `version` equals
  `ANALYTICS_CONSENT_VERSION`, and `covers` is a fingerprint of `sdk`, `endpoints` and `collects` taken
  when that version was set. check-analytics `consent-covers` fails a fingerprint that no longer
  matches (the collection changed without a new question; its fix prints the new value) and a version
  that differs from the codec's. It has no history, so the reviewer still checks the version went up.
- Anything malformed reads as no record (asked again), never as a yes.
- `decidedAtMs` comes from the ClockPort (`nowMs`), so a support export can show when the answer was
  given.
- The read is synchronous, once, on first use, never in the composition root (creating the
  services does no storage I/O: app-startup-and-bootstrap's startup order). First use may be a
  render: `useUsageDataModel` reads `analytics.consent` as its `useState` initializer, so when the
  prompt is on the first screen after onboarding, that render does one kv-store `getItemSync` (a
  small synchronous SQLite read, cheap). The first event of a launch already knows the answer.

## The gate's life cycle

```
unknown --setConsent('granted')--> granted --first event or the yes itself--> SDK created, optIn()
granted --setConsent('denied')--> denied, then the stop below                (no new events)
any     --forget()--> unknown: record cleared, then the stop below
stop:   SDK created in this session -> reset(), then optOut()
        no SDK in this session      -> clearSdkStorage() (the client is never constructed)
mode 'off': nothing is ever created, whatever the answer
```

`track(event)` runs `sanitizeEvent` (event-catalog.md) and then either captures (SDK running),
or holds the event while the SDK starts (at most `MAX_PENDING_EVENTS`, 100; more are dropped, and
nothing is ever written to disk for later). A failed start ends analytics for the session
silently: the next launch tries again.

## Why the SDK is created lazily (opt-out flags are not enough)

Verified in source, posthog-react-native 4.79.1 with @posthog/core 1.59.0 (2026-10-14): the
`PostHog` constructor calls `reloadRemoteConfigAsync()` unconditionally; that request is guarded
only by the `disabled` option, not by the opt-out state, and `preloadFeatureFlags` (default true)
follows it. A client constructed with `defaultOptIn: false` therefore still contacts PostHog at
launch, with its anonymous id. Other SDKs initialise natively at app start (React Native Firebase
collects from launch unless `firebase.json` switches it off). The only reliable rule is the
structural one: the vendor adapter is created inside `createSdk`, which the gate calls only after
consent, in a build whose mode is not `off`. check-analytics `sdk-lazy` enforces it.

## Saying no, and forget

A "no" must stop collection at once and must not leave a pseudonymous identity behind:

1. `reset()` first: the anonymous id, the device id and the unsent event queue are dropped, so the
   next yes starts under new ids and nothing captured before the no is sent.
2. `optOut()` second: stop capturing, persisted in the SDK's storage.

The order matters for PostHog-style SDKs (verified in @posthog/core 1.59.0): `reset()` clears every
persisted property except the event queues, the saved opt-out included, so `optOut()` then `reset()`
would leave the client opted in again (with `defaultOptIn` true, the default). The adapter creates
the client with `defaultOptIn: false` as a second guard, and the gate calls `optIn()` again on a
later yes in the same session (`resume`).

A vendor's reset rarely does all of step 1 by itself, so the adapter finishes it (verified in
posthog-react-native 4.79.1, vendors-and-sdk-facts.md pitfalls 3, 4 and 8): the React Native
`reset()` keeps the device id unless called as `reset([])`; it keeps the queue, and a flush ignores
the opt-out, so the adapter clears the queue; and it reloads feature flags over the network unless
`disableRemoteFeatureFlags: true`. One batch already on the wire when the user says no cannot be
recalled; it was captured under the earlier yes.

**No SDK in this session.** The SDK's state outlives the process: PostHog 4.79.1 keeps its
anonymous id, device id and unsent queue in one storage key, `.posthog-rn.json` (its logs in
`.posthog-rn-logs.json`; `EVENTS_STORAGE_FILE` and `LOGS_STORAGE_FILE` in `dist/storage.js`), which
the adapter's `customStorage` puts in kv-store. When the answer turns to no in a session where the
SDK never started (`ANALYTICS_CONSENT_VERSION` was raised, so the old yes reads as `'unknown'` and
nothing started; or `forget()` from account deletion while analytics was off, unknown or denied),
there is no client to `reset()`, and constructing one just to reset it would contact the vendor
(pitfall 1). So the gate calls `clearSdkStorage` instead: the PostHog adapter exports
`clearPosthogStorage()`, which deletes both keys with `Storage.removeItemSync`, and the composition
root passes it. Without it, the next yes would send under the old ids, plus the old queue.
check-analytics-behaviour `clear-without-sdk` runs both paths. Re-verify the key on an SDK upgrade:

```sh
grep -o "EVENTS_STORAGE_FILE='[^']*'\|LOGS_STORAGE_FILE='[^']*'" package/dist/storage.js
```

`forget()` is the same plus clearing the saved answer: call it from account deletion
(auth-and-secure-storage) and from a "reset analytics" support action. Deleting data already on the
vendor's servers is a vendor request (PostHog: delete the person or the events by distinct id in the
project; most vendors offer a deletion API): tell the developer it exists and that Google Play's Data
safety form asks whether users can request deletion.

## When and how to ask

- After onboarding, while the state is `'unknown'`, on a calm screen; never at first launch over the
  app's first minute, never over a focused task, never during a purchase.
- One question, two equal answers (same size, same weight, neither pre-selected), plain words about
  what is sent ("which screens and features you use, never what you type") and where to change it.
- Nothing depends on the answer: no feature, reward or Premium behind "Share" (5.1.1(ii); 5.1.2(i)
  says the same for tracking).
- A settings row changes the answer at any time with the same two calls (`examples/use-usage-data-model.ts`).
  check-analytics `consent-ui` fails while no app code calls `setConsent` on the AnalyticsPort. Both
  consent rules count only calls whose receiver is the analytics port (`analytics.setConsent(`,
  `useAnalytics().setConsent(`, `createAppAnalytics(...).setConsent(`):
  crash-reporting-and-observability's `crashReporter.setConsent(isGranted)` answers another question.
- On iOS, a tracking-profile app shows its own prompt first and Apple's ATT prompt only after a yes
  (the gate asks inside `createSdk`'s start); a no never triggers Apple's prompt.

## Modes: off, test, live

`src/config/analytics-config.ts` resolves the mode from the variant and `ANALYTICS_MODE`:

| Variant | Allowed (default first) |
|---|---|
| development | off, test |
| preview | off, test |
| production | live, off |

`off` is what E2E runs, screenshots and the runtime network audit build: the gate never creates the
SDK, so those builds make no analytics request. Testing variants never reach the live project, and
production never reaches the test project (check-analytics-behaviour `mode-matrix`). Details of the
key, the host and EAS environments: modes-keys-and-testing.md.

## Failure handling

The port never throws and never rejects (error-handling-typed-results: an adapter converts at the
boundary). Store failures become values and go to `onError`; SDK throws and rejections are caught
and recorded; `setConsent` runs its asynchronous work through `quietly(...)`, so a failing `optOut`
can never become an unhandled rejection (check-analytics-behaviour `never-throws`). Analytics shows
no error, spinner or retry to the user.

## Tests

`create-analytics.test.ts` covers each row above with `createFakeAnalyticsSdk()` and
`createMemoryAnalyticsConsentStore()`: nothing before an answer; one creation and `optIn` after a yes;
`reset` then `optOut` after a no, and nothing sent after it; a yes again opts the same client back in;
a no or `forget()` with no SDK in the session clears the stored SDK state without creating the SDK;
an older version reads as unknown; off builds create nothing; ATT reaches the adapter only in the
tracking profile; at most 100 pending events; failures recorded, never thrown. Feature tests give
`createFakeAnalytics()` through `<AnalyticsProvider analytics={fake}>` and assert `events()`.
check-analytics-behaviour runs the same scenarios against the app's real modules.
