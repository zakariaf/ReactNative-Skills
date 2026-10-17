// src/theme/use-text-style.ts (fixture excerpt): the one file that sets writingDirection.
import { useTextLocale } from './use-text-locale';

import type { TextStyle } from 'react-native';

export const TEXT_ALIGN = { start: 'left', center: 'center', end: 'right' } as const;

export function useTextStyle(align: keyof typeof TEXT_ALIGN): TextStyle {
  const locale = useTextLocale();
  return { writingDirection: locale.direction, textAlign: TEXT_ALIGN[align] };
}
