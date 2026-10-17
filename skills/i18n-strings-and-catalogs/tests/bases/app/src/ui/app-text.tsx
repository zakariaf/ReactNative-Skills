// src/ui/app-text.tsx
import { Text } from 'react-native';

import type { TextProps } from 'react-native';

export type AppTextProps = Pick<TextProps, 'children' | 'numberOfLines' | 'testID'>;

export function AppText(props: AppTextProps): React.JSX.Element {
  return <Text {...props} />;
}
