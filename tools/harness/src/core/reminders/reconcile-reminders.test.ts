// src/core/reminders/reconcile-reminders.test.ts
import { planInput, reminderRow } from '@test/reminders/reminder-rows';

import { planReminders } from './plan-reminders';
import { reconcileReminders } from './reconcile-reminders';

const plan = planReminders(planInput({ horizonDays: 3 })).notifications;
const planIds = plan.map((notification) => notification.id);

describe('reconcileReminders', () => {
  it('schedules everything when nothing is pending', () => {
    expect(reconcileReminders(plan, [])).toStrictEqual({ cancel: [], schedule: plan });
  });

  it('is an empty diff when the pending set already equals the plan', () => {
    expect(reconcileReminders(plan, planIds)).toStrictEqual({ cancel: [], schedule: [] });
  });

  it('turns an edit into a cancel of the old identifiers and a schedule of the new ones', () => {
    const edited = planReminders(
      planInput({
        horizonDays: 3,
        reminders: [reminderRow({ schedule: { kind: 'daily', minuteOfDay: 10 * 60 } })],
      }),
    ).notifications;

    const diff = reconcileReminders(edited, planIds);

    expect(diff.cancel).toStrictEqual(planIds);
    expect(diff.schedule).toStrictEqual(edited);
  });

  it('keeps a pending notification due within the lead, but not one of a deleted row', () => {
    // Two seconds before the first 09:00: too close to schedule again, already in the OS.
    const late = { horizonDays: 3, nowMs: Date.UTC(2026, 9, 14, 8, 59, 58) };
    const kept = planReminders(planInput(late));
    const deleted = planReminders(planInput({ ...late, reminders: [] }));

    expect(kept.imminentIds).toStrictEqual(planIds.slice(0, 1));
    expect(reconcileReminders(kept.notifications, planIds, kept.imminentIds)).toStrictEqual({
      cancel: [],
      schedule: [],
    });
    expect(
      reconcileReminders(deleted.notifications, planIds, deleted.imminentIds).cancel,
    ).toStrictEqual(planIds);
  });

  it('cancels only pending notifications it planned itself', () => {
    const foreign = ['push-welcome', 'timer:tea', 'e3a1c2d4-uuid'];

    expect(reconcileReminders([], [...foreign, ...planIds]).cancel).toStrictEqual(planIds);
  });
});
