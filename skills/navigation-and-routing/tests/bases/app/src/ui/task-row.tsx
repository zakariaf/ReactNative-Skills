// src/ui/task-row.tsx: presentational; the screen passes onPress.
import { Pressable, Text } from 'react-native';

import type { Href } from 'expo-router';

export type TaskRowProps = { readonly title: string; readonly onPress: () => void; readonly href?: Href };

export function TaskRow(props: TaskRowProps): React.JSX.Element {
  return (
    <Pressable onPress={props.onPress}>
      <Text>{props.title}</Text>
    </Pressable>
  );
}
