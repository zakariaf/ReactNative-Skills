// src/features/settings/components/reset-data-sheet.tsx
import { Overlay } from '@/ui/overlay';

import type { ReactNode } from 'react';

export function ResetDataSheet(props: { readonly isOpen: boolean; readonly sheet: ReactNode; readonly children: ReactNode }): ReactNode {
  return (
    <Overlay isOpen={props.isOpen} content={props.sheet}>
      {props.children}
    </Overlay>
  );
}
