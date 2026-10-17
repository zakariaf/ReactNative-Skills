// src/features/tasks/tasks-screen.tsx (example: the Tasks view with its banner, states and notice)
// A pure view of the model: the offline banner above everything (a lasting condition), the one state
// switch, and for a ready list the notice line that says it may be out of date, a quiet "Updating"
// line for background refetches, and pull to refresh. No placeholder ever replaces a list that is
// already on screen.
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { SPACING } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';
import { OfflineBanner } from '@/ui/feedback/offline-banner';

import { TaskRow } from './components/task-row';
import { TasksStateSwitch } from './components/tasks-state-switch';

import type { Task } from './task-list';
import type { TasksModel } from './use-tasks-model';
import type { ReactNode } from 'react';

export type TasksScreenProps = {
  readonly model: TasksModel;
  /** From feedbackCopyOf(t) in the root stack's model, passed down. */
  readonly offlineText: string;
  readonly unvalidatedText: string;
  /** Translated "Updating…" for a background refetch behind the list. */
  readonly updatingText: string;
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  notice: { paddingBlock: SPACING.sm, paddingInline: SPACING.lg },
});

type ReadyListProps = {
  readonly model: TasksModel;
  readonly tasks: readonly Task[];
  readonly updatingText: string;
};

function ReadyList({ model, tasks, updatingText }: ReadyListProps): ReactNode {
  // A background refetch (focus, reconnect, after a write) is a quiet line, never the pull spinner.
  const isUpdating =
    model.state.kind === 'ready' && model.state.isRefreshing && !model.isRefreshingByUser;
  return (
    <FlatList
      testID="tasks.list"
      data={tasks}
      keyExtractor={(task) => task.id}
      // The platform spinner only while the person's own pull runs: on iOS a `refreshing` set true
      // from code also shows the UIRefreshControl and can push the rows down without a pull.
      refreshControl={
        <RefreshControl refreshing={model.isRefreshingByUser} onRefresh={model.onRefresh} />
      }
      ListHeaderComponent={
        <>
          {model.copy.notice === null ? null : (
            <AppText testID="tasks.list-notice" tone="muted" style={styles.notice}>
              {model.copy.notice}
            </AppText>
          )}
          {isUpdating ? (
            <AppText testID="tasks.list-updating" tone="muted" style={styles.notice}>
              {updatingText}
            </AppText>
          ) : null}
        </>
      }
      renderItem={({ item }) => (
        <TaskRow task={item} onDelete={model.onDelete} isReducedMotion={model.isReducedMotion} />
      )}
    />
  );
}

export function TasksScreen({
  model,
  offlineText,
  unvalidatedText,
  updatingText,
}: TasksScreenProps): ReactNode {
  return (
    <View style={styles.fill}>
      <OfflineBanner
        reachability={model.reachability}
        offlineText={offlineText}
        unvalidatedText={unvalidatedText}
        testID="tasks.offline-banner"
      />
      <TasksStateSwitch
        state={model.state}
        copy={model.copy}
        onRetry={model.onRetry}
        onCreate={model.onCreate}
        onClearFilter={model.onClearFilter}
        isReducedMotion={model.isReducedMotion}
        renderReady={(tasks) => (
          <ReadyList model={model} tasks={tasks} updatingText={updatingText} />
        )}
      />
    </View>
  );
}
