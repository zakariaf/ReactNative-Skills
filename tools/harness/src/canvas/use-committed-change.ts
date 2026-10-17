// src/canvas/use-committed-change.ts
// Server data (a TanStack Query result) has no reducer that returns events. This hook turns each new
// data identity into one CommittedChange: the first data is a change without events (it is shown,
// never animated), and every later identity gets the next seq and the events the surface's pure
// diffEvents(previous, next) derives. Identical refetches keep their identity (TanStack Query's
// structural sharing), so they commit nothing and replay nothing.
import { useState } from 'react';

import type { CommittedChange } from './present-change';

/** Past-tense events that turn `previous` into `next` (pure; tested beside the surface). */
export type DiffEvents<TState, TEvent> = (previous: TState, next: TState) => readonly TEvent[];

/**
 * The change that follows `previous` when the data becomes `data`. No data (still loading, or the
 * query was reset) keeps the last change; the first data has no events.
 */
export function nextChange<TState, TEvent>(
  previous: CommittedChange<TState, TEvent> | null,
  data: TState | undefined,
  diffEvents: DiffEvents<TState, TEvent>,
): CommittedChange<TState, TEvent> | null {
  if (data === undefined) return previous;
  if (previous === null) return { seq: 1, state: data, events: [] };
  return { seq: previous.seq + 1, state: data, events: diffEvents(previous.state, data) };
}

type Seen<TState, TEvent> = {
  readonly data: TState | undefined;
  readonly change: CommittedChange<TState, TEvent> | null;
};

/**
 * The committed change to hand to SurfaceHost or useSurfacePlayer, or null until the first data.
 * "Persist first" holds by construction: the change exists only once the query cache holds the data.
 * An optimistic update (setQueryData in onMutate) and its rollback are two changes, so the surface
 * animates forward and then back.
 */
export function useCommittedChange<TState, TEvent>(
  data: TState | undefined,
  diffEvents: DiffEvents<TState, TEvent>,
): CommittedChange<TState, TEvent> | null {
  const [seen, setSeen] = useState<Seen<TState, TEvent>>({ data: undefined, change: null });
  if (data === seen.data) return seen.change;
  // React's "adjust state while rendering" pattern: it re-renders at once, before any child sees it.
  const change = nextChange(seen.change, data, diffEvents);
  setSeen({ data, change });
  return change;
}
