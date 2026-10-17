// src/ui/ad-banner-slot.tsx
// The one banner slot: presentational (src/ui never imports services), so the screen passes
// renderBanner (AdsPort.renderBanner) and isAllowed (useBannerSlot) in. Zero height until an ad has
// loaded, so a failed or offline load leaves no empty box and no message.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/** The same shape as AdsPort's BannerSlotProps. */
export type BannerCallbacks = { readonly onLoaded: () => void; readonly onFailed: () => void };

export type AdBannerSlotProps = {
  /** AdsPort.renderBanner, from useBannerSlot. */
  readonly renderBanner: (callbacks: BannerCallbacks) => ReactNode;
  /** shouldShowBanner(config, context, screen), from useBannerSlot: never a hand-made flag. */
  readonly isAllowed: boolean;
  /** '<screen>.banner-ad', the screen named in contracts/ads.json "bannerSlots". */
  readonly testID: string;
  /**
   * The frame the slot takes once an ad has loaded (a band, a divider). The native banner must stay
   * mounted to load at all, so the frame is a style on this View, never a wrapper that renders
   * nothing until an ad is there.
   */
  readonly loadedStyle?: StyleProp<ViewStyle>;
};

/** Place it below the screen's content, above the bottom safe-area inset, never over controls. */
export function AdBannerSlot({
  renderBanner,
  isAllowed,
  testID,
  loadedStyle,
}: AdBannerSlotProps): ReactNode {
  const [isLoaded, setIsLoaded] = useState(false);
  if (!isAllowed) return null;
  return (
    <View style={isLoaded ? [styles.shown, loadedStyle] : styles.collapsed} testID={testID}>
      {renderBanner({
        onLoaded: () => {
          setIsLoaded(true);
        },
        onFailed: () => {
          setIsLoaded(false);
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shown: { alignItems: 'center' },
  collapsed: { height: 0, overflow: 'hidden' },
});
