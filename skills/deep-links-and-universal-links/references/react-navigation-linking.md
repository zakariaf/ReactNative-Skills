# Appendix: links in a React Navigation 7 app

The house router is Expo Router; React Navigation 7's static API is the fenced alternative
(navigation-and-routing). The rules stay the same: one gate, an allow-list, cold and warm through the same
decision, verified hosts from one contract. Only the wiring differs, and check-deep-links prints NOT
APPLICABLE for such an app, so the review is by hand. The option names below are React Navigation 7's
`LinkingOptions` (as forked in expo-router 57.0.24, `build/react-navigation/native/types.d.ts`); not verified
in a React Navigation app by this library.

## Wiring the same gate

React Navigation has no `+native-intent`: the `linking` prop's `getInitialURL` and `subscribe` are the two
places every link passes, so both call the same decision.

```ts
// src/features/root-navigator/linking.ts
import * as Linking from 'expo-linking';

import { redirectSystemPath } from '@/features/deep-links/redirect-system-path';

import type { LinkingOptions } from '@react-navigation/native';

const ROOT_URL = Linking.createURL('/');

/**
 * The template gate, unchanged: redirectSystemPath decides through routeIncomingLink with the live
 * gate registry, offers a 'deferred' link to the pending-link inbox, converts a throw and reports it.
 * Its href becomes a URL React Navigation parses with its prefixes; null stays put.
 */
function decide(url: string | null, isInitial: boolean): string | null {
  if (url === null) return null;
  const href = redirectSystemPath({ path: url, initial: isInitial });
  return href === null ? null : Linking.createURL(href);
}

export const linking: LinkingOptions<RootParamList> = {
  prefixes: [ROOT_URL],
  async getInitialURL() {
    return decide(await Linking.getInitialURL(), true);
  },
  subscribe(listener) {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const next = decide(url, false);
      if (next !== null) listener(next);
    });
    return () => subscription.remove();
  },
};
```

- `decide` reuses `createRedirectSystemPath`'s deps (`isGateOpen: (gate) => linkGates.isOpen(gate)`,
  `defer: pendingLinks.offer`, the error-net report), so a gated link is kept, not dropped: a cold start
  lands on the first screen (`LINK_FALLBACK`), a warm one stays put, and the first screen behind the guard
  takes it with `useOpenPendingLink`. Calling `routeIncomingLink` directly with `() => false` and ignoring
  `'deferred'` would silently drop every gated link.
- With the static API, `<Navigation linking={{ ...linking, enabled: 'auto' }} />` generates the path config
  from the screen names; otherwise give `config.screens` (`TaskDetail: 'tasks/:taskId'`). The allow-list
  paths use the same `[param]` form as Expo Router's files in `LINK_ROUTES`; translate `:taskId` when
  writing the config.
- Types: the templates type an `open()` target and a `PendingLink` as expo-router's `Href`. In a React
  Navigation app, replace it with the app's own target (`{ screen, params }` typed by `RootParamList`) and
  have `useOpenPendingLink` call `navigation.navigate(target.screen, target.params)`.
- Gates: React Navigation's static `if` hooks are the guards; report them with `useLinkGate` from the
  component that owns the guard, exactly as in an Expo Router app.
- These two functions are the only `Linking` listeners in the app; one-listener's reason applies unchanged.

## Verified links

Nothing changes: the contract, `linkNativeConfig` in app.config.ts, `write-well-known.mjs` (it needs only
the app config and the contract) and the device checks in universal-and-app-links.md apply as they are.
