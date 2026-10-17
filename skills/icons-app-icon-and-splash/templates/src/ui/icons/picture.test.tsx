// src/ui/icons/picture.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { Picture } from './picture';

import type { PictureArt } from './picture';

const EMPTY_LIST: PictureArt = {
  viewBox: { width: 160, height: 120 },
  layers: [
    { d: 'M30 20h100v80H30z', fill: 'surface', stroke: 'border' },
    { d: 'M50 50h60M50 70h40', stroke: 'textMuted', width: 4 },
  ],
};

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

describe('Picture', () => {
  it('scales the view box to the width and hides itself from screen readers', async () => {
    await renderWithProviders(
      <Picture art={EMPTY_LIST} width={240} testID="tasks.empty-picture" />,
    );

    const canvas = screen.getByTestId('tasks.empty-picture', { includeHiddenElements: true });
    expect(canvas).toHaveStyle({ width: 240, height: 180 });
    expect(screen.queryByTestId('tasks.empty-picture')).toBeNull();
  });

  it('paints each layer in the theme colours of the current scheme', async () => {
    await renderWithProviders(
      <Picture art={EMPTY_LIST} width={160} testID="tasks.empty-picture" />,
    );

    const colors = elementsOf(screen.toJSON(), 'SkiaPath').map((node) => node.props['color']);
    expect(colors).toStrictEqual([
      PALETTE.light.surface,
      PALETTE.light.border,
      PALETTE.light.textMuted,
    ]);
  });
});
