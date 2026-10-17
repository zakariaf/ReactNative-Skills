// src/ui/form/keyboard-done-bar.test.tsx
// The root mock (__mocks__/react-native-keyboard-controller.ts) reports a hidden keyboard; a test
// that needs it up replaces useKeyboardState's answer for that test. Tests read the SDK through
// jest.requireMock only: the component is the one file that imports it.
import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { KeyboardDoneBar } from './keyboard-done-bar';

jest.mock('react-native-keyboard-controller');

type KeyboardState = { readonly isVisible: boolean };
type KeyboardControllerMock = {
  readonly useKeyboardState: jest.Mock<unknown, [((state: KeyboardState) => unknown)?]>;
};

const keyboardController = jest.requireMock<KeyboardControllerMock>(
  'react-native-keyboard-controller',
);

function keyboardIsUp(isVisible: boolean): void {
  keyboardController.useKeyboardState.mockImplementation((selector) =>
    selector === undefined ? undefined : selector({ isVisible }),
  );
}

async function renderBar(onHeightChange?: (height: number) => void): Promise<void> {
  await renderWithProviders(
    <KeyboardDoneBar
      testID="task-editor.keyboard"
      label="Done"
      isReducedMotion={false}
      onHeightChange={onHeightChange}
    />,
  );
}

describe('KeyboardDoneBar', () => {
  it('renders nothing while the keyboard is down', async () => {
    keyboardIsUp(false);
    await renderBar();

    expect(screen.queryByTestId('task-editor.keyboard')).not.toBeOnTheScreen();
  });

  it('closes the keyboard from a named button while it is up', async () => {
    keyboardIsUp(true);
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const user = userEvent.setup();
    await renderBar();

    await user.press(screen.getByRole('button', { name: 'Done' }));

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('reports its measured height, which grows with the text size', async () => {
    keyboardIsUp(true);
    const onHeightChange = jest.fn();
    await renderBar(onHeightChange);

    await fireEvent(screen.getByTestId('task-editor.keyboard'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 81 } },
    });

    expect(onHeightChange).toHaveBeenCalledWith(81);
  });
});
