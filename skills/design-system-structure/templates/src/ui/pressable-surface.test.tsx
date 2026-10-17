// src/ui/pressable-surface.test.tsx
// no-providers: the press surface is a design-system primitive; it renders on the theme context's
// default (the light theme), and the feedback cases pass PressFeedbackProvider themselves.
import { render, screen, userEvent } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { ELEVATION, RADII } from '@/theme/tokens';

import { AppText } from './app-text';
import { PressFeedbackProvider } from './press-feedback-context';
import { PressableSurface, pressLookOf } from './pressable-surface';

import type { PressableSurfaceProps } from './pressable-surface';

type Base = Omit<PressableSurfaceProps, 'children' | 'label' | 'testID' | 'onPress'>;

const BUTTON: Base = {
  radius: RADII.md,
  fill: PALETTE.light.surface,
  isReducedMotion: false,
};
/** A key of the opt-in sink look (a keypad, a segmented control styled as keys). */
const KEY_SEGMENT: Base = {
  ...BUTTON,
  pressKind: 'sink',
  elevation: ELEVATION.raised,
  radius: RADII.sm,
  accessibilityRole: 'radio',
};

describe('PressableSurface', () => {
  it('is a named button that reports presses', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(
      <PressableSurface {...BUTTON} label="Add task" onPress={onPress} testID="tasks.add-button">
        <AppText variant="buttonLabel">Add task</AppText>
      </PressableSurface>,
    );

    await user.press(screen.getByRole('button', { name: 'Add task' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ignores presses when disabled, and says so', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(
      <PressableSurface
        {...BUTTON}
        label="Save"
        onPress={onPress}
        testID="task-edit.save-button"
        isDisabled
      >
        <AppText variant="buttonLabel">Save</AppText>
      </PressableSurface>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    await user.press(button);

    expect(button).toBeDisabled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('reports busy and ignores presses while busy', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(
      <PressableSurface
        {...BUTTON}
        label="Saving"
        onPress={onPress}
        testID="task-edit.save-button"
        isBusy
      >
        <AppText variant="buttonLabel">Saving</AppText>
      </PressableSurface>,
    );

    const button = screen.getByRole('button', { name: 'Saving' });
    await user.press(button);

    expect(button).toBeBusy();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('moves a pushed-in key down by layout, where screen readers and Maestro measure it', async () => {
    await render(
      <>
        <PressableSurface
          {...KEY_SEGMENT}
          label="Today"
          onPress={jest.fn()}
          testID="tasks.filter-today"
          isPushedIn
          isSelected
        >
          <AppText variant="buttonLabel">Today</AppText>
        </PressableSurface>
        <PressableSurface
          {...KEY_SEGMENT}
          label="All"
          onPress={jest.fn()}
          testID="tasks.filter-all"
          isSelected={false}
        >
          <AppText variant="buttonLabel">All</AppText>
        </PressableSurface>
      </>,
    );

    expect(screen.getByRole('radio', { name: 'Today' })).toBeSelected();
    expect(screen.getByTestId('tasks.filter-today')).toHaveStyle({ top: ELEVATION.raised });
    expect(screen.getByTestId('tasks.filter-all')).not.toHaveStyle({ top: ELEVATION.raised });
  });

  it('keeps a selected control of the default look in place (its fill shows the state)', async () => {
    await render(
      <PressableSurface
        {...BUTTON}
        label="Today"
        onPress={jest.fn()}
        testID="tasks.filter-today"
        accessibilityRole="radio"
        isPushedIn
        isSelected
      >
        <AppText variant="buttonLabel">Today</AppText>
      </PressableSurface>,
    );

    expect(screen.getByRole('radio', { name: 'Today' })).toBeSelected();
    expect(screen.getByTestId('tasks.filter-today')).not.toHaveStyle({ top: ELEVATION.raised });
  });

  it('runs the press feedback before the action, except on a switch', async () => {
    const calls: string[] = [];
    const user = userEvent.setup();
    await render(
      <PressFeedbackProvider onPress={() => calls.push('feedback')}>
        <PressableSurface
          {...BUTTON}
          label="Done"
          onPress={() => calls.push('done')}
          testID="task-detail.done-button"
        >
          <AppText variant="buttonLabel">Done</AppText>
        </PressableSurface>
        <PressableSurface
          {...BUTTON}
          label="Reminders"
          onPress={() => calls.push('toggle')}
          testID="settings.reminders-switch"
          accessibilityRole="switch"
          isChecked={false}
        >
          <AppText variant="buttonLabel">Reminders</AppText>
        </PressableSurface>
      </PressFeedbackProvider>,
    );

    await user.press(screen.getByRole('button', { name: 'Done' }));
    await user.press(screen.getByRole('switch', { name: 'Reminders' }));

    // A switch's handler plays its own toggle feedback with the state change.
    expect(calls).toStrictEqual(['feedback', 'done', 'toggle']);
  });
});

describe('pressLookOf', () => {
  it('dims on iOS and draws the ripple on Android by default', () => {
    expect(pressLookOf('opacity', 'ios', false)).toBe('opacity');
    expect(pressLookOf('opacity', 'android', false)).toBe('ripple');
    expect(pressLookOf('scale', 'android', false)).toBe('ripple');
  });

  it('turns a shrink into a dim under reduce motion', () => {
    expect(pressLookOf('scale', 'ios', false)).toBe('scale');
    expect(pressLookOf('scale', 'ios', true)).toBe('opacity');
  });

  it('keeps the opt-in sink look on both platforms', () => {
    expect(pressLookOf('sink', 'android', true)).toBe('sink');
  });
});
