// src/ui/feedback/feedback-provider.test.tsx
import { act, renderHook, screen, userEvent } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { createProvidersWrapper, renderWithProviders } from '@test/render-with-providers';

import { FeedbackProvider } from './feedback-provider';
import { useFeedback } from './use-feedback';

import type { ConfirmOutcome, ConfirmRequest } from './confirm';
import type { Feedback } from './feedback-context';
import type { ReactNode } from 'react';

const CLEAR_DONE: ConfirmRequest = {
  title: 'Delete 3 done tasks?',
  body: 'They are removed for good.',
  confirmLabel: 'Delete tasks',
  cancelLabel: 'Cancel',
  tone: 'destructive',
  testID: 'tasks.clear-done-dialog',
};

/** Renders the provider and hands back what useFeedback() returns inside it. */
async function renderFeedback(): Promise<{ feedback: Feedback; unmount: () => Promise<void> }> {
  const providers = createProvidersWrapper();
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode =>
    providers.wrapper({
      children: (
        <FeedbackProvider dismissLabel="Dismiss" bottomInset={0} isReducedMotion>
          {children}
        </FeedbackProvider>
      ),
    });
  const view = await renderHook(() => useFeedback(), { wrapper });
  return { feedback: view.result.current, unmount: view.unmount };
}

/** A component that needs the provider, rendered without it. */
function Probe(): ReactNode {
  useFeedback();
  return null;
}

describe('FeedbackProvider', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis')
      .mockImplementation((ms) => Promise.resolve(ms));
  });

  it('shows a notice and replaces it with the next one', async () => {
    const { feedback } = await renderFeedback();
    await act(() => {
      feedback.notify({ text: 'Task saved', testID: 'tasks.saved-notice' });
    });
    expect(screen.getByTestId('app.notice')).toBeOnTheScreen();
    expect(screen.getByTestId('tasks.saved-notice.text')).toHaveTextContent('Task saved');
    await act(() => {
      feedback.notify({ text: 'Task deleted', testID: 'tasks.deleted-notice' });
    });
    expect(screen.queryByTestId('tasks.saved-notice')).not.toBeOnTheScreen();
    expect(screen.getByTestId('tasks.deleted-notice.text')).toHaveTextContent('Task deleted');
  });

  it('resolves a question with the button the person pressed', async () => {
    const user = userEvent.setup();
    const { feedback } = await renderFeedback();
    let answer: Promise<ConfirmOutcome> = Promise.resolve('dismissed');
    await act(() => {
      answer = feedback.confirm(CLEAR_DONE);
    });
    expect(screen.getByTestId('app.confirm')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Delete tasks' }));
    await expect(answer).resolves.toBe('confirmed');
    expect(screen.queryByTestId('tasks.clear-done-dialog')).not.toBeOnTheScreen();
  });

  it('answers an open question dismissed when the provider goes away', async () => {
    const { feedback, unmount } = await renderFeedback();
    let answer: Promise<ConfirmOutcome> = Promise.resolve('confirmed');
    await act(() => {
      answer = feedback.confirm(CLEAR_DONE);
    });
    await unmount();
    await expect(answer).resolves.toBe('dismissed');
  });

  it('names the missing provider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderWithProviders(<Probe />)).rejects.toThrow(
      'useFeedback() needs a <FeedbackProvider> above it',
    );
  });
});
