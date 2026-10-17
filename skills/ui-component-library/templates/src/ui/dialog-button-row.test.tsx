// src/ui/dialog-button-row.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { Button } from './button';
import { DialogButtonRow } from './dialog-button-row';

describe('DialogButtonRow', () => {
  it('keeps the buttons in order and wraps them at large text', async () => {
    await renderWithProviders(
      <DialogButtonRow testID="discard-dialog.buttons">
        <Button
          label="Keep editing"
          onPress={jest.fn()}
          testID="discard-dialog.keep-button"
          isInRow
          isReducedMotion
        />
        <Button
          label="Discard"
          variant="danger"
          onPress={jest.fn()}
          testID="discard-dialog.discard-button"
          isInRow
          isReducedMotion
        />
      </DialogButtonRow>,
    );

    expect(screen.getByTestId('discard-dialog.buttons')).toHaveStyle({ flexWrap: 'wrap' });
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveAccessibleName('Keep editing');
    expect(second).toHaveAccessibleName('Discard');
  });
});
