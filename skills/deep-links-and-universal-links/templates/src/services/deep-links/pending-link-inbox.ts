// src/services/deep-links/pending-link-inbox.ts
// One slot for a link that arrived while its gate was closed: a task link tapped while signed out, or
// any gated link at a cold start (the gates register after the first render). +native-intent offers
// it and sends the person to the first screen; the first screen behind the gate takes it once
// (useOpenPendingLink) and opens it. Memory only: a kill drops it, which is the expiry. Newest wins.
import type { Href } from 'expo-router';

/** A link waiting for `gate` to open, with the typed href its route's open() built. */
export type PendingLink = { readonly gate: string; readonly target: Href };

export type PendingLinkInbox = {
  /** Keeps `link`, replacing any older one. */
  readonly offer: (link: PendingLink) => void;
  /** The waiting href when it waits for `gate`, removed so it opens once; otherwise null. */
  readonly take: (gate: string) => Href | null;
  /** Drops the waiting link (sign-out, tests). */
  readonly clear: () => void;
};

let waiting: PendingLink | null = null;

/** The app's one inbox. */
export const pendingLinks: PendingLinkInbox = {
  offer: (link) => {
    waiting = link;
  },
  take: (gate) => {
    if (waiting?.gate !== gate) return null;
    const { target } = waiting;
    waiting = null;
    return target;
  },
  clear: () => {
    waiting = null;
  },
};
