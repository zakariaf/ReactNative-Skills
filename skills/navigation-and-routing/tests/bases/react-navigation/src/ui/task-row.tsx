// src/ui/task-row.tsx
import { Pressable, Text } from 'react-native';

export function TaskRow(props: { readonly title: string; readonly onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={props.onPress}>
      <Text>{props.title}</Text>
    </Pressable>
  );
}
