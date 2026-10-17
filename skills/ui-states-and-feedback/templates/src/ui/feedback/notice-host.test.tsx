// src/ui/feedback/notice-host.test.tsx
import { act, screen, userEvent } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { systemA11yStore } from '@/ui/a11y/system-a11y-store';
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { flushMicrotasks } from '@test/flush-microtasks';
import { renderWithProviders } from '@test/render-with-providers';

import { NoticeHost } from './notice-host';

import type { Notice } from './notice';

const SAVED: Notice = { text: 'Task saved', testID: 'tasks.saved-notice', serial: 1 };

function deleted(onUndo: () => void): Notice {
  return {
    text: 'Task deleted',
    testID: 'tasks.deleted-notice',
    action: { label: 'Undo', onPress: onUndo },
    serial: 2,
  };
}

async function showHost(notice: Notice | null, onClose = jest.fn()): Promise<jest.Mock> {
  await renderWithProviders(
    <NoticeHost
      testID="app.notice"
      notice={notice}
      onClose={onClose}
      dismissLabel="Dismiss"
      bottomInset={0}
      isReducedMotion
    />,
  );
  return onClose;
}

describe('NoticeHost', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    jest
      .spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis')
      .mockImplementation((ms) => Promise.resolve(ms));
    systemA11yStore.setState({ isScreenReaderOn: false, isReduceMotionOn: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing without a notice', async () => {
    await showHost(null);
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  it('shows the notice as a polite alert and closes it after its lifetime', async () => {
    const onClose = await showHost(SAVED);
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLiveRegion', 'polite');
    await flushMicrotasks();
    await act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledWith(1);
  });

  it('holds the dock in an overlay window above modal screens on iOS, not an accessibility modal', async () => {
    await showHost(SAVED);
    const overlays = screen.container.queryAll((node) => node.type === 'RNSFullWindowOverlay');
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toHaveProp('accessibilityContainerViewIsModal', false);
    expect(screen.getByTestId('app.notice').parent).toBe(overlays[0]);
  });

  it('opens a new overlay window for a replacement notice, so it shows above a modal opened since', async () => {
    const overlay = (): unknown =>
      screen.container.queryAll((node) => node.type === 'RNSFullWindowOverlay')[0];
    const host = (notice: Notice): React.JSX.Element => (
      <NoticeHost
        testID="app.notice"
        notice={notice}
        onClose={jest.fn()}
        dismissLabel="Dismiss"
        bottomInset={0}
        isReducedMotion
      />
    );
    const view = await renderWithProviders(host(SAVED));
    const first = overlay();
    await view.rerender(host(deleted(jest.fn())));
    expect(screen.getByText('Task deleted')).toBeOnTheScreen();
    expect(overlay()).toBeDefined();
    expect(overlay()).not.toBe(first);
  });

  it('announces the notice once on iOS, where live regions are not read', async () => {
    systemA11yStore.setState({ isScreenReaderOn: true });
    const speak = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    await showHost(SAVED);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('Task saved', { queue: true });
  });

  it('runs the action, then closes the notice', async () => {
    jest.useRealTimers();
    const onUndo = jest.fn();
    const user = userEvent.setup();
    const onClose = await showHost(deleted(onUndo));
    await user.press(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(2);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('keeps a notice with an action up while a screen reader runs, with a Dismiss button', async () => {
    systemA11yStore.setState({ isScreenReaderOn: true });
    const onClose = await showHost(deleted(jest.fn()));
    await flushMicrotasks();
    await act(() => {
      jest.advanceTimersByTime(60000);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeOnTheScreen();
  });
});
