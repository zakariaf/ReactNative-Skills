// src/ui/list.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { List } from './list';
import { ListRow } from './list-row';

describe('List', () => {
  it('holds its rows and clips them to its corners', async () => {
    await renderWithProviders(
      <List testID="settings.general.list">
        <ListRow label="Language" testID="settings.language-row" isReducedMotion isFirst />
        <ListRow label="Version" testID="settings.version-row" isReducedMotion />
      </List>,
    );

    expect(screen.getByTestId('settings.general.list')).toHaveStyle({ overflow: 'hidden' });
    expect(screen.getByText('Language')).toBeOnTheScreen();
    expect(screen.getByText('Version')).toBeOnTheScreen();
  });
});
