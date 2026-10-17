import { Pressable, Text } from 'react-native';

export function Button({ label }: { readonly label: string }) {
  return (
    <Pressable accessibilityRole="button">
      <Text>{label}</Text>
    </Pressable>
  );
}
