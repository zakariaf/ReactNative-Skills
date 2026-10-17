// src/ui/variant-paint.ts
import type { TextTone } from './app-text';
import type { Theme } from '@/theme/theme-types';

/** primary = the one main action; secondary = everything else; danger = destructive. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export type VariantPaint = {
  readonly fill: string;
  /** Icons and busy blocks on the face. */
  readonly content: string;
  readonly edge: string;
  /** AppText tone of the label. */
  readonly tone: TextTone;
};

const DISABLED = (theme: Theme): VariantPaint => ({
  fill: theme.colors.sunken,
  content: theme.colors.textMuted,
  edge: theme.colors.border,
  tone: 'muted',
});

/**
 * Face paint per variant, from semantic roles only. A destructive button keeps the surface and
 * paints its label and edge danger, never a filled red face: the label pair (danger on surface) is
 * one the contrast contract already judges, and the shape (the edge) still says "destructive".
 */
export function variantPaint(
  theme: Theme,
  variant: ButtonVariant,
  isDisabled: boolean,
): VariantPaint {
  const { colors } = theme;
  if (isDisabled) return DISABLED(theme);
  switch (variant) {
    case 'primary':
      return {
        fill: colors.primary,
        content: colors.onPrimary,
        edge: colors.primary,
        tone: 'onPrimary',
      };
    case 'secondary':
      return { fill: colors.surface, content: colors.text, edge: colors.border, tone: 'default' };
    case 'danger':
      return { fill: colors.surface, content: colors.danger, edge: colors.danger, tone: 'danger' };
  }
}
