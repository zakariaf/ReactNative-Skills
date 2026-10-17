// src/features/tasks/components/delete-task-dialog.tsx
import { DialogFrame } from '@/ui/dialog-frame';

import type { ReactNode } from 'react';

// Modal through DialogFrame (the checker follows the component, not only the literal prop).
export function DeleteTaskDialog(props: { readonly isOpen: boolean; readonly onClose: () => void; readonly children: ReactNode }): ReactNode {
  return (
    <DialogFrame isOpen={props.isOpen} onClose={props.onClose}>
      {props.children}
    </DialogFrame>
  );
}
