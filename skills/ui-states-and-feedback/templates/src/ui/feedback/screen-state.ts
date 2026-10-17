// src/ui/feedback/screen-state.ts
// What a list screen shows, as one value. A model hook turns its source (a TanStack query, a
// repository read) into a ListSnapshot and calls listScreenStateOf once; the view switches over the
// result. Every combination is a unit test here, and impossible states (loading and failed at once,
// empty before anything loaded) cannot be written down.
import type { MessageKey } from '@/i18n/messages';

/** Why a list that is on screen may be out of date. */
export type ListNotice =
  | { readonly kind: 'offline' }
  | { readonly kind: 'refresh-failed'; readonly messageKey: MessageKey };

export type ListScreenState<TItem> =
  /** Nothing loaded yet, a request is running: a delayed placeholder. */
  | { readonly kind: 'loading' }
  /** Nothing loaded yet and no network: it loads by itself when the device is back online. */
  | { readonly kind: 'offline' }
  /** Nothing loaded and the load failed: the failure's message and a retry. */
  | { readonly kind: 'failed'; readonly messageKey: MessageKey }
  /** Loaded, and there is nothing at all: the action that adds the first item. */
  | { readonly kind: 'empty' }
  /** Loaded, items exist, but none matches the filter: the action that clears it. */
  | { readonly kind: 'filtered-empty' }
  | {
      readonly kind: 'ready';
      readonly items: readonly TItem[];
      /** A refresh runs behind the content: a quiet indicator, never a placeholder. */
      readonly isRefreshing: boolean;
      readonly notice: ListNotice | null;
    };

export type ListScreenStateKind = ListScreenState<unknown>['kind'];

/** The facts a list screen's state is decided from. */
export type ListSnapshot<TItem> = {
  /** The items after the filter; undefined until the first load succeeded (never `?? []`). */
  readonly items: readonly TItem[] | undefined;
  /** A request runs right now (first load or refresh). */
  readonly isFetching: boolean;
  /** A request waits for the network (TanStack's fetchStatus 'paused'). */
  readonly isPaused: boolean;
  /** The last load failed: the message from the failure table, else null. */
  readonly failureKey: MessageKey | null;
  /**
   * A filter or search narrows the list and unfiltered items exist. With nothing at all, an empty
   * filtered list is `empty`: "Show all tasks" would only lead to another empty screen. When the
   * server filters, the model needs the unfiltered count (or the cached unfiltered list) for this.
   */
  readonly isFiltered: boolean;
};

function noticeOf(snapshot: ListSnapshot<unknown>): ListNotice | null {
  if (snapshot.isPaused) return { kind: 'offline' };
  if (snapshot.failureKey !== null)
    return { kind: 'refresh-failed', messageKey: snapshot.failureKey };
  return null;
}

/** The one state a list screen shows for these facts. */
export function listScreenStateOf<TItem>(snapshot: ListSnapshot<TItem>): ListScreenState<TItem> {
  const { items } = snapshot;
  if (items === undefined) {
    if (snapshot.failureKey !== null) return { kind: 'failed', messageKey: snapshot.failureKey };
    return snapshot.isPaused ? { kind: 'offline' } : { kind: 'loading' };
  }
  if (items.length === 0)
    return snapshot.isFiltered ? { kind: 'filtered-empty' } : { kind: 'empty' };
  return {
    kind: 'ready',
    items,
    isRefreshing: snapshot.isFetching,
    notice: noticeOf(snapshot),
  };
}
