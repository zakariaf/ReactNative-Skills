// src/features/tasks/components/task-limit-field.tsx
// Decoys for number-to-text: String() inside handlers and arrow bodies is not text a JSX element shows.
import { TextInput, View } from 'react-native';

export type TaskLimitFieldProps = {
  readonly limitText: string;
  readonly onLimit: (limit: string) => void;
};

export function TaskLimitField({ limitText, onLimit }: TaskLimitFieldProps): React.JSX.Element {
  const handleChange = (text: string): void => {
    onLimit(String(Number.parseInt(text, 10)));
  };
  return (
    <View testID="tasks.limit-field">
      <TextInput
        value={limitText}
        onChangeText={(text) => {
          handleChange(text.trim().toString());
        }}
      />
    </View>
  );
}
