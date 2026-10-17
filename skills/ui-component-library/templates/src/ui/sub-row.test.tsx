// src/ui/sub-row.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { Slider } from './slider';
import { SubRow } from './sub-row';

describe('SubRow', () => {
  it('labels the control it refines, indented under its row', async () => {
    await renderWithProviders(
      <SubRow label="Volume" testID="settings.volume-row">
        <Slider
          value={0.5}
          onChange={jest.fn()}
          label="Reminder volume"
          testID="settings.volume-slider"
        />
      </SubRow>,
    );

    expect(screen.getByTestId('settings.volume-row.label')).toHaveTextContent('Volume');
    expect(screen.getByRole('adjustable', { name: 'Reminder volume' })).toBeOnTheScreen();
  });
});
