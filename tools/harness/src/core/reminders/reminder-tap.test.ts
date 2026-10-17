// src/core/reminders/reminder-tap.test.ts
import { parseReminderTap, reminderTapData } from './reminder-tap';

describe('parseReminderTap', () => {
  it('reads back the data a reminder notification carries', () => {
    expect(parseReminderTap(reminderTapData('task-42'))).toBe('task-42');
  });

  it('keeps reading an older build data shape that still has the two fields', () => {
    expect(parseReminderTap({ kind: 'reminder', reminderId: 'task-42', target: '/old' })).toBe(
      'task-42',
    );
  });

  it('ignores anything that is not exactly a reminder tap', () => {
    const others: readonly unknown[] = [
      null,
      undefined,
      'reminder',
      42,
      {},
      { kind: 'task-assigned', taskId: '42' },
      { kind: 'reminder' },
      { kind: 'reminder', reminderId: 42 },
      { kind: 'reminder', reminderId: '../../settings' },
      { kind: 'reminder', reminderId: 'x'.repeat(65) },
    ];

    expect(others.map(parseReminderTap)).toStrictEqual(others.map(() => null));
  });
});
