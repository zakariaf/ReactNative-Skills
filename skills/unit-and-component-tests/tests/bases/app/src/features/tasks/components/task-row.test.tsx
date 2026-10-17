// src/features/tasks/components/task-row.test.tsx
// no-providers: TaskRow is a pure view of its props and reads no store, service or catalog.
import { render, screen } from '@testing-library/react-native';

import { TaskRow } from './task-row';

describe('TaskRow', () => {
  it('names the row after the task', async () => {
    await render(<TaskRow title="Buy milk" />);

    expect(screen.getByRole('checkbox', { name: 'Buy milk' })).toBeOnTheScreen();
  });
});
