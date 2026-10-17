// src/features/lists/delete-list-dialog/delete-list-dialog.tsx
import { Modal, View } from 'react-native';

import { ParityLaunchMarker } from '@/ui/parity-launch-marker';

import type { ReactNode } from 'react';

export function DeleteListDialog({ onCancel }: { readonly onCancel: () => void }): ReactNode {
  return (
    <Modal transparent visible onRequestClose={onCancel}>
      <View testID="delete-list-dialog.scrim" accessibilityViewIsModal>
        <ParityLaunchMarker />
      </View>
    </Modal>
  );
}
