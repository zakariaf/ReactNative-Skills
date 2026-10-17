// src/ui/app-text.tsx (a stand-in: design-system-structure owns the real file)
import { Text } from 'react-native';

import type { TextProps } from 'react-native';

export function AppText(props: Pick<TextProps, 'children' | 'testID'>): React.JSX.Element {
  return <Text {...props} />;
}
