// scripts/i18n/catalog-lint-rules.test.ts
import { lintMessage, ruleLabel } from './catalog-lint-rules.ts';

import type { CatalogPolicy } from './catalog-lint-rules.ts';

const APP: CatalogPolicy = {
  sourceLanguage: 'en',
  untranslatedPrefixes: ['debug.'],
  keyPrefix: null,
  reservedPrefixes: ['billing'],
};

function lint(message: string, language = 'en', key = 'tasks.title'): string {
  return lintMessage({ language, key, message, policy: APP })
    .map((problem) => `${ruleLabel(problem.id)} ${problem.message}`)
    .join('\n');
}

describe('lintMessage', () => {
  it('accepts whole sentences with typed numbers and complete plurals', () => {
    expect(lint('{openCount, plural, =0 {No tasks} one {# task} other {# tasks}}')).toBe('');
    expect(lint('{doneRate, number, ::percent} done')).toBe('');
    const arabic =
      '{n, plural, =0 {لا مهام} one {مهمة} two {مهمتان} few {# مهام} many {# مهمة} other {# مهمة}}';
    expect(lint(arabic, 'ar')).toBe('');
  });

  it.each([
    ['{page} left', '[L4 placeholder-name] {page} is plain text'],
    ['{n, plural, few {a} other {b}}', '[L5 plural-categories] plural category "few" does not'],
    ['{tasksCount, number} tasks', '[L6 count-needs-plural] {tasksCount, number} is followed'],
    ['Page 12', '[L7 literal-digits] literal digits'],
    ['{day, date}', '[L3 no-date-time-tags] no {x, date}'],
    [' Save', '[L11 sentence-shape] starts/ends with space or joiner'],
    ['{dateText}', '[L11 sentence-shape] message is a bare placeholder'],
    ['{n, plural, one {a}', '[L2 icu-syntax] ICU syntax error'],
  ])('rejects %j in English with the checker rule id', (message, expected) => {
    expect(lint(message)).toContain(expected);
  });

  it('asks any source language with spaces between words for a plural after a count', () => {
    const policy = (sourceLanguage: string): CatalogPolicy => ({ ...APP, sourceLanguage });
    const german = { language: 'de', key: 'tasks.title', message: '{n, number} Aufgaben' };
    expect(lintMessage({ ...german, policy: policy('de') })).toContainEqual({
      id: 'L6',
      message: '{n, number} is followed by a word: use {n, plural, one {…} other {…}}',
    });
    // A translation follows the source's plural (P3); Japanese has one form and no spaces.
    expect(lintMessage({ ...german, policy: APP })).toStrictEqual([]);
    const japanese = { language: 'ja', key: 'tasks.title', message: '{n, number} 件のタスク' };
    expect(lintMessage({ ...japanese, policy: policy('ja') })).toStrictEqual([]);
  });

  it('asks Arabic for all six categories, an =N branch standing in for zero', () => {
    expect(lint('{n, plural, one {مهمة} other {# مهمة}}', 'ar')).toContain(
      '{n} lacks the ar cardinal categories zero, two, few, many',
    );
  });

  it('checks the script rules of the language, except for untranslated keys', () => {
    expect(lint('تم الحفظ, شكرا', 'ar')).toContain('[L10 latin-punctuation] Latin , ; ?');
    expect(lint('كتاب', 'fa')).toContain('[L9 arabic-letters] Arabic ي/ك: use ی/ک');
    expect(lint('كتاب', 'ar')).toBe('');
    expect(lint('Debug, menu', 'ar', 'debug.title')).toBe('');
  });

  it('keeps package prefixes and bad key shapes out of the app catalog', () => {
    expect(lint('Monthly', 'en', 'billing.plan')).toContain('[L1b key-namespace] "billing."');
    expect(lint('Tasks', 'en', 'Tasks.Title')).toContain('[L1 key-shape] key must be 2-5');
  });

  it('keeps permission texts plain', () => {
    const key = 'permissions.camera.usage-description';
    expect(lint('{appName} uses the camera.', 'en', key)).toContain(
      '[L13 system-text-plain] is a system dialog text',
    );
  });
});
