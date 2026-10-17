// src/ui/scrim.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { AppText } from './app-text';
import { Scrim } from './scrim';

describe('Scrim', () => {
  it('is the modal root, dimming the screen behind its dialog', async () => {
    await renderWithProviders(
      <Scrim testID="delete-task-dialog.scrim" isVisible onRequestClose={jest.fn()} isReducedMotion>
        <AppText>Delete this task?</AppText>
      </Scrim>,
    );

    const scrim = screen.getByTestId('delete-task-dialog.scrim');
    expect(scrim).toHaveProp('accessibilityViewIsModal', true);
    expect(scrim).toHaveStyle({ backgroundColor: PALETTE.light.scrim });
    expect(screen.getByText('Delete this task?')).toBeOnTheScreen();
  });

  it('renders nothing while hidden', async () => {
    await renderWithProviders(
      <Scrim
        testID="delete-task-dialog.scrim"
        isVisible={false}
        onRequestClose={jest.fn()}
        isReducedMotion
      >
        <AppText>Delete this task?</AppText>
      </Scrim>,
    );

    expect(screen.queryByTestId('delete-task-dialog.scrim')).not.toBeOnTheScreen();
  });
});
