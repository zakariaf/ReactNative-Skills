# Root mocks, adapter tests and fakes

How native SDKs stay out of tests, how an adapter is tested against its mock, and how everything
above the adapters is tested through fakes of the ports.

## Contents

- The rule in one paragraph
- Root manual mocks
- Which SDKs need one, and why
- Keeping a mock in sync
- Testing an adapter against the mock
- Fakes: real small implementations with a call log
- Testing services over fakes
- Testing policies (limits, quiet hours, pacing)
- Lint notes for mocks

## The rule in one paragraph

Only adapter files (`src/services/<port>/<library>-<port>-adapter.ts`, architecture-and-boundaries)
import a native SDK. The root `__mocks__/` files keep those adapters importable in Jest, and the
adapter's own test reads the mock through `jest.mock` plus a typed `jest.requireMock`. Everything else
is tested through the port with `fake-<port>.ts`. The SDKs below crash on import in Jest, and fakes
turn purchase, reminder and sync rules into millisecond tests.

## Root manual mocks

Jest applies a file in `<rootDir>/__mocks__/` automatically to the node module of the same name, in
every project, without `jest.mock` (scoped packages: `__mocks__/@scope/name.ts`). A mock anywhere else
(`src/services/purchase/__mocks__/expo-iap.ts`) is never applied to the node module
(`nested-sdk-mock`). `clearMocks` + `restoreMocks` in `jest.config.js` reset call counts before each
test while keeping the implementations given to `jest.fn(impl)` in these files (verified with Jest
29.7).

A mock mirrors only the public surface the adapters use, with safe defaults (an empty product list,
consent already obtained, nothing asked yet). Where the package ships its own Jest mock, the root file
re-exports it instead of writing one.

## Which SDKs need one, and why

`check-test-setup.mjs` knows these (verified 2026-10-03 on Expo SDK 57) and fails `root-mock-missing`
when the app depends on one without its root mock. Another native SDK that crashes on import joins
through the contract key `rootMocks` (`contracts/test-setup.json`).

| SDK | Why it needs a root mock | Template |
|---|---|---|
| `expo-iap` (5.8.0) | ships no Jest mock; `Cannot find native module 'ExpoIap'` | `templates/__mocks__/expo-iap.ts`: connection, products, purchase, finish, restore, listeners, and the real `ErrorCode` |
| `react-native-google-mobile-ads` (17.2.0) | `TurboModuleRegistry.getEnforcing(...): 'RNGoogleMobileAdsModule' could not be found` | `templates/__mocks__/react-native-google-mobile-ads.ts`: `mobileAds()`, `AdsConsent`, the enums, test ids, ad factories, a `BannerAd` that renders nothing |
| `expo-tracking-transparency` (57.0.2) | jest-expo mocks only its native module, whose functions answer `undefined`, so the package's own JS crashes on `response.status` | `templates/__mocks__/expo-tracking-transparency.ts`: nothing asked yet, the user declines when asked |
| `react-native-audio-api` (0.13.6) | installs its native module on import (`Failed to install react-native-audio-api`) | `templates/__mocks__/react-native-audio-api.ts` re-exports the package's own mock and completes its `AudioManager` with `setAudioSessionOptions` and `observeAudioInterruptions`, which the package's mock (0.13.6) lacks and the adapter calls before its first `AudioContext` |
| `react-native-keyboard-controller` (1.21.9) | no native module in Jest ("doesn't seem to be linked"), so every screen with its scroll view crashes | `templates/__mocks__/react-native-keyboard-controller.ts` hands the package's own mock to Jest |
| `@sentry/react-native` (7.11) | starts a `setInterval` at import, so any suite that reaches the adapter (even through `createDeviceServices`) ends with "A worker process has failed to exit gracefully" | crash-reporting-and-observability ships `__mocks__/@sentry/react-native.ts` (not in this skill's templates; list it in `rootMocks` until this skill knows it) |

Expo SDK modules (`expo-sqlite`, `expo-haptics`, `expo-notifications`, ...) need no root mock: jest-expo
mocks their native modules. Their adapters are still tested with `jest.mock` plus `jest.requireMock`
when the test asserts on calls.

## Keeping a mock in sync

The mock lives in `__mocks__/<sdk>.ts` and changes in the same commit as the adapter: an adapter that
starts calling a new SDK member adds it to the mock then, because a missing member is `undefined` in
Jest and fails as "is not a function". On every SDK upgrade, compare the mock's names with the
library's `index.d.ts`. When admob-ads-and-consent or in-app-purchases ships a newer version of its
mock, take that file whole rather than merging pieces by hand, then rerun the adapter tests. A member
the app must never call (a deprecated or banned API) stays out of the mock on purpose: calling it
throws.

## Testing an adapter against the mock

Lint bans importing the SDK in tests. The adapter's own test reads the mock with `jest.requireMock`,
typed locally with only what the assertions need, after an explicit `jest.mock('<sdk>')`. Without the
explicit `jest.mock`, `requireMock` returns a second instance, not the one the adapter imported, and
every assertion sees zero calls (verified).

```ts
import { createExpoIapPurchaseAdapter } from './expo-iap-purchase-adapter';

jest.mock('expo-iap');

type MockedIap = {
  readonly fetchProducts: jest.Mock<Promise<unknown[]>>;
  readonly finishTransaction: jest.Mock<Promise<void>>;
};

const iap = jest.requireMock<MockedIap>('expo-iap');
```

Typing the mock locally also avoids `@typescript-eslint/unbound-method` on `expect(sdk.method)`.
`examples/expo-iap-purchase-adapter.test.ts` is a complete adapter test: the mapping to the port type,
the failure fallback (an unreachable store answers "no product" and reports the error), and
connect-once behaviour. One test per mapping branch; the adapter is the only place SDK shapes appear.

## Fakes: real small implementations with a call log

A fake is `fake-<port>.ts` beside the port: a real, small implementation with test controls, not a bag
of `jest.fn()`. It records an ordered call log that other fakes and stubs share, so one
`toStrictEqual` on the log proves cross-service order ("save the entitlement, then finish the
transaction"). Its script object is mutable on purpose: the test changes `script.product` or
`script.restoreResult` between steps, and an event port exposes `emit(event)` to push what the native
side would send. Every failure the real dependency can produce is a script value too (a refused save,
a failed restore sync, an unreachable store), because the failure paths are where order matters: the
example finishes a transaction only after the save succeeded, and only a fake that can refuse the save
proves it. `examples/fake-purchase.ts` is the shape. The same fakes serve the test-only debug
menu (debug-menu-and-test-hooks) and the render helper's `services` option.

Fakes are code: each gets its own test (never the device-only marker), because every other test leans
on it.

## Testing services over fakes

- One test per state of the flow. For a purchase: owned, pending, cancelled, each error code, an empty
  product list, restore with nothing to restore, and "revoke only on an explicit revocation date".
- One test per failure path, each with its consequence: a save the app refuses leaves the
  transaction unfinished, so the store delivers it again at the next launch (a finished but unsaved
  purchase is lost for good); a failed restore sync reads "couldn't restore", never "nothing to
  restore"; a launch re-check that sees no transactions keeps the entitlement (an empty list is not a
  revocation); an unfinished purchase is finished only after the re-check or a restore has saved it,
  and stays unfinished while its save is refused. in-app-purchases owns the full purchase-state
  matrix; `examples/premium-service.test.ts` shows these cases over fakes.
- Let promise callbacks settle with `await flushMicrotasks()` (`setImmediate` under the hood), never
  fake timers.
- Assert order with the shared call log:

```ts
purchase.emit({ type: 'transaction', transaction: BOUGHT });
await flushMicrotasks();
const tail = script.calls.slice(script.calls.indexOf('requestPurchase'));
expect(tail).toStrictEqual(['requestPurchase', 'save:true', 'finish:t1']);
```

`examples/premium-service.test.ts` is the complete example.

## Testing policies (limits, quiet hours, pacing)

- A table of "blocks when …" cases with `it.each`.
- Every numeric limit as its own example at exactly the limit (the third reminder of the day, 22:00
  sharp for quiet hours, 180 000 ms since the last prompt), plus one in the same millisecond.
  Boundaries are where mutants survive (`coverage-and-mutation.md`).
- One property for the promise that must never break ("a Premium account never sees an upsell",
  "no reminder fires inside quiet hours").
- Run Stryker on the policy when it changes.

## Lint notes for mocks

- The lint config turns `@typescript-eslint/naming-convention` off for `__mocks__/**` (mocks mirror
  PascalCase library exports such as `AdsConsent`, `TestIds`) and exempts `__mocks__` and
  `jest.setup.ts` from `no-default-export` (a library may export its main object as default).
- Typing the `requireMock` result locally avoids `unbound-method` entirely.
