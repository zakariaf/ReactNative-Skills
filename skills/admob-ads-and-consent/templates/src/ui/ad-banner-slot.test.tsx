// src/ui/ad-banner-slot.test.tsx — the slot is collapsed until an ad loads, takes its frame only
// then, and collapses again after a failed load, without a message.
import { act, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { AdBannerSlot } from './ad-banner-slot';

import type { BannerCallbacks } from './ad-banner-slot';
import type { ReactNode } from 'react';

function captureCallbacks(): {
  readonly renderBanner: (callbacks: BannerCallbacks) => ReactNode;
  readonly latest: () => BannerCallbacks;
} {
  const seen: BannerCallbacks[] = [];
  return {
    renderBanner: (callbacks) => {
      seen.push(callbacks);
      return <View testID="fake.banner" />;
    },
    latest: () => {
      const last = seen.at(-1);
      if (last === undefined) throw new Error('the banner was never rendered');
      return last;
    },
  };
}

describe('AdBannerSlot', () => {
  it('renders nothing when the policy forbids a banner', async () => {
    const banner = captureCallbacks();
    await renderWithProviders(
      <AdBannerSlot
        renderBanner={banner.renderBanner}
        isAllowed={false}
        testID="tasks.banner-ad"
      />,
    );
    expect(screen.queryByTestId('tasks.banner-ad')).toBeNull();
  });

  it('stays collapsed until the banner has loaded', async () => {
    const banner = captureCallbacks();
    await renderWithProviders(
      <AdBannerSlot renderBanner={banner.renderBanner} isAllowed testID="tasks.banner-ad" />,
    );
    expect(screen.getByTestId('tasks.banner-ad')).toHaveStyle({ height: 0 });
    await act(() => {
      banner.latest().onLoaded();
    });
    expect(screen.getByTestId('tasks.banner-ad')).not.toHaveStyle({ height: 0 });
  });

  it('takes the loaded frame only once an ad has loaded', async () => {
    const banner = captureCallbacks();
    const band = { paddingBlock: 6, borderTopWidth: 2 };
    await renderWithProviders(
      <AdBannerSlot
        renderBanner={banner.renderBanner}
        isAllowed
        testID="lists.banner-ad"
        loadedStyle={band}
      />,
    );
    expect(screen.getByTestId('lists.banner-ad')).not.toHaveStyle(band);
    await act(() => {
      banner.latest().onLoaded();
    });
    expect(screen.getByTestId('lists.banner-ad')).toHaveStyle(band);
    expect(screen.getByTestId('fake.banner')).toBeOnTheScreen();
  });

  it('collapses again after a failed load, without any message', async () => {
    const banner = captureCallbacks();
    await renderWithProviders(
      <AdBannerSlot renderBanner={banner.renderBanner} isAllowed testID="notes.banner-ad" />,
    );
    await act(() => {
      banner.latest().onLoaded();
    });
    await act(() => {
      banner.latest().onFailed();
    });
    expect(screen.getByTestId('notes.banner-ad')).toHaveStyle({ height: 0 });
  });
});
