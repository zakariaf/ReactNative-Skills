// src/i18n/create-t.test.ts
import { createIntl } from 'react-intl';

import { FSI, PDI } from './bidi';
import { createT } from './create-t';
import { localeTagFor } from './digits';
import { SOURCE_LANGUAGE } from './languages';
import { messagesFor } from './messages';

import type { TFunction } from './create-t';
import type { DigitStyle } from './digits';
import type { Language } from './languages';

function failOnError(error: Error): never {
  throw error;
}

function tFor(
  language: Language,
  digits: DigitStyle = 'automatic',
  onError: (error: Error) => void = failOnError,
): TFunction {
  const intl = createIntl({
    locale: localeTagFor(language, digits),
    messages: messagesFor(language),
    defaultLocale: SOURCE_LANGUAGE,
    onError,
  });
  return createT({ intl, onError });
}

describe('t()', () => {
  it.each([
    ['en', 0, 'No open tasks'],
    ['en', 1, '1 open task'],
    ['en', 2, '2 open tasks'],
    ['ar', 0, 'لا توجد مهام مفتوحة'],
    ['ar', 1, 'مهمة مفتوحة واحدة'],
    ['ar', 2, 'مهمتان مفتوحتان'],
    ['ar', 3, '٣ مهام مفتوحة'],
    ['ar', 11, '١١ مهمة مفتوحة'],
    ['ar', 100, '١٠٠ مهمة مفتوحة'],
  ] as const)('pluralises with the CLDR categories of %s: %i', (language, openCount, expected) => {
    expect(tFor(language)('tasks.summary.open', { openCount })).toBe(expected);
  });

  it('keeps Latin digits when the person picked them', () => {
    expect(tFor('ar', 'latin')('tasks.page', { page: 12 })).toBe('الصفحة 12');
    expect(tFor('ar')('tasks.page', { page: 12 })).toBe('الصفحة ١٢');
  });

  it('formats percentages with the language digits and sign', () => {
    expect(tFor('en')('tasks.progress', { doneRate: 0.42 })).toBe('42% done');
    expect(tFor('ar')('tasks.progress', { doneRate: 0.42 })).toBe('تم إنجاز ٤٢٪؜');
  });

  it('isolates free-text placeholders with FSI ... PDI', () => {
    expect(tFor('ar')('tasks.moved', { listName: 'Groceries' })).toBe(
      `تم النقل إلى ${FSI}Groceries${PDI}`,
    );
  });

  it('reports a number passed to a text placeholder', () => {
    const onError = jest.fn();
    tFor('en', 'automatic', onError)('tasks.moved', { listName: 3 });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('listName') }),
    );
  });
});
