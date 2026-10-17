// src/ui/physical-direction-view.tsx
// Keeps a physical surface left to right while the screen around it mirrors: a map with view
// overlays, a media scrubber, a drawing pad, a board built from views. Inside a right-to-left layout
// React Native mirrors rows, start/end keys and absolute start/end positions; `direction: 'ltr'`
// stops that for this subtree. A surface whose content reads in the language's direction (a time
// axis, a reading-order grid) passes mirrorsInRtl and mirrors like the rest of the screen. A Skia
// canvas draws in physical pixels anyway; its own layout decides mirroring (skia-canvas-rendering).
import { StyleSheet, View } from 'react-native';

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type PhysicalDirectionViewProps = {
  /** True only for content that reads in the language's direction. Default: physical (false). */
  readonly mirrorsInRtl?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly children: ReactNode;
};

export function PhysicalDirectionView(props: PhysicalDirectionViewProps): ReactNode {
  return (
    <View
      style={[props.mirrorsInRtl === true ? null : styles.physical, props.style]}
      {...(props.testID === undefined ? {} : { testID: props.testID })}
    >
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  physical: { direction: 'ltr' },
});
