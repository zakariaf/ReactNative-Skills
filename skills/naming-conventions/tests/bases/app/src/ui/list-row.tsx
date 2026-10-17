// src/ui/list-row.tsx: a pressable row; the caller passes a testID ending in -row.
import { Pressable } from 'react-native';

import { AppText } from './app-text';

export type ListRowProps = {
  readonly title: string;
  readonly testID: string;
  readonly isChecked: boolean;
  readonly onPress: () => void;
};

export function ListRow({ title, testID, isChecked, onPress }: ListRowProps): React.JSX.Element {
  return (
    <Pressable role="checkbox" accessibilityLabel={title} accessibilityState={{ checked: isChecked }} testID={testID} onPress={onPress}>
      <AppText>{title}</AppText>
    </Pressable>
  );
}
