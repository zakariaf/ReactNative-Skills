// src/ui/chevron.tsx
import { StyleSheet, View } from 'react-native';

import { useTextLocale } from '@/theme/use-text-locale';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const CHEVRON = COMPONENT_SPECS.chevron;

export type ChevronProps = {
  readonly color: string;
  readonly testID?: string;
};

const styles = StyleSheet.create({
  frame: {
    width: CHEVRON.size * 2,
    height: CHEVRON.size * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The top and end edges of a square, turned so the corner points to the reading direction's end.
  mark: {
    width: CHEVRON.size,
    height: CHEVRON.size,
    borderTopWidth: CHEVRON.stroke,
    borderEndWidth: CHEVRON.stroke,
  },
  pointEnd: { transform: [{ rotate: '45deg' }] },
  pointEndRtl: { transform: [{ rotate: '-45deg' }] },
});

/**
 * A drawn chevron that points where reading goes on: right in left-to-right layouts, left in
 * right-to-left ones (it follows the layout direction, unlike a decorative tilt). Decorative.
 */
export function Chevron({ color, testID }: ChevronProps): ReactNode {
  const { direction } = useTextLocale();
  return (
    <View
      style={styles.frame}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(testID === undefined ? {} : { testID })}
    >
      <View
        style={[
          styles.mark,
          direction === 'rtl' ? styles.pointEndRtl : styles.pointEnd,
          { borderColor: color },
        ]}
        {...(testID === undefined ? {} : { testID: `${testID}.mark` })}
      />
    </View>
  );
}
