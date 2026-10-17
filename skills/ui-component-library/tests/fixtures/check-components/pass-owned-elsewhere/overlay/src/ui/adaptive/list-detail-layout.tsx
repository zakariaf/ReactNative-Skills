// src/ui/adaptive/list-detail-layout.tsx
// A stand-in for adaptive-layout's ListDetailLayout: a ui file another skill owns (owned elsewhere or excluded by default).
import { View } from 'react-native';

import type { ReactNode } from 'react';

export function ListDetailLayout(props: { readonly children?: ReactNode }): ReactNode {
  return <View>{props.children}</View>;
}
