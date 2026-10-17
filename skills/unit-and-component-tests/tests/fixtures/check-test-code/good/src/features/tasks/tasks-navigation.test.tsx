// src/features/tasks/tasks-navigation.test.tsx
import { act, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import TasksRoute from '@/app/index';
import TaskDetailRoute from '@/app/tasks/[id]';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

const ROUTES = { index: TasksRoute, 'tasks/[id]': TaskDetailRoute };

describe('tasks navigation', () => {
  it('opens a task from the list', async () => {
    const user = userEvent.setup();
    const view = await renderRouterWithProviders(ROUTES, { seed: { tasks: [{ id: 'task-7', title: 'Buy milk' }] } });

    await user.press(screen.getByRole('link', { name: 'Buy milk' }));

    expect(await screen.findByRole('header', { name: 'Buy milk' })).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/tasks/task-7');
  });

  it('opens a deep link and returns to the list', async () => {
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/tasks/task-7' });

    await act(() => {
      router.replace('/');
    });

    expect(view.getSegments()).toStrictEqual([]);
  });
});
