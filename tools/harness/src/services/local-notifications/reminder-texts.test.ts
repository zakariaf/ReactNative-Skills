// src/services/local-notifications/reminder-texts.test.ts
import { reminderRow } from '@test/reminders/reminder-rows';

import {
  REMINDERS_CHANNEL_ID,
  REMINDER_CHANNEL_IDS,
  describeReminder,
  namedReminderChannels,
  reminderTexts,
} from './reminder-texts';

import type { TFunction } from '@/i18n/create-t';

/** A t() that shows which key and values were used. */
const t: TFunction = (key, values) =>
  values === undefined ? key : `${key} ${JSON.stringify(values)}`;

describe('reminder texts', () => {
  it('names every channel in the current language', () => {
    expect(namedReminderChannels(t)).toStrictEqual([
      {
        id: REMINDERS_CHANNEL_ID,
        name: 'reminders.channel.reminders.name',
        description: 'reminders.channel.reminders.description',
        importance: 'high',
      },
    ]);
    expect(REMINDER_CHANNEL_IDS).toStrictEqual([REMINDERS_CHANNEL_ID]);
  });

  it('quotes the label as a text placeholder, and has a text for an empty label', () => {
    const describeOccurrence = describeReminder(t);
    const occurrence = { reminder: reminderRow(), fireAtMs: 0, day: null };

    expect(describeOccurrence(occurrence)).toStrictEqual({
      title: 'reminders.notification.title',
      body: 'reminders.notification.body {"labelText":"Water the plants"}',
    });
    expect(describeOccurrence({ ...occurrence, reminder: reminderRow({ label: '' }) }).body).toBe(
      'reminders.notification.body-unlabelled',
    );
  });

  it('builds the channels and the texts of one run from the same t()', () => {
    const texts = reminderTexts(t);
    const occurrence = { reminder: reminderRow(), fireAtMs: 0, day: null };

    expect(texts.channels).toStrictEqual(namedReminderChannels(t));
    expect(texts.describe(occurrence)).toStrictEqual(describeReminder(t)(occurrence));
  });
});
