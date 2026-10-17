// src/ui/app-text.tsx
import { Text } from 'react-native';

import type { TextProps } from 'react-native';

export function AppText(props: Pick<TextProps, 'children' | 'testID'>): React.JSX.Element {
  return <Text {...props} />;
}
