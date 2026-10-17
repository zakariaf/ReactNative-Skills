// src/features/tasks/task-feed-counter.test.tsx
import { act, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { TaskFeedCounter } from './task-feed-counter';
import { createTaskFeed } from './task-feed';

describe('TaskFeedCounter', () => {
  it('stops counting once the feed subscription is gone', async () => {
    const feed = createTaskFeed();
    const sub = feed.subscribe();
    const view = await renderWithProviders(<TaskFeedCounter feed={feed} />);

    // unmount() on a subscription is not an RNTL call; only render results are awaited.
    sub.unmount();
    await act(() => {
      feed.makeSub().unmount();
      feed.publish({ id: 'task-1', title: 'Buy milk' });
    });
    await view.rerender(<TaskFeedCounter feed={feed} />);

    expect(screen.getByText('1 task')).toBeOnTheScreen();
    await view.unmount();
  });
});
