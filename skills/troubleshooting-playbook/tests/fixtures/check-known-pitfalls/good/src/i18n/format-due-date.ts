// src/i18n/format-due-date.ts
import type { IntlShape } from 'react-intl';

export function formatDueDate(intl: IntlShape, dueAt: number): string {
  return intl.formatDate(dueAt, { dateStyle: 'medium' });
}
