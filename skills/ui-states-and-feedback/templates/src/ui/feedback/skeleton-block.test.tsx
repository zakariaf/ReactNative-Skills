// src/ui/feedback/skeleton-block.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { SkeletonBlock } from './skeleton-block';

describe('SkeletonBlock', () => {
  it('draws a still block of the given size that screen readers skip', async () => {
    await renderWithProviders(<SkeletonBlock width="70%" height={20} testID="tasks.skeleton" />);
    const block = screen.getByTestId('tasks.skeleton', { includeHiddenElements: true });
    expect(block).toHaveStyle({ width: '70%', height: 20 });
    expect(block).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(block).toHaveProp('accessibilityElementsHidden', true);
  });
});
