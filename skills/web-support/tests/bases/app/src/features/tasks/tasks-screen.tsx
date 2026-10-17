// src/features/tasks/tasks-screen.tsx
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, View } from 'react-native';

import { visibleCount } from './task-list';
import { AdSlot } from '@/ui/ad-slot';

export function TasksScreen(): React.JSX.Element {
  const [isBold, setIsBold] = useState(false);
  useEffect(() => {
    // react-native-web has no isBoldTextEnabled: the web keeps the default.
    if (Platform.OS === 'web') return;
    void AccessibilityInfo.isBoldTextEnabled().then(setIsBold);
  }, []);
  return (
    <View testID="tasks.list" accessibilityLabel={isBold ? 'bold' : 'regular'}>
      <AdSlot count={visibleCount({ start: 0, end: 3 })} />
    </View>
  );
}
