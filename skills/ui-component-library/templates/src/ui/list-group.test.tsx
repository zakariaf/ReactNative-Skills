// src/ui/list-group.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { ListGroup } from './list-group';
import { ListRow } from './list-row';

describe('ListGroup', () => {
  it('derives the header and list ids from its own', async () => {
    await renderWithProviders(
      <ListGroup title="Reminders" testID="settings.reminders">
        <ListRow
          label="Default time"
          value="9:00"
          testID="settings.reminder-time-row"
          isReducedMotion
          isFirst
        />
      </ListGroup>,
    );

    expect(screen.getByTestId('settings.reminders.header')).toBeOnTheScreen();
    expect(screen.getByTestId('settings.reminders.list')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Reminders' })).toBeOnTheScreen();
  });
});
