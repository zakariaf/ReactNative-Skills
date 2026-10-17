// src/features/tasks/components/task-tags.tsx: data keyed by its own value, never its position.
import { View } from 'react-native';

import { AppText } from '@/ui/app-text';

import type { ReactNode } from 'react';

export type TaskTagsProps = {
  readonly tags: readonly string[];
  readonly testID: string;
};

export function TaskTags({ tags, testID }: TaskTagsProps): ReactNode {
  return (
    <View testID={testID}>
      {tags.map((tag) => (
        <AppText key={tag} testID={`${testID}.${tag}`}>
          {tag}
        </AppText>
      ))}
    </View>
  );
}
