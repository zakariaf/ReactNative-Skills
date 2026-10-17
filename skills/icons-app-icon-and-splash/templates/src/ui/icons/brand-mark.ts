// src/ui/icons/brand-mark.ts
// The app's mark (a Tasks demo: a card with a check and two lines). It is the one drawing behind the
// in-app BrandTile, the app icon in every appearance, the Android adaptive and themed icons, the
// splash and the store icon. Replace the layers with your own; colours are theme roles.
import type { BrandMark } from './brand-mark-art';

export const BRAND_MARK: BrandMark = {
  tile: 'primary',
  layers: [
    {
      d: 'M12 4h24a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V10a6 6 0 0 1 6-6z',
      fill: 'surface',
      stroke: 'text',
    },
    { d: 'M14 19l6 6 13-13', stroke: 'primary', width: 5 },
    { d: 'M14 32h20M14 38h12', stroke: 'textMuted', width: 3 },
  ],
};
