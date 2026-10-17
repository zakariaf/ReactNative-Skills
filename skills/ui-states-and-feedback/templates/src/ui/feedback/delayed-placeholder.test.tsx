// src/ui/feedback/delayed-placeholder.test.tsx
import { act, screen } from '@testing-library/react-native';

import { AppText } from '@/ui/app-text';
import { renderWithProviders } from '@test/render-with-providers';

import { DelayedPlaceholder } from './delayed-placeholder';
import { SkeletonBlock } from './skeleton-block';

function Gate({ isLoading }: { readonly isLoading: boolean }): React.JSX.Element {
  return (
    <DelayedPlaceholder
      isLoading={isLoading}
      placeholder={<SkeletonBlock width="70%" height={20} />}
      label="Loading tasks"
      testID="tasks.state.loading"
    >
      <AppText testID="tasks.list">Buy milk</AppText>
    </DelayedPlaceholder>
  );
}

describe('DelayedPlaceholder', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays blank during a fast load and then shows the content', async () => {
    const view = await renderWithProviders(<Gate isLoading />);
    expect(screen.getByTestId('tasks.state.loading.pending')).toBeOnTheScreen();
    expect(screen.queryByTestId('tasks.state.loading')).not.toBeOnTheScreen();
    await view.rerender(<Gate isLoading={false} />);
    expect(screen.getByTestId('tasks.list')).toBeOnTheScreen();
  });

  it('shows a labelled, busy placeholder for a slow load and holds it before the content', async () => {
    const view = await renderWithProviders(<Gate isLoading />);
    await act(() => {
      jest.advanceTimersByTime(300);
    });
    const placeholder = screen.getByRole('progressbar', { name: 'Loading tasks' });
    expect(placeholder).toHaveProp('accessibilityState', { busy: true });
    await view.rerender(<Gate isLoading={false} />);
    expect(screen.queryByTestId('tasks.list')).not.toBeOnTheScreen();
    await act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('tasks.list')).toBeOnTheScreen();
  });
});
