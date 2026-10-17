// src/features/tasks/tasks-screen.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { TasksScreen } from './tasks-screen';

describe('TasksScreen', () => {
  it('renders nothing before tasks load', async () => {
    await renderWithProviders(<TasksScreen />);

    expect(screen.queryByRole('list')).not.toBeOnTheScreen();
  });
});
