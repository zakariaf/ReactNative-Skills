// src/ui/ad-slot.native.tsx
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

export function AdSlot(props: { readonly count: number }): React.JSX.Element | null {
  return props.count > 0 ? <BannerAd unitId={TestIds.BANNER} size={BannerAdSize.BANNER} /> : null;
}
