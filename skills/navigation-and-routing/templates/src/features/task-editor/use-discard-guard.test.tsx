// src/features/task-editor/use-discard-guard.test.tsx
// The guard inside a real Expo Router stack: Back with unsaved changes opens the dialog and stays,
// Keep editing closes it, Discard leaves, a clean form leaves at once, a save leaves without
// asking, and a deliberate exit that does not remove the screen leaves the guard armed. The editor here is a small stand-in; the feature's real model hook calls the same guard.
import { act, screen, userEvent } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Button, TextInput, View } from 'react-native';

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
      <Button
        title="Save"
        onPress={() => {
          guard.leave(() => {
            router.dismissTo('/');
          });
        }}
      />
      <Button
        title="Preview"
        onPress={() => {
          guard.leave(() => {
            router.push(PREVIEW);
          });
        }}
      />
      {guard.isPromptOpen ? (
        <View>
          <View accessible accessibilityRole="alert" accessibilityLabel="Discard changes?" />
          <Button title="Keep editing" onPress={guard.keepEditing} />
          <Button title="Discard" onPress={guard.discard} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Hrefs of the stand-in routes below. They are not the app's routes, so the generated typed routes
 * (experiments.typedRoutes) do not know them; app code never casts an href.
 */
const TASK_7_EDIT = '/tasks/7/edit' as Href;
const PREVIEW = '/preview' as Href;

function PreviewStandIn(): ReactNode {
  return <AppText>Preview</AppText>;
}

const ROUTES = {
  _layout: StackLayout,
  index: ListStandIn,
  'tasks/[taskId]/edit': EditorStandIn,
  preview: PreviewStandIn,
};

async function openEditor(): Promise<Awaited<ReturnType<typeof renderRouterWithProviders>>> {
  const view = await renderRouterWithProviders(ROUTES);
  await act(() => {
    router.push(TASK_7_EDIT);
  });
  return view;
}

describe('useDiscardGuard', () => {
  it('keeps the screen and asks when Back would lose unsaved changes', async () => {
    const user = userEvent.setup();
    const view = await openEditor();
    await user.type(screen.getByLabelText('Title'), 'Buy milk');

    await act(() => {
      router.back();
    });

    expect(screen.getByRole('alert', { name: 'Discard changes?' })).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/tasks/7/edit');
  });

  it('stays on the screen with the draft when the person keeps editing', async () => {
    const user = userEvent.setup();
    const view = await openEditor();
    await user.type(screen.getByLabelText('Title'), 'Buy milk');
    await act(() => {
      router.back();
    });

    await user.press(screen.getByRole('button', { name: 'Keep editing' }));

    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Title')).toHaveDisplayValue('Buy milk');
    expect(view.getPathname()).toBe('/tasks/7/edit');
  });

  it('carries out the blocked Back when the person discards', async () => {
    const user = userEvent.setup();
    const view = await openEditor();
    await user.type(screen.getByLabelText('Title'), 'Buy milk');
    await act(() => {
      router.back();
    });

    await user.press(screen.getByRole('button', { name: 'Discard' }));

    expect(await screen.findByText('Tasks')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
  });

  it('leaves at once when nothing was typed', async () => {
    const view = await openEditor();

    await act(() => {
      router.back();
    });

    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
  });

  it('leaves without asking after a save', async () => {
    const user = userEvent.setup();
    const view = await openEditor();
    await user.type(screen.getByLabelText('Title'), 'Buy milk');

    await user.press(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
  });

  it('asks again after a deliberate exit that kept the screen in the stack', async () => {
    const user = userEvent.setup();
    const view = await openEditor();
    await user.type(screen.getByLabelText('Title'), 'Buy milk');
    await user.press(screen.getByRole('button', { name: 'Preview' }));
    expect(view.getPathname()).toBe('/preview');
    await act(() => {
      router.back();
    });

    await act(() => {
      router.back();
    });

    expect(screen.getByRole('alert', { name: 'Discard changes?' })).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/tasks/7/edit');
  });
});
