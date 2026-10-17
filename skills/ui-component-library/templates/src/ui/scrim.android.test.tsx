// src/ui/scrim.android.test.tsx
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { AppText } from './app-text';
import { Scrim } from './scrim';

describe('Scrim', () => {
  it('closes on Android back through the modal request', async () => {
    const onRequestClose = jest.fn();
    await renderWithProviders(
      <Scrim
        testID="delete-task-dialog.scrim"
        isVisible
        onRequestClose={onRequestClose}
        isReducedMotion={false}
      >
        <AppText>Delete this task?</AppText>
      </Scrim>,
    );

    // The Android back button and back gesture reach the Modal as its request to close.
    await fireEvent(screen.getByTestId('delete-task-dialog.scrim'), 'requestClose');

    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });
});
