// src/features/tasks/components/list-completed-burst.tsx
// The celebration when the last open task of a list is checked off: a heavy, decorative one-shot.
import { LottieMoment } from '@/ui/animation/lottie-moment';

import type { ReactNode } from 'react';

export type ListCompletedBurstProps = {
  readonly isActive: boolean;
  readonly onFinish: () => void;
  readonly onError: (error: unknown) => void;
};

export function ListCompletedBurst({ isActive, onFinish, onError }: ListCompletedBurstProps): ReactNode {
  return (
    <LottieMoment
      source={require('@/assets/animations/list-completed.json')}
      plays={1}
      still={1}
      weight="heavy"
      decorative
      isActive={isActive}
      style={null}
      testID="tasks.list-completed"
      onFinish={onFinish}
      onError={onError}
    />
  );
}
