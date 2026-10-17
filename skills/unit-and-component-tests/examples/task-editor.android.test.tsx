// src/features/task-editor/task-editor-screen.android.test.tsx — EXAMPLE (a shape to imitate): Android
// behaviour runs under the android project (preset jest-expo/android), where .android.tsx files
// resolve, Platform.OS is 'android' and BackHandler is the real Android module. Verified with
// React Native 0.86.3 and expo-router 57.0.24: DeviceEventEmitter.emit('hardwareBackPress') reaches
// the screen's BackHandler listener first (it returns true to keep the screen), and otherwise pops
// the Expo Router stack; under jest-expo/ios the same event does nothing (BackHandler is a stub there).
import { act, screen } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';
import { DeviceEventEmitter } from 'react-native';

import TasksRoute from '@/app/index';
import TaskEditorRoute from '@/app/tasks/new';
import { renderRouterWithProviders } from '@test/render-router-with-providers';
import { renderWithProviders } from '@test/render-with-providers';

import { TaskEditorScreen } from './task-editor-screen';

const ROUTES = { _layout: () => <Stack />, index: TasksRoute, 'tasks/new': TaskEditorRoute };

describe('TaskEditorScreen on Android', () => {
  it('asks before discarding a draft on the hardware back button', async () => {
    await renderWithProviders(<TaskEditorScreen initialTitle="Buy milk" />);

    await act(() => {
      DeviceEventEmitter.emit('hardwareBackPress');
    });

    expect(screen.getByRole('alert', { name: 'Discard this task?' })).toBeOnTheScreen();
  });

  it('goes back to the list at once when nothing was typed', async () => {
    const view = await renderRouterWithProviders(ROUTES);
    await act(() => {
      router.push('/tasks/new');
    });

    await act(() => {
      DeviceEventEmitter.emit('hardwareBackPress');
    });

    expect(view.getPathname()).toBe('/');
  });
});
