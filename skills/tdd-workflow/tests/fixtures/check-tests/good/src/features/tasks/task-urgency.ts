// src/features/tasks/task-urgency.ts
export type Urgency = 'overdue' | 'today' | 'soon' | 'later';

export function taskUrgency(daysLeft: number): Urgency {
  if (daysLeft < 0) {
    return 'overdue';
  }
  if (daysLeft === 0) {
    return 'today';
  }
  return daysLeft <= 2 ? 'soon' : 'later';
}
