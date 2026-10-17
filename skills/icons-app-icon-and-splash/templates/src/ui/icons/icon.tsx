// src/ui/icons/icon.tsx
// The one way to show an icon: a native Image of the rasterized path, tinted from the theme. Raw
// Image is allowed only in this file (the lint config), and only here may an icon flip in RTL.
import { Image, PixelRatio, StyleSheet } from 'react-native';

import { useDirection } from '@/i18n/direction-context';

import { DIRECTIONAL_ICONS } from './icon-paths';
import { getIconUri } from './icon-raster';

import type { IconName } from './icon-paths';
import type { ReactNode } from 'react';

export type IconProps = {
  readonly name: IconName;
  /** A theme colour (theme.colors.text, onPrimary, danger ...), never a literal. */
  readonly color: string;
  readonly size?: number;
  readonly testID?: string;
};

const DEFAULT_SIZE = 24;
const styles = StyleSheet.create({ flipped: { transform: [{ scaleX: -1 }] } });

/** Decorative: the button or row around an icon carries the accessibility label. */
export function Icon({ name, color, size = DEFAULT_SIZE, testID }: IconProps): ReactNode {
  const direction = useDirection();
  const isFlipped = direction === 'rtl' && DIRECTIONAL_ICONS.has(name);
  return (
    <Image
      source={{ uri: getIconUri(name, size, PixelRatio.get()), width: size, height: size }}
      tintColor={color}
      style={[{ width: size, height: size }, isFlipped && styles.flipped]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      {...(testID === undefined ? {} : { testID })}
    />
  );
}
