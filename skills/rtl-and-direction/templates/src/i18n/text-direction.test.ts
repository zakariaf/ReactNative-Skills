// src/i18n/text-direction.test.ts
import { isolate } from './bidi';
import { firstStrongDirection } from './text-direction';

describe('firstStrongDirection', () => {
  it.each([
    ['Buy milk!', 'ltr'],
    ['اشترِ الحليب!', 'rtl'],
    ['קניות', 'rtl'],
    ['  42 — Inbox', 'ltr'],
    ['٣ مهام', 'rtl'],
    ['Ünïcode', 'ltr'],
  ] as const)('reads %j as %s', (text, direction) => {
    expect(firstStrongDirection(text)).toBe(direction);
  });

  it('returns null for text without a strong letter, so the caller uses the layout', () => {
    expect(firstStrongDirection('')).toBeNull();
    expect(firstStrongDirection('12:30 — 45%')).toBeNull();
  });

  it('skips a run inside first-strong isolates', () => {
    expect(firstStrongDirection(`${isolate('Inbox')} مهام`)).toBe('rtl');
  });
});
