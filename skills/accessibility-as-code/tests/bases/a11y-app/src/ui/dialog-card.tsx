// src/ui/dialog-card.tsx
import { View } from 'react-native';

import type { ReactNode } from 'react';

/** The card inside a dialog; the dialog's root is the modal one, never this card. */
export function DialogCard({ children }: { readonly children: ReactNode }): ReactNode {
  return <View testID="dialog.card">{children}</View>;
}
