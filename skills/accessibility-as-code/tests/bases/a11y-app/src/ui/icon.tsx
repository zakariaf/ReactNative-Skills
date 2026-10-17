// src/ui/icon.tsx
import { View } from 'react-native';

import type { ReactNode } from 'react';

export function Icon({ name }: { readonly name: string }): ReactNode {
  return <View testID={`icon.${name}`} />;
}
