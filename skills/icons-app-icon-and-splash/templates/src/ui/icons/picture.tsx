// src/ui/icons/picture.tsx
// A multi-colour picture (an empty state, an onboarding scene) drawn from layer data in ONE Skia
// canvas, in the theme's colours. Decorative: the screen says in text what the picture shows. At
// most a few per screen and never one per list item (each canvas costs memory and mount time).
import { Canvas, Group } from '@shopify/react-native-skia';

import { useTheme } from '@/theme/use-theme';

import { layerOps } from './brand-mark-art';
import { markPaths } from './mark-paths';

import type { BrandLayer } from './brand-mark-art';
import type { ReactNode } from 'react';

/** The picture's own coordinate box and its layers in draw order (colours are theme roles). */
export type PictureArt = {
  readonly viewBox: { readonly width: number; readonly height: number };
  readonly layers: readonly BrandLayer[];
};

export type PictureProps = {
  readonly art: PictureArt;
  /** Drawn width in points; the height follows the view box. */
  readonly width: number;
  readonly testID?: string;
};

export function Picture({ art, width, testID }: PictureProps): ReactNode {
  const theme = useTheme();
  const scale = width / art.viewBox.width;
  const ops = layerOps(art.layers, theme.colors);
  return (
    <Canvas
      style={{ width, height: art.viewBox.height * scale }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(testID === undefined ? {} : { testID })}
    >
      <Group transform={[{ scale }]}>{markPaths(ops)}</Group>
    </Canvas>
  );
}
