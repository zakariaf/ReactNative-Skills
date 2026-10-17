// src/ui/toggle.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { Toggle } from './toggle';

const HIDDEN = { includeHiddenElements: true } as const;

describe('Toggle', () => {
  it('hides itself and shows no check when off: the row around it is the switch', async () => {
    await renderWithProviders(
      <Toggle isOn={false} isReducedMotion testID="settings.sounds-switch.toggle" />,
    );

    expect(screen.queryByTestId('settings.sounds-switch.toggle')).not.toBeOnTheScreen();
    expect(screen.getByTestId('settings.sounds-switch.toggle', HIDDEN)).toHaveStyle({
      backgroundColor: PALETTE.light.sunken,
    });
    expect(
      screen.queryByTestId('settings.sounds-switch.toggle.check', HIDDEN),
    ).not.toBeOnTheScreen();
  });

  it('carries a check when on, not only the filled track', async () => {
    await renderWithProviders(
      <Toggle isOn isReducedMotion testID="settings.reminders-switch.toggle" />,
    );

    // The check is the cue beyond colour: this fails if it is removed and only the fill is left.
    expect(screen.getByTestId('settings.reminders-switch.toggle.check', HIDDEN)).toBeOnTheScreen();
    expect(screen.getByTestId('settings.reminders-switch.toggle', HIDDEN)).toHaveStyle({
      backgroundColor: PALETTE.light.primary,
    });
  });
});
