// src/ui/app-button.tsx: the one button primitive (raw Pressable lives only in src/ui).
import { Pressable } from 'react-native';

import { AppText } from './app-text';

export type AppButtonProps = {
  readonly label: string;
  readonly testID: string;
  readonly onPress: () => void;
};

export function AppButton({ label, testID, onPress }: AppButtonProps): React.JSX.Element {
  return (
    <Pressable role="button" accessibilityLabel={label} testID={testID} onPress={onPress}>
      <AppText>{label}</AppText>
    </Pressable>
  );
}
