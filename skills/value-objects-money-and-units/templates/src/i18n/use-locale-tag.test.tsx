// src/i18n/use-locale-tag.test.tsx
import { renderHookWithProviders } from '@test/render-with-providers';

import { useLocaleTag } from './use-locale-tag';

describe('useLocaleTag', () => {
  it('reads the tag of the provider', async () => {
    const { result } = await renderHookWithProviders(() => useLocaleTag());
    expect(result.current).toBe('en');
  });

  it('carries the digits of the language in the tag', async () => {
    const { result } = await renderHookWithProviders(() => useLocaleTag(), { language: 'ar' });
    expect(result.current).toBe('ar-u-nu-arab');
  });
});
