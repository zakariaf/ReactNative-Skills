// src/ui/screen-body.tsx
// A stand-in for screen-contracts's ScreenBody: a ui file another skill owns (owned elsewhere or excluded by default).
import { View } from 'react-native';

import type { ReactNode } from 'react';

export function ScreenBody(props: { readonly children?: ReactNode }): ReactNode {
  return <View>{props.children}</View>;
}
