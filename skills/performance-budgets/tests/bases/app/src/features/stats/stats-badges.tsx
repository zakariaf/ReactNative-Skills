// src/features/stats/stats-badges.tsx
import { Canvas } from '@shopify/react-native-skia';
import { View } from 'react-native';

import type { JSX } from 'react';

const STREAK_DAYS = [1, 2, 3];

export function StatsBadges(): JSX.Element {
  return (
    <View>
      <Canvas style={{ width: 40, height: 40 }} />
      <Canvas style={{ width: 40, height: 40 }} />
      <Canvas style={{ width: 40, height: 40 }} />
      {STREAK_DAYS.map((day) => (
        <View key={day} />
      ))}
    </View>
  );
}
