// src/features/tasks/components/tasks-state-switch.tsx
// The Tasks screen's one switch over its state: a delayed placeholder shaped like the rows, one
// message per non-happy state with its own next step, and the list once it is ready. Declared in
// contracts/screen-states.json; the test renders every state.
import { StyleSheet, View } from 'react-native';

import { SPACING } from '@/theme/tokens';
import { DelayedPlaceholder } from '@/ui/feedback/delayed-placeholder';
import { SkeletonBlock } from '@/ui/feedback/skeleton-block';
import { StateMessage } from '@/ui/feedback/state-message';

import type { Task } from '@/features/tasks/task-list';
import type { TasksStateCopy } from '@/features/tasks/tasks-state-copy';
import type { ListScreenState } from '@/ui/feedback/screen-state';
import type { ReactNode } from 'react';

export type TasksStateSwitchProps = {
  readonly state: ListScreenState<Task>;
  readonly copy: TasksStateCopy;
  /** Loads again; filters, scroll position and typed text stay as they are. */
  readonly onRetry: () => void;
  readonly onCreate: () => void;
  readonly onClearFilter: () => void;
  readonly isReducedMotion: boolean;
  /** The list, with a quiet refreshing indicator and the copy's notice when there is one. */
  readonly renderReady: (tasks: readonly Task[]) => ReactNode;
};

const ROW_HEIGHT = 52;
const styles = StyleSheet.create({
  rows: { gap: SPACING.sm, paddingBlock: SPACING.lg, paddingInline: SPACING.lg },
});

function settled(props: TasksStateSwitchProps): ReactNode {
  const { state, copy, isReducedMotion } = props;
  switch (state.kind) {
    case 'loading':
      return null;
    case 'offline':
      return (
        <StateMessage
          testID="tasks.state.offline"
          title={copy.offlineTitle}
          body={copy.offlineBody}
          isReducedMotion={isReducedMotion}
        />
      );
    case 'failed':
      return (
        <StateMessage
          testID="tasks.state.failed"
          title={copy.failedTitle}
          body={copy.failedBody}
          action={{ label: copy.failedAction, onPress: props.onRetry }}
          isReducedMotion={isReducedMotion}
        />
      );
    case 'empty':
      return (
        <StateMessage
          testID="tasks.state.empty"
          title={copy.emptyTitle}
          body={copy.emptyBody}
          action={{ label: copy.emptyAction, onPress: props.onCreate }}
          isReducedMotion={isReducedMotion}
        />
      );
    case 'filtered-empty':
      return (
        <StateMessage
          testID="tasks.state.filtered-empty"
          title={copy.filteredTitle}
          body={copy.filteredBody}
          action={{ label: copy.filteredAction, onPress: props.onClearFilter }}
          isReducedMotion={isReducedMotion}
        />
      );
    case 'ready':
      return props.renderReady(state.items);
  }
}

export function TasksStateSwitch(props: TasksStateSwitchProps): ReactNode {
  const placeholder = (
    <View style={styles.rows}>
      <SkeletonBlock width="100%" height={ROW_HEIGHT} />
      <SkeletonBlock width="100%" height={ROW_HEIGHT} />
      <SkeletonBlock width="100%" height={ROW_HEIGHT} />
    </View>
  );
  return (
    <DelayedPlaceholder
      isLoading={props.state.kind === 'loading'}
      placeholder={placeholder}
      label={props.copy.loadingLabel}
      testID="tasks.state.loading"
    >
      {settled(props)}
    </DelayedPlaceholder>
  );
}
