// src/ui/icons/brand-tile.tsx
// The brand mark in its tile (About, onboarding, a sign-in header): one Skia canvas, the theme's
// colours, never mirrored, hidden from screen readers (the screen names the app in text).
import { Canvas, Group } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/use-theme';

import { BRAND_GRID, markOps } from './brand-mark-art';
import { markPaths } from './mark-paths';

import type { BrandMark } from './brand-mark-art';
import type { ReactNode } from 'react';

export type BrandTileProps = {
  readonly mark: BrandMark;
  /** Edge length in points. */
  readonly size: number;
  readonly testID?: string;
};

/** Tile geometry for every size: the corner radius and the share of the tile the mark fills. */
export const BRAND_TILE = { radiusRatio: 0.24, markScale: 0.8 } as const;

const styles = StyleSheet.create({ tile: { alignItems: 'center', justifyContent: 'center' } });

export function BrandTile({ mark, size, testID }: BrandTileProps): ReactNode {
  const theme = useTheme();
  const markSize = size * BRAND_TILE.markScale;
  const ops = markOps(mark, theme.colors);
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size * BRAND_TILE.radiusRatio,
          backgroundColor: theme.colors[mark.tile],
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(testID === undefined ? {} : { testID })}
    >
      <Canvas
        style={{ width: markSize, height: markSize }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Group transform={[{ scale: markSize / BRAND_GRID }]}>{markPaths(ops)}</Group>
      </Canvas>
    </View>
  );
}
