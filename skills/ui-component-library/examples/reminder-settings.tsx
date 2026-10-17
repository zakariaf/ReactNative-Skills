// src/features/settings/components/reminder-settings.tsx (example: a shape to imitate, never copied)
// A settings group built only from the library: the screen model passes translated strings,
// formatted values, the reduce-motion flag and the handlers; the group passes base ids and lets
// each component derive its parts.
import { ListGroup } from '@/ui/list-group';
import { ListRow } from '@/ui/list-row';
import { Slider } from '@/ui/slider';
import { SubRow } from '@/ui/sub-row';

import type { IconSlot } from '@/ui/icon-slot';
import type { ReactNode } from 'react';

/** Everything comes from use-settings-model.ts: copy from t(), numbers formatted, state from stores. */
export type ReminderSettingsProps = {
  readonly copy: {
    readonly title: string;
    readonly dailyLabel: string;
    readonly timeLabel: string;
    /** "Default time, 9:00": built with t() and an ICU placeholder, never glued in the component. */
    readonly timeA11yLabel: string;
    readonly volumeLabel: string;
    readonly volumeSliderLabel: string;
  };
  readonly timeText: string;
  readonly isDailyOn: boolean;
  readonly volume: number;
  readonly bellIcon: IconSlot;
  readonly isReducedMotion: boolean;
  readonly onToggleDaily: () => void;
  readonly onOpenTime: () => void;
  readonly onVolume: (value: number) => void;
};

export function ReminderSettings(props: ReminderSettingsProps): ReactNode {
  const { copy } = props;
  return (
    <ListGroup title={copy.title} testID="settings.reminders" icon={props.bellIcon}>
      <ListRow
        kind="switch"
        label={copy.dailyLabel}
        isOn={props.isDailyOn}
        onPress={props.onToggleDaily}
        testID="settings.daily-reminder-switch"
        isReducedMotion={props.isReducedMotion}
        isFirst
      />
      {props.isDailyOn ? (
        <SubRow label={copy.volumeLabel} testID="settings.reminder-volume-row">
          <Slider
            value={props.volume}
            onChange={props.onVolume}
            label={copy.volumeSliderLabel}
            testID="settings.reminder-volume-slider"
          />
        </SubRow>
      ) : null}
      <ListRow
        kind="navigate"
        label={copy.timeLabel}
        value={props.timeText}
        a11yLabel={copy.timeA11yLabel}
        onPress={props.onOpenTime}
        testID="settings.reminder-time-row"
        isReducedMotion={props.isReducedMotion}
      />
    </ListGroup>
  );
}
