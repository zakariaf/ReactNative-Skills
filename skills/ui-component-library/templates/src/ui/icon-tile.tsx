// src/ui/icon-tile.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { useTheme } from '@/theme/use-theme';

import { COMPONENT_SPECS } from './component-specs';

import type { IconSlot } from './icon-slot';
import type { Theme } from '@/theme/theme-types';
import type { ReactNode } from 'react';

const TILE = COMPONENT_SPECS.iconTile;

export type IconTilePaint = 'neutral' | 'primary' | 'danger';

export type IconTileProps = {
  readonly icon: IconSlot;
  /** Default 'neutral'. */
  readonly paint?: IconTilePaint;
  /** 'large' leads a dialog or an empty state. Default 'regular' (rows and cards). */
  readonly size?: 'regular' | 'large';
  /** A part id, usually `<owner>.icon`. */
  readonly testID?: string;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    tile: { alignItems: 'center', justifyContent: 'center' },
    regular: { width: TILE.size, height: TILE.size, borderRadius: TILE.radius },
    large: { width: TILE.sizeLarge, height: TILE.sizeLarge, borderRadius: TILE.radiusLarge },
  });
  return styles;
});

function paintOf(
  theme: Theme,
  paint: IconTilePaint,
): { readonly fill: string; readonly ink: string } {
  const { colors } = theme;
  if (paint === 'primary') return { fill: colors.primary, ink: colors.onPrimary };
  if (paint === 'danger') return { fill: colors.dangerSurface, ink: colors.danger };
  return { fill: colors.sunken, ink: colors.text };
}

/** An icon on a tinted square. Decorative: the row or card it leads carries the name. */
export function IconTile({
  icon,
  paint = 'neutral',
  size = 'regular',
  testID,
}: IconTileProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const colors = paintOf(theme, paint);
  return (
    <View
      style={[
        styles.tile,
        size === 'large' ? styles.large : styles.regular,
        { backgroundColor: colors.fill },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(testID === undefined ? {} : { testID })}
    >
      {icon({ size: size === 'large' ? TILE.iconLarge : TILE.icon, color: colors.ink })}
    </View>
  );
}
