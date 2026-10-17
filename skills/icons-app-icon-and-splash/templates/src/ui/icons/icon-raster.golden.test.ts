// src/ui/icons/icon-raster.golden.test.ts
// Runs in the 'golden' Jest project (CanvasKit): the real rasterizer, every icon of the set.
import { ICON_PATHS } from './icon-paths';
import { getIconUri } from './icon-raster';

import type { IconName } from './icon-paths';

const names = Object.keys(ICON_PATHS) as IconName[];

describe('getIconUri', () => {
  it.each(names)('rasterizes %s to a PNG data URI and caches it', (name) => {
    const uri = getIconUri(name, 24, 3);

    expect(uri).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(getIconUri(name, 24, 3)).toBe(uri);
  });

  it('rasterizes a new pixel size separately', () => {
    expect(getIconUri('check', 24, 2)).not.toBe(getIconUri('check', 24, 3));
  });
});
