// src/theme/make-styles.ts
import { useTheme } from './use-theme';

import type { Theme } from './theme-types';

/**
 * const useStyles = makeStyles((theme) => {
 *   const styles = StyleSheet.create({ card: { backgroundColor: theme.colors.surface } });
 *   return styles;
 * });
 * The factory calls StyleSheet.create itself and returns its result: that keeps React Native's
 * excess-property check (a typo fails tsc) and the lint rules that match StyleSheet.create
 * (no-unused-styles, no-color-literals, the start/end keys). Styles are built once per Theme object,
 * so their identity is stable across renders.
 */
export function makeStyles<TStyles extends object>(
  factory: (theme: Theme) => TStyles,
): () => TStyles {
  const cache = new WeakMap<Theme, TStyles>();
  return function useStyles(): TStyles {
    const theme = useTheme();
    const cached = cache.get(theme);
    if (cached !== undefined) return cached;
    const created = factory(theme);
    cache.set(theme, created);
    return created;
  };
}
