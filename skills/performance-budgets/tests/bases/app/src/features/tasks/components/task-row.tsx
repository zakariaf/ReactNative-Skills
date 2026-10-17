// src/features/tasks/components/task-row.tsx
import { View } from 'react-native';

import type { JSX } from 'react';

export function TaskRow({ title }: { readonly title: string }): JSX.Element {
  return <View accessibilityLabel={title} />;
}
