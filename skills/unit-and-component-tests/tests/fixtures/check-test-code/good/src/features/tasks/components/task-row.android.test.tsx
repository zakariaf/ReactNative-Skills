// src/features/tasks/components/task-row.android.test.tsx
// no-providers: TaskRow is a pure view of its props and reads no store, service or catalog.
import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { TaskRow } from './task-row';

describe('TaskRow on Android', () => {
  it('uses the Android ripple row', async () => {
    await render(<TaskRow title="Buy milk" isDone={false} />);

    expect(Platform.OS).toBe('android');
    expect(screen.getByTestId('tasks.row-ripple')).toBeOnTheScreen();
  });
});
