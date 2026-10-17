// src/ui/slider.test.tsx
import { fireEvent, screen } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { Slider } from './slider';

import type { PanGesture } from 'react-native-gesture-handler';

describe('Slider', () => {
  it('is a named, adjustable control whose value is a percentage', async () => {
    await renderWithProviders(
      <Slider
        value={0.4}
        onChange={jest.fn()}
        label="Reminder volume"
        testID="settings.volume-slider"
      />,
    );

    const slider = screen.getByRole('adjustable', { name: 'Reminder volume' });
    expect(slider).toHaveAccessibilityValue({ min: 0, max: 100, now: 40 });
    expect(screen.getByTestId('settings.volume-slider.fill')).toHaveStyle({ width: '40%' });
  });

  it('moves by a tenth for each screen-reader swipe', async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <Slider
        value={0.4}
        onChange={onChange}
        label="Reminder volume"
        testID="settings.volume-slider"
      />,
    );
    const slider = screen.getByRole('adjustable', { name: 'Reminder volume' });

    await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });

    expect(onChange).toHaveBeenNthCalledWith(1, 0.5);
    expect(onChange).toHaveBeenNthCalledWith(2, 0.3);
  });

  it('follows a sideways drag across its width', async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <Slider
        value={0}
        onChange={onChange}
        label="Reminder volume"
        testID="settings.volume-slider"
        gestureTestID="settings.volume-slider"
      />,
    );
    await fireEvent(screen.getByRole('adjustable'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 44 } },
    });

    fireGestureHandler<PanGesture>(getByGestureTestId('settings.volume-slider.pan'), [
      { state: State.BEGAN, x: 0 },
      { state: State.ACTIVE, x: 50 },
      { state: State.ACTIVE, x: 150 },
      { state: State.END, x: 150 },
    ]);

    expect(onChange).toHaveBeenNthCalledWith(1, 0.25);
    expect(onChange).toHaveBeenLastCalledWith(0.75);
  });

  it('mutes the fill when what it controls is off', async () => {
    await renderWithProviders(
      <Slider
        value={0.6}
        onChange={jest.fn()}
        label="Reminder volume"
        testID="settings.volume-slider"
        isMuted
      />,
    );

    expect(screen.getByTestId('settings.volume-slider.fill')).toHaveStyle({
      backgroundColor: PALETTE.light.textMuted,
    });
  });
});
