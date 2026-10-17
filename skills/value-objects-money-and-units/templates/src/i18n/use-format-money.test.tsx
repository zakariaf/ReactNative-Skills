// src/i18n/use-format-money.test.tsx
import { money } from '@/core/money/money';
import { renderHookWithProviders } from '@test/render-with-providers';

import { useFormatMoney } from './use-format-money';

describe('useFormatMoney', () => {
  it('formats with the locale tag of the provider', async () => {
    const { result } = await renderHookWithProviders(() => useFormatMoney());
    expect(result.current(money(1999, 'USD'))).toBe('$19.99');
    expect(result.current(money(199, 'EUR'), { display: 'code' })).toBe('EUR 1.99');
  });

  it('follows the language and its digits', async () => {
    const { result } = await renderHookWithProviders(() => useFormatMoney(), {
      language: 'ar',
    });
    expect(result.current(money(1999, 'USD'))).toBe('‏١٩٫٩٩ US$');
  });
});
