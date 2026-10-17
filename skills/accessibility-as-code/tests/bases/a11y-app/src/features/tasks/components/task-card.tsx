// src/features/tasks/components/task-card.tsx
import { ActionCard } from '@/ui/action-card';
import { AppText } from '@/ui/app-text';
import { Button } from '@/ui/button';

import type { ReactNode } from 'react';

export type TaskCardProps = {
  /** The stable data key: the card repeats in a list, so its testID carries it. */
  readonly taskId: string;
  readonly title: string;
  readonly dueText: string;
  /** The visible texts joined in reading order, built with t() in the model hook. */
  readonly openLabel: string;
  readonly completeLabel: string;
  readonly onOpen: () => void;
  readonly onComplete: () => void;
};

// The card body opens the task and its Complete button completes it: the shared card keeps them siblings.
export function TaskCard(props: TaskCardProps): ReactNode {
  return (
    <ActionCard
      openLabel={props.openLabel}
      onOpen={props.onOpen}
      testID={`tasks.task-card.${props.taskId}`}
      action={<Button label={props.completeLabel} onPress={props.onComplete} testID={`tasks.task-card.${props.taskId}.complete-button`} />}
    >
      <AppText text={props.title} />
      <AppText text={props.dueText} />
    </ActionCard>
  );
}
