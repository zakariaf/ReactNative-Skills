// src/features/tasks/components/tasks-state-switch.test.tsx
// Renders every state contracts/screen-states.json declares for the tasks screen.
import { act, screen, userEvent } from '@testing-library/react-native';

import { tasksStateCopyOf } from '@/features/tasks/tasks-state-copy';
import { AppText } from '@/ui/app-text';
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { TasksStateSwitch } from './tasks-state-switch';

import type { Task } from '@/features/tasks/task-list';
import type { TFunction } from '@/i18n/create-t';
import type { ListScreenState } from '@/ui/feedback/screen-state';

const echo: TFunction = (key) => key;
const TASKS: readonly Task[] = [{ id: 'task-1', title: 'Buy milk', isDone: false }];

type Handlers = { onRetry: jest.Mock; onCreate: jest.Mock; onClearFilter: jest.Mock };

async function renderState(state: ListScreenState<Task>): Promise<Handlers> {
  const handlers = { onRetry: jest.fn(), onCreate: jest.fn(), onClearFilter: jest.fn() };
  await renderWithProviders(
    <TasksStateSwitch
      state={state}
      copy={tasksStateCopyOf(state, echo)}
      {...handlers}
      isReducedMotion
      renderReady={(tasks) => <AppText testID="tasks.list">{tasks[0]?.title ?? ''}</AppText>}
    />,
  );
  return handlers;
}

describe('TasksStateSwitch', () => {
  it('shows the row-shaped placeholder only once a load is slow', async () => {
    jest.useFakeTimers();
    await renderState({ kind: 'loading' });
    expect(screen.queryByTestId('tasks.state.loading')).not.toBeOnTheScreen();
    await act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(
      screen.getByRole('progressbar', { name: 'tasks.state.loading.label' }),
    ).toBeOnTheScreen();
    jest.useRealTimers();
  });

  it('offers a retry when the load failed, with the failure’s message', async () => {
    const user = userEvent.setup();
    const { onRetry } = await renderState({
      kind: 'failed',
      messageKey: 'feedback.failure.unknown',
    });
    expect(screen.getByTestId('tasks.state.failed.body')).toHaveTextContent(
      'feedback.failure.unknown',
    );
    await user.press(screen.getByTestId('tasks.state.failed.action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('offers to add the first task when there is none', async () => {
    const user = userEvent.setup();
    const { onCreate } = await renderState({ kind: 'empty' });
    await user.press(screen.getByTestId('tasks.state.empty.action'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('offers to clear the filter when nothing matches it', async () => {
    const user = userEvent.setup();
    const { onClearFilter } = await renderState({ kind: 'filtered-empty' });
    await user.press(screen.getByTestId('tasks.state.filtered-empty.action'));
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });

  it('waits for the network without an error or a button when offline', async () => {
    await renderState({ kind: 'offline' });
    expect(screen.getByTestId('tasks.state.offline.title')).toHaveTextContent(
      'tasks.state.offline.title',
    );
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('renders the list once ready', async () => {
    await renderState({ kind: 'ready', items: TASKS, isRefreshing: true, notice: null });
    expect(screen.getByTestId('tasks.list')).toHaveTextContent('Buy milk');
  });
});
