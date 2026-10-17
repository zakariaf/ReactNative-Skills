// src/features/tasks/components/tasks-footer.tsx: insets keep their physical side.
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ReactNode } from 'react';

export function TasksFooter(): ReactNode {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="tasks.footer"
      style={{ paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom }}
    />
  );
}
