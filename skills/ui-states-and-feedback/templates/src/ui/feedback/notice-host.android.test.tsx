// src/ui/feedback/notice-host.android.test.tsx
import { screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { systemA11yStore } from '@/ui/a11y/system-a11y-store';
import { renderWithProviders } from '@test/render-with-providers';

import { NoticeHost } from './notice-host';

describe('NoticeHost on Android', () => {
  it('leaves the reading to the live region instead of announcing twice', async () => {
    systemA11yStore.setState({ isScreenReaderOn: true });
    const speak = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockResolvedValue(4000);
    await renderWithProviders(
      <NoticeHost
        testID="app.notice"
        notice={{ text: 'Task saved', testID: 'tasks.saved-notice', serial: 1 }}
        onClose={jest.fn()}
        dismissLabel="Dismiss"
        bottomInset={0}
        isReducedMotion
      />,
    );
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(speak).not.toHaveBeenCalled();
  });

  it('renders the dock in place: Android shows modal screens in the same hierarchy', async () => {
    const warn = jest.spyOn(console, 'warn');
    jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockResolvedValue(4000);
    await renderWithProviders(
      <NoticeHost
        testID="app.notice"
        notice={{ text: 'Task saved', testID: 'tasks.saved-notice', serial: 1 }}
        onClose={jest.fn()}
        dismissLabel="Dismiss"
        bottomInset={0}
        isReducedMotion
      />,
    );
    expect(screen.getByTestId('app.notice')).toBeOnTheScreen();
    expect(screen.container.queryAll((node) => node.type === 'RNSFullWindowOverlay')).toHaveLength(
      0,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
