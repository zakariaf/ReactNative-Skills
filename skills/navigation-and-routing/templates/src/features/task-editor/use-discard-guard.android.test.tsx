// src/features/task-editor/use-discard-guard.android.test.tsx
// Android's back button and back gesture reach the same guard (the android Jest project: preset
// jest-expo/android, where BackHandler is the real module): with unsaved changes the screen stays
// and asks, without them the stack pops.
import { act, screen, userEvent } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { DeviceEventEmitter, TextInput, View } from 'react-native';

import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { useDiscardGuard } from './use-discard-guard';

import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

function StackLayout(): ReactNode {
  return <Stack />;
}

function ListStandIn(): ReactNode {
  return <AppText>Tasks</AppText>;
}

function EditorStandIn(): ReactNode {
  const [title, setTitle] = useState('');
  const guard = useDiscardGuard(title.length > 0);
  return (
    <View>
      <TextInput accessibilityLabel="Title" value={title} onChangeText={setTitle} />
      {guard.isPromptOpen ? (
        <View accessible accessibilityRole="alert" accessibilityLabel="Discard changes?" />
      ) : null}
    </View>
  );
}

/**
 * Hrefs of the stand-in routes below. They are not the app's routes, so the generated typed routes
 * (experiments.typedRoutes) do not know them; app code never casts an href.
 */
const TASK_7_EDIT = '/tasks/7/edit' as Href;

const ROUTES = {
  _layout: StackLayout,
  index: ListStandIn,
  'tasks/[taskId]/edit': EditorStandIn,
};

async function openEditor(): Promise<Awaited<ReturnType<typeof renderRouterWithProviders>>> {
  const view = await renderRouterWithProviders(ROUTES);
  await act(() => {
    router.push(TASK_7_EDIT);
  });
  return view;
}

describe('useDiscardGuard on Android', () => {
  it('keeps the screen and asks on the back button while changes are unsaved', async () => {
    const user = userEvent.setup();
    const view = await openEditor();
    await user.type(screen.getByLabelText('Title'), 'Buy milk');

    await act(() => {
      DeviceEventEmitter.emit('hardwareBackPress');
    });

    expect(screen.getByRole('alert', { name: 'Discard changes?' })).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/tasks/7/edit');
  });

  it('pops the stack on the back button when nothing was typed', async () => {
    const view = await openEditor();

    await act(() => {
      DeviceEventEmitter.emit('hardwareBackPress');
    });

    expect(view.getPathname()).toBe('/');
  });
});
