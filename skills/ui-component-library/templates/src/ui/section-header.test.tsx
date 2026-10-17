// src/ui/section-header.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { SectionHeader } from './section-header';

describe('SectionHeader', () => {
  it('is one header element that carries the testID on its measured box', async () => {
    await renderWithProviders(
      <SectionHeader title="Reminders" testID="settings.reminders.header" />,
    );

    const header = screen.getByRole('header', { name: 'Reminders' });
    expect(header).toHaveProp('testID', 'settings.reminders.header');
  });
});
