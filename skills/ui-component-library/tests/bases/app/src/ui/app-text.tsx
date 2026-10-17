// src/ui/app-text.tsx: fixture stub of design-system-structure's AppText (a prerequisite, not a library component).
import { Text } from 'react-native';

import type { ReactNode } from 'react';

export type AppTextProps = { readonly children: string; readonly testID?: string };

export function AppText({ children, testID }: AppTextProps): ReactNode {
  return <Text {...(testID === undefined ? {} : { testID })}>{children}</Text>;
}
