// src/features/tasks/components/empty-tasks-mascot.tsx
// The empty state of the task list: an informative Rive mascot that reacts to touch.
import { RiveMoment } from '@/ui/animation/rive-moment';

import type { ReactNode } from 'react';

export type EmptyTasksMascotProps = {
  readonly label: string;
  readonly isActive: boolean;
  readonly onError: (error: unknown) => void;
};

export function EmptyTasksMascot({ label, isActive, onError }: EmptyTasksMascotProps): ReactNode {
  return (
    <RiveMoment
      source={require('@/assets/animations/empty-tasks-mascot.riv')}
      stateMachineName="Idle"
      frameRate={30}
      still="first-frame"
      weight="light"
      decorative={false}
      label={label}
      isActive={isActive}
      style={null}
      testID="tasks.empty-mascot"
      onError={onError}
    />
  );
}
