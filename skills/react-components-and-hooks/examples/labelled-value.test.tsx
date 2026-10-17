// Example (shape only, never copied into the app): the test of labelled-value.tsx.
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { LabelledValue } from './labelled-value';

describe('LabelledValue', () => {
  it('derives the part testIDs from its one testID', async () => {
    await renderWithProviders(
      <LabelledValue label="Done this week" value="12" testID="stats.weekly-card.done" />,
    );
    expect(screen.getByTestId('stats.weekly-card.done.value')).toHaveTextContent('12');
    expect(screen.getByTestId('stats.weekly-card.done.label')).toHaveTextContent('Done this week');
  });

  it('renders the accessory slot after the value', async () => {
    await renderWithProviders(
      <LabelledValue
        label="Longest streak"
        value="9"
        testID="stats.streak"
        accessory={<LabelledValue label="New" value="!" testID="stats.streak.badge" />}
      />,
    );
    expect(screen.getByTestId('stats.streak.badge')).toBeOnTheScreen();
  });
});
