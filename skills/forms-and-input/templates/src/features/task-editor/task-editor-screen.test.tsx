// src/features/task-editor/task-editor-screen.test.tsx
// The screen with its real model, driven the way a person drives it: type, leave a field, press
// Save. Queries go by label and role (VoiceOver and TalkBack read the same names).
import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import { ok } from '@/core/result';
import { DONE_BAR_GAP } from '@/hooks/use-done-bar-space';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { KEYBOARD_DONE_BAR_MIN_HEIGHT } from '@/ui/form/keyboard-done-bar';
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { createFormTestWrapper } from '@test/forms/i18n-form-wrapper';

import { TaskEditorScreen } from './task-editor-screen';
import { useTaskEditorModel } from './use-task-editor-model';

import type { TaskEditorDeps } from './use-task-editor-model';

jest.mock('react-native-keyboard-controller');

type KeyboardControllerMock = {
  readonly useKeyboardState: jest.Mock<unknown, [((state: { isVisible: boolean }) => unknown)?]>;
};

const keyboardController = jest.requireMock<KeyboardControllerMock>(
  'react-native-keyboard-controller',
);

function keyboardIsUp(): void {
  keyboardController.useKeyboardState.mockImplementation((selector) =>
    selector === undefined ? undefined : selector({ isVisible: true }),
  );
}

function TaskEditorRoute(props: { readonly deps: TaskEditorDeps }): React.JSX.Element {
  const model = useTaskEditorModel(props.deps);
  return <TaskEditorScreen {...model} />;
}

async function openEditor(): Promise<TaskEditorDeps & { save: jest.Mock }> {
  const deps = {
    openTitles: [],
    save: jest.fn(() => Promise.resolve(ok(undefined))),
    onSaved: jest.fn(),
  };
  const { wrapper } = createFormTestWrapper({ services: { errorLog: createFakeErrorLog() } });
  await render(<TaskEditorRoute deps={deps} />, { wrapper });
  return deps;
}

describe('TaskEditorScreen', () => {
  it('adds a task from what was typed', async () => {
    const user = userEvent.setup();
    const deps = await openEditor();

    await user.type(screen.getByLabelText('Title'), 'Call Sam');
    await user.type(screen.getByLabelText('Estimate in minutes'), '15');
    await user.press(screen.getByRole('button', { name: 'Add task' }));

    expect(deps.save).toHaveBeenCalledWith({ title: 'Call Sam', notes: '', estimateMinutes: 15 });
  });

  it('shows the error under a field once the person leaves it empty', async () => {
    const user = userEvent.setup();
    await openEditor();

    await user.type(screen.getByLabelText('Title'), ' ');
    await act(async () => {
      await Promise.resolve();
    });

    expect(await screen.findByText('Give the task a title')).toBeOnTheScreen();
    expect(screen.getByLabelText('Title')).toHaveProp('accessibilityHint', 'Give the task a title');
  });

  it('keeps the first tap on Save while the keyboard is up', async () => {
    await openEditor();

    expect(screen.getByTestId('task-editor.form')).toHaveProp(
      'keyboardShouldPersistTaps',
      'handled',
    );
  });

  it('names every control for screen readers', async () => {
    await openEditor();

    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('keeps the focused field above the Done bar, not just above the keyboard', async () => {
    keyboardIsUp();
    await openEditor();
    const form = screen.getByTestId('task-editor.form');

    expect(form).toHaveProp('bottomOffset', KEYBOARD_DONE_BAR_MIN_HEIGHT + DONE_BAR_GAP);

    // Large text makes the bar taller; the measured height moves the offset with it.
    await fireEvent(screen.getByTestId('task-editor.keyboard'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 92 } },
    });

    expect(form).toHaveProp('bottomOffset', 92 + DONE_BAR_GAP);
    expect(form).toHaveProp('extraKeyboardSpace', 92);
  });
});
