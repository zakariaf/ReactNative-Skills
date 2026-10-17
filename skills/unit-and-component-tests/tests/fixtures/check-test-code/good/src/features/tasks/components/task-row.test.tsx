// src/features/tasks/components/task-row.test.tsx
// no-providers: TaskRow is a pure view of its props and reads no store, service or catalog.
import { render, screen } from '@testing-library/react-native';

import { TaskRow } from './task-row';

describe('TaskRow', () => {
  it('marks a done task as checked', async () => {
    await render(<TaskRow title="Buy milk" isDone />);

    expect(screen.getByRole('checkbox', { name: 'Buy milk' })).toBeChecked();
  });
});
