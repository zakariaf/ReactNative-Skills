// src/theme/use-theme.ts
import { use } from 'react';

import { ThemeContext } from './theme-context';

import type { Theme } from './theme-types';

export function useTheme(): Theme {
  return use(ThemeContext);
}
