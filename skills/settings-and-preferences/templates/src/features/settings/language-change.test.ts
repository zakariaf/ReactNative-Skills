// src/features/settings/language-change.test.ts
import { planLanguageChange } from './language-change';

const ENGLISH_PHONE = [{ languageTag: 'en-GB', languageCode: 'en', languageScriptCode: null }];
const ARABIC_PHONE = [{ languageTag: 'ar-EG', languageCode: 'ar', languageScriptCode: null }];

describe('planLanguageChange', () => {
  it('saves the choice and asks for a restart when the direction flips', () => {
    expect(
      planLanguageChange({ next: 'ar', deviceLocales: ENGLISH_PHONE, layoutDirection: 'ltr' }),
    ).toStrictEqual({
      action: { type: 'set-language', language: 'ar' },
      resolved: 'ar',
      isRestartNeeded: true,
    });
  });

  it('switches at once when the direction stays the same', () => {
    expect(
      planLanguageChange({ next: 'en', deviceLocales: ARABIC_PHONE, layoutDirection: 'ltr' })
        .isRestartNeeded,
    ).toBe(false);
  });

  it('resolves "System" against the phone before deciding', () => {
    const plan = planLanguageChange({
      next: null,
      deviceLocales: ARABIC_PHONE,
      layoutDirection: 'rtl',
    });

    expect(plan).toMatchObject({ resolved: 'ar', isRestartNeeded: false });
    expect(plan.action).toStrictEqual({ type: 'set-language', language: null });
  });

  it('compares with the layout, not the text, after an earlier "Not now"', () => {
    // English chosen, Arabic still laid out (no restart yet): going back to Arabic needs none.
    expect(
      planLanguageChange({ next: 'ar', deviceLocales: ENGLISH_PHONE, layoutDirection: 'rtl' })
        .isRestartNeeded,
    ).toBe(false);
  });
});
