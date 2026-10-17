// src/ui/dialog-frame.tsx
import { Modal } from 'react-native';

import { DialogCard } from './dialog-card';

import type { ReactNode } from 'react';

export type DialogFrameProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
};

// RN Modal is its own window on Android and its own presentation on iOS: both screen readers stay inside.
export function DialogFrame({ isOpen, onClose, children }: DialogFrameProps): ReactNode {
  return (
    <Modal transparent visible={isOpen} onRequestClose={onClose} animationType="fade">
      <DialogCard>{children}</DialogCard>
    </Modal>
  );
}
