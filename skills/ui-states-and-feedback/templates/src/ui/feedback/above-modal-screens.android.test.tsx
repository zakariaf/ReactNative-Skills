// src/ui/feedback/above-modal-screens.android.test.tsx
import { screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { AboveModalScreens } from './above-modal-screens';

describe('AboveModalScreens on Android', () => {
  it('renders its children in place, without the iOS-only overlay', async () => {
    const warn = jest.spyOn(console, 'warn');
    await renderWithProviders(
      <AboveModalScreens>
        <View testID="app.notice" />
      </AboveModalScreens>,
    );
    expect(screen.getByTestId('app.notice')).toBeOnTheScreen();
    expect(screen.container.queryAll((node) => node.type === 'RNSFullWindowOverlay')).toHaveLength(
      0,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
