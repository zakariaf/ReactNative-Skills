// src/features/tasks/components/weekly-progress.tsx: a constant list keyed by its values, and a
// positional series (Array.from) whose place is its only identity.
import { View } from 'react-native';

import type { ReactNode } from 'react';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type WeeklyProgressProps = {
  readonly fillerCount: number;
  readonly testID: string;
};

export function WeeklyProgress({ fillerCount, testID }: WeeklyProgressProps): ReactNode {
  return (
    <View testID={testID}>
      {DAYS.map((day) => (
        <View key={day} testID={`${testID}.${day}`} />
      ))}
      {Array.from({ length: fillerCount }, (_, index) => (
        <View key={index} />
      ))}
    </View>
  );
}
