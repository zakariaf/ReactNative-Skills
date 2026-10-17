import { Text } from 'react-native';

import type { TextProps } from 'react-native';

export function AppText(props: Pick<TextProps, 'children' | 'testID'>) {
  return <Text {...props} />;
}
