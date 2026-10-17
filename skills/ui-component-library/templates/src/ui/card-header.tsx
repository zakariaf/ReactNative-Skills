// src/ui/card-header.tsx
import { StyleSheet, View } from 'react-native';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const HEADER = COMPONENT_SPECS.cardHeader;

export type CardHeaderProps = {
  /** Translated. */
  readonly title: string;
  readonly testID: string;
  /** An IconTile (or another small decorative element) before the title. */
  readonly leading?: ReactNode;
  /** One small action at the end (a TextButton). */
  readonly trailing?: ReactNode;
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: HEADER.gap },
  title: { flex: 1 },
});

/** The heading row of a card: optional leading tile, the title as a header, an optional action. */
export function CardHeader({ title, testID, leading, trailing }: CardHeaderProps): ReactNode {
  return (
    <View style={styles.header} testID={testID}>
      {leading}
      <View style={styles.title}>
        <AppText variant="sectionHeading" isHeader testID={`${testID}.title`}>
          {title}
        </AppText>
      </View>
      {trailing}
    </View>
  );
}
