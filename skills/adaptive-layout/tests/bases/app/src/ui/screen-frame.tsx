// src/ui/screen-frame.tsx
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CONTENT_MAX_WIDTH } from '@/theme/tokens';

import type { ReactNode } from 'react';
import type { Edge } from 'react-native-safe-area-context';

export function ScreenFrame(props: { readonly testID: string; readonly edges: readonly Edge[]; readonly children: ReactNode }): ReactNode {
  return (
    <SafeAreaView edges={props.edges} style={{ flex: 1, alignItems: 'center' }} testID={props.testID}>
      <View style={{ flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH }}>{props.children}</View>
    </SafeAreaView>
  );
}
