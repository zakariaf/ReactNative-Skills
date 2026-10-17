// src/services/local-notifications/reminder-texts.ts
// The words reminders show, in the person's language: the Android channels (their names and
// descriptions appear in the system Settings, where a channel can be muted on its own) and the
// notification text. Each sync run builds both from one t(): the one useReminderSync passed last
// (the language and digits the app shows), so a language change renames the channels and, through
// the content hash in each identifier, replaces every pending notification. A channel's id and importance are fixed once created on a device (only its name and
// description can change), so an id is never reused for something else: new behaviour, new id.
import type { NotificationText, Occurrence } from '@/core/reminders/plan-reminders';
import type { TFunction } from '@/i18n/create-t';
import type { MessageKey } from '@/i18n/messages';
import type { NamedChannel } from '@/services/local-notifications/local-notifications-port';

export type ReminderChannel = {
  readonly id: string;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly importance: NamedChannel['importance'];
};

/** The channel every reminder row names unless the app adds another one here. */
export const REMINDERS_CHANNEL_ID = 'reminders';

export const REMINDER_CHANNELS: readonly ReminderChannel[] = [
  {
    id: REMINDERS_CHANNEL_ID,
    nameKey: 'reminders.channel.reminders.name',
    descriptionKey: 'reminders.channel.reminders.description',
    importance: 'high',
  },
];

/** The channel ids the planner accepts (PlanInput.channelIds). */
export const REMINDER_CHANNEL_IDS: readonly string[] = REMINDER_CHANNELS.map(({ id }) => id);

/** The channels with their texts in the person's language. */
export function namedReminderChannels(
  t: TFunction,
  channels: readonly ReminderChannel[] = REMINDER_CHANNELS,
): readonly NamedChannel[] {
  return channels.map(({ id, nameKey, descriptionKey, importance }) => ({
    id,
    name: t(nameKey),
    description: t(descriptionKey),
    importance,
  }));
}

/** Everything a sync run shows, from one t(), so the channels and the texts share a language. */
export type ReminderTexts = {
  readonly channels: readonly NamedChannel[];
  readonly describe: (occurrence: Occurrence) => NotificationText;
};

/** The title and body of one occurrence; the label the person wrote is bidi-isolated by t(). */
export function describeReminder(t: TFunction): (occurrence: Occurrence) => NotificationText {
  return ({ reminder }) => ({
    title: t('reminders.notification.title'),
    body:
      reminder.label.length === 0
        ? t('reminders.notification.body-unlabelled')
        : t('reminders.notification.body', { labelText: reminder.label }),
  });
}

/** The texts of one sync run (ReminderSyncDeps.texts). */
export function reminderTexts(t: TFunction): ReminderTexts {
  return { channels: namedReminderChannels(t), describe: describeReminder(t) };
}
