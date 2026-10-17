// src/ui/app-text.tsx: the one component that renders React Native's Text.
import { Text } from 'react-native';

import type { TextProps } from 'react-native';

export type AppTextProps = Pick<TextProps, 'children' | 'numberOfLines' | 'testID'>;

export function AppText(props: AppTextProps): React.JSX.Element {
  return <Text {...props} />;
}
