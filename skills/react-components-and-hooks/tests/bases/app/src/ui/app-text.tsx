// src/ui/app-text.tsx: the text primitive, the one file that imports Text from react-native.
import { Text } from 'react-native';

import type { ReactNode } from 'react';

export type AppTextProps = {
  readonly children: string;
  readonly testID?: string;
  readonly isHeader?: boolean;
};

export function AppText({ children, testID, isHeader = false }: AppTextProps): ReactNode {
  return (
    <Text
      maxFontSizeMultiplier={2}
      accessibilityRole={isHeader ? 'header' : 'text'}
      {...(testID === undefined ? {} : { testID })}
    >
      {children}
    </Text>
  );
}
