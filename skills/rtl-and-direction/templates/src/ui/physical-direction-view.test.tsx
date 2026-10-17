// src/ui/physical-direction-view.test.tsx
// allow-style-assertion: the direction style is the contract that keeps a physical surface LTR.
import { screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { PhysicalDirectionView } from './physical-direction-view';

describe('PhysicalDirectionView', () => {
  it('lays its subtree out left to right whatever the layout direction', async () => {
    await renderWithProviders(
      <PhysicalDirectionView testID="tasks.map">
        <View />
      </PhysicalDirectionView>,
    );

    expect(screen.getByTestId('tasks.map')).toHaveStyle({ direction: 'ltr' });
  });

  it('lets content that reads in the language direction mirror with the screen', async () => {
    await renderWithProviders(
      <PhysicalDirectionView mirrorsInRtl testID="tasks.week-strip">
        <View />
      </PhysicalDirectionView>,
    );

    expect(screen.getByTestId('tasks.week-strip')).not.toHaveStyle({ direction: 'ltr' });
  });
});
