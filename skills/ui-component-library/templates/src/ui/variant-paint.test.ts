// src/ui/variant-paint.test.ts
import { APP_THEMES } from '@/theme/theme-context';
import { selectTheme } from '@/theme/theme-set';

import { variantPaint } from './variant-paint';

const LIGHT = selectTheme(APP_THEMES, { scheme: 'light', mode: 'standard' });
const DARK = selectTheme(APP_THEMES, { scheme: 'dark', mode: 'standard' });

describe('variantPaint', () => {
  it('fills the primary button with the primary role and its on-colour', () => {
    expect(variantPaint(LIGHT, 'primary', false)).toStrictEqual({
      fill: LIGHT.colors.primary,
      content: LIGHT.colors.onPrimary,
      edge: LIGHT.colors.primary,
      tone: 'onPrimary',
    });
  });

  it('keeps a destructive button on the surface with a danger label and edge', () => {
    const paint = variantPaint(DARK, 'danger', false);

    expect(paint.fill).toBe(DARK.colors.surface);
    expect(paint.edge).toBe(DARK.colors.danger);
    expect(paint.tone).toBe('danger');
  });

  it('mutes every variant the same way when disabled', () => {
    const disabled = variantPaint(LIGHT, 'secondary', true);

    expect(variantPaint(LIGHT, 'primary', true)).toStrictEqual(disabled);
    expect(variantPaint(LIGHT, 'danger', true)).toStrictEqual(disabled);
    expect(disabled.tone).toBe('muted');
  });
});
