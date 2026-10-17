// src/ui/pressable-surface.android.test.tsx
// no-providers: the press surface is a design-system primitive; it renders on the theme context's
// default (the light theme), which is all the ripple and disabled cases read; the click cases pass
// PressFeedbackProvider themselves.
import { render, screen, userEvent } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { ELEVATION, RADII } from '@/theme/tokens';

import { AppText } from './app-text';
import { PressFeedbackProvider } from './press-feedback-context';
import { PressableSurface } from './pressable-surface';

import type { ReactNode } from 'react';

/**
 * The press config React Native's Pressability hands Jest (the hook RNTL's userEvent presses
 * through). userEvent calls onPress directly, so the system click, which Pressability plays from
 * its touch responder only, is read from the config: android_disableSound decides it on a device.
 */
type PressabilityConfig = { readonly android_disableSound?: boolean | null };
const PROBE_KEY = 'testOnly_pressabilityConfig';

/** Fails loudly when a React Native upgrade drops the probe, so no click case passes vacuously. */
function isClickSilenced(element: { readonly props: Readonly<Record<string, unknown>> }): boolean {
  const handler = element.props['onStartShouldSetResponder'] as
    Readonly<Record<string, unknown>> | undefined;
  const probe = handler?.[PROBE_KEY];
  if (typeof probe !== 'function') {
    throw new Error(
      `Pressability no longer exposes ${PROBE_KEY}: read android_disableSound another way`,
    );
  }
  return (probe as () => PressabilityConfig)().android_disableSound === true;
}

/**
 * A pressable key. The sink look, because a press on the ripple look calls the native ripple view's
 * hotspot command, which Jest has no view for; the click does not depend on the look.
 */
function AddTask(props: { readonly onPress: () => void }): ReactNode {
  return (
    <PressableSurface
      label="Add task"
      onPress={props.onPress}
      testID="tasks.add-button"
      radius={RADII.md}
      fill={PALETTE.light.surface}
      isReducedMotion={false}
      pressKind="sink"
      elevation={ELEVATION.control}
    >
      <AppText variant="buttonLabel">Add task</AppText>
    </PressableSurface>
  );
}

describe('PressableSurface on Android', () => {
  it('answers a press with the platform ripple in a theme colour, clipped to its corners', async () => {
    await render(
      <PressableSurface
        label="Add task"
        onPress={jest.fn()}
        testID="tasks.add-button"
        radius={RADII.md}
        fill={PALETTE.light.surface}
        isReducedMotion={false}
      >
        <AppText variant="buttonLabel">Add task</AppText>
      </PressableSurface>,
    );

    const button = screen.getByTestId('tasks.add-button');
    expect(button).toHaveProp('nativeForegroundAndroid');
    expect(button).toHaveStyle({ overflow: 'hidden', borderRadius: RADII.md });
  });

  it('keeps the opt-in sink look instead of the ripple', async () => {
    await render(
      <PressableSurface
        label="7"
        onPress={jest.fn()}
        testID="keypad.key-7"
        radius={RADII.sm}
        fill={PALETTE.light.surface}
        isReducedMotion={false}
        pressKind="sink"
        elevation={ELEVATION.control}
        isPushedIn
      >
        <AppText variant="buttonLabel">7</AppText>
      </PressableSurface>,
    );

    const key = screen.getByTestId('keypad.key-7');
    expect(key).not.toHaveProp('nativeForegroundAndroid');
    expect(key).toHaveStyle({ top: ELEVATION.control });
  });

  it("keeps Android's click when the press feedback plays no sound", async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(
      <PressFeedbackProvider onPress={jest.fn()}>
        <AddTask onPress={onPress} />
      </PressFeedbackProvider>,
    );

    await user.press(screen.getByRole('button', { name: 'Add task' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(isClickSilenced(screen.getByTestId('tasks.add-button'))).toBe(false);
  });

  it("turns Android's click off when the press feedback plays its own sound", async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    const playTap = jest.fn();
    await render(
      <PressFeedbackProvider onPress={playTap} playsSound>
        <AddTask onPress={onPress} />
      </PressFeedbackProvider>,
    );

    await user.press(screen.getByRole('button', { name: 'Add task' }));

    expect(playTap).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(isClickSilenced(screen.getByTestId('tasks.add-button'))).toBe(true);
  });
});
