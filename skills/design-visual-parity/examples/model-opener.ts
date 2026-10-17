// Shape, not a template: a model hook that owns a frame state (src/features/lists/use-lists-model.ts).
// The parity launch only names the state; the model opens it through the handler a person's press
// uses, once, so the capture shows the real code path. A tall frame passes the scroll target to its
// ScreenBody (scrollToY). No other line of the model knows about parity.
import { useState } from 'react';

import { useFrameScrollTarget } from '@/hooks/use-frame-scroll-target';
import { useFrameStateOpener } from '@/hooks/use-frame-state-opener';

import type { List } from '@/data/lists';

export type ListsModel = {
  readonly lists: readonly List[];
  readonly pendingDelete: List | null;
  readonly scrollToY: number | undefined;
  readonly onAskDelete: (list: List) => void;
  readonly onCancelDelete: () => void;
};

export function useListsModel(lists: readonly List[]): ListsModel {
  const [pendingDelete, setPendingDelete] = useState<List | null>(null);
  const onAskDelete = (list: List): void => {
    setPendingDelete(list);
  };
  // delete-list-dialog-default: the dialog over the first list, as the design draws it.
  useFrameStateOpener('delete-list-dialog-open', () => {
    const first = lists[0];
    if (first !== undefined) onAskDelete(first);
  });
  return {
    lists,
    pendingDelete,
    scrollToY: useFrameScrollTarget(),
    onAskDelete,
    onCancelDelete: () => {
      setPendingDelete(null);
    },
  };
}
