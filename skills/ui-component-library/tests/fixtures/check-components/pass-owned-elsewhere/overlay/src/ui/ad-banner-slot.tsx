// src/ui/ad-banner-slot.tsx
// A stand-in for admob-ads-and-consent's AdBannerSlot: a ui file another skill owns (owned elsewhere or excluded by default).
import { View } from 'react-native';

import type { ReactNode } from 'react';

export function AdBannerSlot(props: { readonly children?: ReactNode }): ReactNode {
  return <View>{props.children}</View>;
}
