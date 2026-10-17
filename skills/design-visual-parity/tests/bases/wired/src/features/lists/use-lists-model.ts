// src/features/lists/use-lists-model.ts
import { useState } from 'react';

import { useFrameStateOpener } from '@/hooks/use-frame-state-opener';

export function useListsModel(): { readonly pendingDelete: string | null; readonly onAskDelete: (id: string) => void } {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const onAskDelete = (id: string): void => {
    setPendingDelete(id);
  };
  // A parity launch of delete-list-dialog-default opens the dialog through the handler a press uses.
  useFrameStateOpener('delete-list-dialog-open', () => {
    onAskDelete('home');
  });
  return { pendingDelete, onAskDelete };
}
