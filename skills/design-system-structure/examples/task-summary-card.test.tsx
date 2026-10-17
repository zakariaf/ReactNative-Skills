// src/features/tasks/components/task-summary-card.test.tsx
// Example test: roles, the header, the press, and the dark theme through the real provider.
import { render, screen, userEvent } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { AppThemeProvider } from '@/theme/theme-provider';

import { TaskSummaryCard } from './task-summary-card';

const PROPS = {
  title: 'Due today',
  count: '4',
  countLabel: 'tasks left',
  actionLabel: 'Review tasks',
  isReducedMotion: false,
  testID: 'tasks.summary-card',
} as const;

describe('TaskSummaryCard', () => {
  it('shows the title as a header, the count, and one named action', async () => {
    const onAction = jest.fn();
    const user = userEvent.setup();
    await render(<TaskSummaryCard {...PROPS} onAction={onAction} />);

    expect(screen.getByRole('header', { name: 'Due today' })).toBeOnTheScreen();
    expect(screen.getByText('4')).toHaveStyle({ fontVariant: ['tabular-nums'] });
    await user.press(screen.getByRole('button', { name: 'Review tasks' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('paints its surface from the dark palette under a dark preference', async () => {
    await render(
      <AppThemeProvider preference="dark">
        <TaskSummaryCard {...PROPS} onAction={jest.fn()} />
      </AppThemeProvider>,
    );

    expect(screen.getByTestId('tasks.summary-card')).toHaveStyle({
      backgroundColor: PALETTE.dark.surface,
    });
  });
});
