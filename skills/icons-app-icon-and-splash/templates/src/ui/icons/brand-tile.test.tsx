// src/ui/icons/brand-tile.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { BRAND_MARK } from './brand-mark';
import { BRAND_TILE, BrandTile } from './brand-tile';

type JsonNode = {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: readonly (JsonNode | string)[] | null;
};

/** Every element of a type in the rendered tree (the Skia mock renders host elements like SkiaPath). */
function elementsOf(tree: unknown, type: string): JsonNode[] {
  if (tree === null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((item) => elementsOf(item, type));
  const node = tree as JsonNode;
  const below = (node.children ?? []).flatMap((child) => elementsOf(child, type));
  return node.type === type ? [node, ...below] : below;
}

describe('BrandTile', () => {
  it('paints the tile in the colour role of the mark at the size asked for, hidden from screen readers', async () => {
    await renderWithProviders(<BrandTile mark={BRAND_MARK} size={92} testID="about.brand" />);

    const tile = screen.getByTestId('about.brand', { includeHiddenElements: true });
    expect(tile).toHaveStyle({
      width: 92,
      height: 92,
      borderRadius: 92 * BRAND_TILE.radiusRatio,
      backgroundColor: PALETTE.light[BRAND_MARK.tile],
    });
    expect(screen.queryByTestId('about.brand')).toBeNull();
  });

  it('draws every paint operation of the mark inside one canvas', async () => {
    await renderWithProviders(<BrandTile mark={BRAND_MARK} size={46} testID="home.brand" />);

    const paths = elementsOf(screen.toJSON(), 'SkiaPath');
    expect(paths.length).toBeGreaterThanOrEqual(BRAND_MARK.layers.length);
  });
});
