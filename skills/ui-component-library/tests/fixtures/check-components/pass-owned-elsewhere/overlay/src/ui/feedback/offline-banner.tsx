// src/ui/feedback/offline-banner.tsx
// A stand-in for ui-states-and-feedback's OfflineBanner: a ui file another skill owns (owned elsewhere or excluded by default).
import { View } from 'react-native';

import type { ReactNode } from 'react';

export function OfflineBanner(props: { readonly children?: ReactNode }): ReactNode {
  return <View>{props.children}</View>;
}
