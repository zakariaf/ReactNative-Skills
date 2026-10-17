// src/ui/toggle-tile.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { PressFeedbackProvider } from './press-feedback-context';
import { ToggleTile } from './toggle-tile';

const HIDDEN = { includeHiddenElements: true } as const;

describe('ToggleTile', () => {
  it('is a switch whose state is written and checked, not only coloured', async () => {
    await renderWithProviders(
      <>
        <ToggleTile
          label="Sounds"
          stateText="On"
          isOn
          icon={() => null}
          onToggle={jest.fn()}
          testID="quick.sounds-switch"
          isReducedMotion
        />
        <ToggleTile
          label="Vibration"
          stateText="Off"
          isOn={false}
          icon={() => null}
          onToggle={jest.fn()}
          testID="quick.vibration-switch"
          isReducedMotion
        />
      </>,
    );

    expect(screen.getByRole('switch', { name: 'Sounds' })).toBeChecked();
    expect(screen.getByTestId('quick.sounds-switch.state')).toHaveTextContent('On');
    expect(screen.getByTestId('quick.sounds-switch.check', HIDDEN)).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: 'Vibration' })).not.toBeChecked();
    expect(screen.getByTestId('quick.vibration-switch.state')).toHaveTextContent('Off');
    expect(screen.queryByTestId('quick.vibration-switch.check', HIDDEN)).not.toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('plays no tap feedback: a switch plays its own from its handler', async () => {
    const onFeedback = jest.fn();
    const onToggle = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <PressFeedbackProvider onPress={onFeedback}>
        <ToggleTile
          label="Vibration"
          stateText="Off"
          isOn={false}
          icon={() => null}
          onToggle={onToggle}
          testID="quick.vibration-switch"
          isReducedMotion
        />
      </PressFeedbackProvider>,
    );

    await user.press(screen.getByRole('switch', { name: 'Vibration' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onFeedback).not.toHaveBeenCalled();
  });

  it('grows into its cell without a zero flex basis', async () => {
    await renderWithProviders(
      <ToggleTile
        label="Focus"
        stateText="Off"
        isOn={false}
        icon={() => null}
        onToggle={jest.fn()}
        testID="quick.focus-switch"
        isReducedMotion
      />,
    );

    expect(screen.getByRole('switch', { name: 'Focus' })).toHaveStyle({ flexGrow: 1 });
    expect(screen.getByRole('switch', { name: 'Focus' })).not.toHaveStyle({ flex: 1 });
  });
});
