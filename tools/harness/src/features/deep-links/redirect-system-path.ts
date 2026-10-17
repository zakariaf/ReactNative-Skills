// src/features/deep-links/redirect-system-path.ts
// The body of src/app/+native-intent.tsx. Expo Router calls redirectSystemPath for the launch URL of
// a cold start ({ initial: true }) and for every URL that arrives while the app runs
// ({ initial: false }), before it routes (expo-router 57.0.24, getLinkingConfig.js and
// link/linking.js). A throw there crashes the launch, and it runs outside React, so it must be
// synchronous, total and free of app state: it returns the allow-listed href, the first screen for a
// cold link that opens nothing, or null (stay where you are) for a warm one.
import { routeIncomingLink } from '@/core/links/route-incoming-link';
import { attempt } from '@/core/result';
import { linkGates } from '@/services/deep-links/link-gates';
import { pendingLinks } from '@/services/deep-links/pending-link-inbox';
import { appErrorNet } from '@/services/error-net/app-error-net';

import { appLinkPolicy } from './app-link-policy';

import type { GateCheck, LinkDecision, LinkPolicy } from '@/core/links/route-incoming-link';
import type { PendingLink } from '@/services/deep-links/pending-link-inbox';
import type { Href } from 'expo-router';

/** What Expo Router passes: `path` is whatever the OS handed over (a URL, or any string). */
export type SystemPathEvent = { readonly path: string; readonly initial: boolean };

export type RedirectDeps = {
  readonly policy: () => LinkPolicy<Href>;
  readonly isGateOpen: GateCheck;
  /** Keeps a gated link for the first screen behind its gate. */
  readonly defer: (link: PendingLink) => void;
  /** Receives a crash of the decision (a bug): the link is then dropped, never the app. */
  readonly report: (error: unknown) => void;
};

/** Where a cold start lands when its link opens nothing: the first screen. */
export const LINK_FALLBACK = '/';

function hrefFor(
  decision: LinkDecision<Href>,
  isInitial: boolean,
  deps: RedirectDeps,
): string | null {
  if (decision.kind === 'open') return decision.href;
  if (decision.kind === 'deferred') deps.defer({ gate: decision.gate, target: decision.target });
  return isInitial ? LINK_FALLBACK : null;
}

/** Builds redirectSystemPath over `deps` (tests pass their own policy, gates and inbox). */
export function createRedirectSystemPath(
  deps: RedirectDeps,
): (event: SystemPathEvent) => string | null {
  return (event) => {
    const decided = attempt(
      () => routeIncomingLink(event.path, deps.policy(), deps.isGateOpen),
      (thrown) => thrown,
    );
    if (decided.ok) return hrefFor(decided.value, event.initial, deps);
    deps.report(decided.error);
    return event.initial ? LINK_FALLBACK : null;
  };
}

/** The app's gate: the policy of this build, the gate registry and the pending-link inbox. */
export const redirectSystemPath = createRedirectSystemPath({
  policy: appLinkPolicy,
  isGateOpen: (gate) => linkGates.isOpen(gate),
  defer: (link) => {
    pendingLinks.offer(link);
  },
  // The error net keeps it until the error log connects; 'global-handler' is the net's catch-all.
  report: (error) => {
    appErrorNet.report({ source: 'global-handler', error, isFatal: false });
  },
});
