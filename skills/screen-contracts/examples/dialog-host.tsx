// src/features/root-navigator/dialog-host.tsx (shape: one dialog host for an app with dialogs on
// several screens; imitate it, do not copy it verbatim)
// At most one dialog at a time: a context holds the one current request (a union by kind), models
// open it with useOpenDialog(), and the host renders it once, after the navigator, so two Modals
// never stack (iOS will not present a second view controller over one that is still presenting).
// - An action runs, then the dialog closes; Cancel, Android back and the backdrop only close.
// - A newer request replaces the open one (its onCancel runs first), never queues behind it.
// - Plain yes/no confirmations go through ui-states-and-feedback's confirm(), which already keeps
//   one question at a time and answers 'confirmed' | 'cancelled' | 'dismissed'. This host is for
//   richer dialogs: pick one of several options, rename with a field, a two-step choice.
// - iOS and modal screens: a Modal rendered by a host in the root is presented from the root view
//   controller, which is already presenting a modal or formSheet screen, so it never shows from
//   there. Either keep dialogs of a modal screen inside that screen, or render the host's layer the
//   way ui-states-and-feedback's ConfirmDialog does (AboveModalScreens on iOS, Modal on Android).
// Each dialog view is still a contract screen (presentation "dialog") with its own testIDs, drawn
// in Modal or the library Scrim, and its copy comes translated from the model that opened it.
import { createContext, use, useState } from 'react';

import { DeleteListDialog } from '@/features/lists/delete-list-dialog/delete-list-dialog';
import { MoveTaskDialog } from '@/features/tasks/move-task-dialog/move-task-dialog';

import type { ReactNode } from 'react';

/** Every dialog the app can show, by kind; each carries its translated copy and its handlers. */
export type DialogRequest =
  | {
      readonly kind: 'delete-list';
      readonly title: string;
      readonly body: string;
      readonly confirmLabel: string;
      readonly cancelLabel: string;
      readonly onConfirm: () => void;
      readonly onCancel?: () => void;
    }
  | {
      readonly kind: 'move-task';
      readonly title: string;
      readonly lists: readonly { readonly id: string; readonly name: string }[];
      readonly cancelLabel: string;
      readonly onMove: (listId: string) => void;
      readonly onCancel?: () => void;
    };

type OpenDialog = (request: DialogRequest) => void;

const OpenDialogContext = createContext<OpenDialog | null>(null);

/** For model hooks: open a dialog. Throws outside the host, so a missing provider fails loudly. */
export function useOpenDialog(): OpenDialog {
  const open = use(OpenDialogContext);
  if (open === null) throw new Error('useOpenDialog needs DialogHost above it (root-stack.tsx).');
  return open;
}

export function DialogHost(props: {
  readonly isReducedMotion: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const open: OpenDialog = (next) => {
    request?.onCancel?.(); // the older dialog is answered, never left waiting
    setRequest(next);
  };
  const close = (): void => {
    setRequest(null);
  };
  const cancel = (): void => {
    request?.onCancel?.();
    close();
  };
  return (
    <OpenDialogContext value={open}>
      {props.children}
      {request?.kind === 'delete-list' ? (
        <DeleteListDialog
          title={request.title}
          body={request.body}
          confirmLabel={request.confirmLabel}
          cancelLabel={request.cancelLabel}
          // The action runs, then the dialog closes.
          onConfirm={() => {
            request.onConfirm();
            close();
          }}
          onCancel={cancel}
          isReducedMotion={props.isReducedMotion}
        />
      ) : null}
      {request?.kind === 'move-task' ? (
        <MoveTaskDialog
          title={request.title}
          lists={request.lists}
          cancelLabel={request.cancelLabel}
          onMove={(listId) => {
            request.onMove(listId);
            close();
          }}
          onCancel={cancel}
        />
      ) : null}
    </OpenDialogContext>
  );
}
