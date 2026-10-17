// src/features/tasks/tasks-screen.tsx
// The banner slot at the bottom of a pure view (a shape): its model comes from useBannerSlot in the
// model hook, its testID is the one contracts/ads.json names, and it sits below the list, above the
// bottom safe-area inset, never over a control.
import { StyleSheet, View } from 'react-native';

import { AdBannerSlot } from '@/ui/ad-banner-slot';

import type { BannerSlotModel } from '@/hooks/use-banner-slot';
import type { ReactNode } from 'react';

export type TasksScreenProps = { readonly banner: BannerSlotModel; readonly list: ReactNode };

export function TasksScreen({ banner, list }: TasksScreenProps): ReactNode {
  return (
    <View style={styles.screen}>
      {list}
      <AdBannerSlot
        testID="tasks.banner-ad"
        renderBanner={banner.renderBanner}
        isAllowed={banner.isAllowed}
      />
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
