// src/ui/feedback/confirm-dialog.android.test.tsx
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { ConfirmDialog } from './confirm-dialog';

import type { ConfirmRequest } from './confirm';

const CLEAR_DONE: ConfirmRequest = {
  title: 'Delete 3 done tasks?',
  body: 'They are removed for good.',
  confirmLabel: 'Delete tasks',
  cancelLabel: 'Cancel',
  tone: 'destructive',
  testID: 'tasks.clear-done-dialog',
};

describe('ConfirmDialog on Android', () => {
  it('is a Modal window that keeps TalkBack inside and answers dismissed on back', async () => {
    const onAnswer = jest.fn();
    await renderWithProviders(
      <ConfirmDialog
        testID="app.confirm"
        request={CLEAR_DONE}
        onAnswer={onAnswer}
        isReducedMotion
      />,
    );
    const scrim = screen.getByTestId('app.confirm');
    expect(screen.container.queryAll((node) => node.type === 'RNSFullWindowOverlay')).toHaveLength(
      0,
    );
    // The Modal's host view above the scrim carries onRequestClose (the back button and gesture).
    await fireEvent(scrim, 'requestClose');
    expect(onAnswer).toHaveBeenCalledWith('dismissed');
    expect(onAnswer).not.toHaveBeenCalledWith('confirmed');
  });
});
