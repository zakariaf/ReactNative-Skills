// src/ui/feedback/above-modal-screens.test.tsx
import { screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { AboveModalScreens } from './above-modal-screens';

describe('AboveModalScreens on iOS', () => {
  it('holds its children in an overlay window that does not trap VoiceOver', async () => {
    await renderWithProviders(
      <AboveModalScreens>
        <View testID="app.notice" />
      </AboveModalScreens>,
    );
    const overlays = screen.container.queryAll((node) => node.type === 'RNSFullWindowOverlay');
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toHaveProp('accessibilityContainerViewIsModal', false);
    expect(screen.getByTestId('app.notice').parent).toBe(overlays[0]);
  });
});
