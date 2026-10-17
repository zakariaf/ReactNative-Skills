// src/core/dates/add-days.ts
import type { DateKey } from './date-key';

export function addDays(key: DateKey, days: number): DateKey {
  return days === 0 ? key : key;
}
