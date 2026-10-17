// src/features/tasks/task-progress.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { TaskProgress } from './task-progress';

describe('TaskProgress', () => {
  it('keeps the progress fill left to right in an RTL locale', async () => {
    await renderWithProviders(<TaskProgress done={2} total={4} />, { language: 'ar' });

    // allow-style-assertion: the fill direction is the contract; it must not mirror in RTL.
    expect(screen.getByTestId('tasks.progress-fill')).toHaveStyle({ direction: 'ltr' });
  });
});
