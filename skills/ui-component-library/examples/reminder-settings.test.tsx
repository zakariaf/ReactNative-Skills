// src/features/settings/components/reminder-settings.test.tsx (example: a shape to imitate, never copied)
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { ReminderSettings } from './reminder-settings';

import type { ReminderSettingsProps } from './reminder-settings';

const COPY: ReminderSettingsProps['copy'] = {
  title: 'Reminders',
  dailyLabel: 'Daily reminder',
  timeLabel: 'Default time',
  timeA11yLabel: 'Default time, 9:00',
  volumeLabel: 'Volume',
  volumeSliderLabel: 'Reminder volume',
};

function props(overrides: Partial<ReminderSettingsProps> = {}): ReminderSettingsProps {
  return {
    copy: COPY,
    timeText: '9:00',
    isDailyOn: true,
    volume: 0.5,
    bellIcon: () => null,
    isReducedMotion: true,
    onToggleDaily: jest.fn(),
    onOpenTime: jest.fn(),
    onVolume: jest.fn(),
    ...overrides,
  };
}

describe('ReminderSettings', () => {
  it('switches the daily reminder through the switch row', async () => {
    const onToggleDaily = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(<ReminderSettings {...props({ onToggleDaily })} />);

    const row = screen.getByRole('switch', { name: 'Daily reminder' });
    expect(row).toBeChecked();
    await user.press(row);

    expect(onToggleDaily).toHaveBeenCalledTimes(1);
  });

  it('adjusts the volume by a tenth per screen-reader swipe', async () => {
    const onVolume = jest.fn();
    await renderWithProviders(<ReminderSettings {...props({ onVolume })} />);

    await fireEvent(
      screen.getByRole('adjustable', { name: 'Reminder volume' }),
      'accessibilityAction',
      {
        nativeEvent: { actionName: 'increment' },
      },
    );

    expect(onVolume).toHaveBeenCalledWith(0.6);
  });

  it('hides the volume while the reminder is off, and every pressable is named', async () => {
    await renderWithProviders(<ReminderSettings {...props({ isDailyOn: false })} />);

    expect(screen.queryByTestId('settings.reminder-volume-row')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Default time, 9:00' })).toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
