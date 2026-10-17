// src/i18n/format-date.test.ts
import { createIntl } from 'react-intl';

import { FSI, PDI, stripIsolates } from './bidi';
import { createT } from './create-t';
import { localeTagFor } from './digits';
import {
  formatDayMonth,
  formatMonthShort,
  formatWeekdayDayMonth,
  formatWeekdayName,
} from './format-date';
import { SOURCE_LANGUAGE } from './languages';
import { messagesFor } from './messages';

import type { TFunction } from './create-t';
import type { Language } from './languages';

function failOnError(error: Error): never {
  throw error;
}

function tFor(language: Language): TFunction {
  const intl = createIntl({
    locale: localeTagFor(language, 'automatic'),
    messages: messagesFor(language),
    defaultLocale: SOURCE_LANGUAGE,
    onError: failOnError,
  });
  return createT({ intl, onError: failOnError });
}

describe('formatDayMonth', () => {
  it.each([
    ['en', '26 Sep'],
    ['ar', '٢٦ سبتمبر'],
  ] as const)('formats 2026-09-26 in %s with Gregorian months and its digits', (language, text) => {
    expect(stripIsolates(formatDayMonth('2026-09-26', tFor(language)))).toBe(text);
  });

  describe('when the date goes into another message', () => {
    it('nests isolates unless the inner ones are stripped first', () => {
      const t = tFor('ar');
      const date = formatDayMonth('2026-09-26', t);
      expect(date).toBe(`٢٦ ${FSI}سبتمبر${PDI}`);
      expect(t('reminders.next', { dateText: date })).toBe(
        `التذكير التالي – ${FSI}٢٦ ${FSI}سبتمبر${PDI}${PDI}`,
      );
      expect(t('reminders.next', { dateText: stripIsolates(date) })).toBe(
        `التذكير التالي – ${FSI}٢٦ سبتمبر${PDI}`,
      );
    });
  });
});

describe('the weekday and month helpers', () => {
  it('names 2026-09-26, a Saturday, from the catalogs', () => {
    const t = tFor('en');
    expect([
      formatMonthShort('2026-09-26', t),
      formatWeekdayName('2026-09-26', t),
      stripIsolates(formatWeekdayDayMonth('2026-09-26', t)),
    ]).toStrictEqual(['Sep', 'Saturday', 'Saturday, 26 Sep']);
  });

  it('writes the Arabic comma between the weekday and the date', () => {
    expect(stripIsolates(formatWeekdayDayMonth('2026-09-26', tFor('ar')))).toBe('السبت، ٢٦ سبتمبر');
  });
});
