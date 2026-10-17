// src/ui/feedback/offline-banner.test.tsx
import { screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { systemA11yStore } from '@/ui/a11y/system-a11y-store';
import { renderWithProviders } from '@test/render-with-providers';

import { OfflineBanner } from './offline-banner';

import type { Reachability } from '@/services/connectivity/connectivity-port';

function banner(reachability: Reachability): React.JSX.Element {
  return (
    <OfflineBanner
      reachability={reachability}
      offlineText="You're offline."
      unvalidatedText="The internet may not be reachable."
      testID="tasks.offline-banner"
    />
  );
}

async function renderBanner(reachability: Reachability): Promise<void> {
  await renderWithProviders(banner(reachability));
}

describe('OfflineBanner', () => {
  beforeEach(() => {
    systemA11yStore.setState({ isScreenReaderOn: true, isReduceMotionOn: false });
  });

  it('stays away while the network is reachable', async () => {
    await renderBanner('reachable');
    expect(screen.queryByTestId('tasks.offline-banner')).not.toBeOnTheScreen();
  });

  it('says offline in a polite live region and announces the change once on iOS', async () => {
    const speak = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    const view = await renderWithProviders(banner('reachable'));
    await view.rerender(banner('none'));
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(screen.getByTestId('tasks.offline-banner.text')).toHaveTextContent("You're offline.");
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith("You're offline.", { queue: true });
  });

  it('does not announce a banner already up when the screen mounts', async () => {
    const speak = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    await renderBanner('none');
    expect(screen.getByTestId('tasks.offline-banner.text')).toHaveTextContent("You're offline.");
    expect(speak).not.toHaveBeenCalled();
  });

  it('warns only on a network the OS has not validated', async () => {
    await renderBanner('unvalidated');
    expect(screen.getByTestId('tasks.offline-banner.text')).toHaveTextContent(
      'The internet may not be reachable.',
    );
  });
});
