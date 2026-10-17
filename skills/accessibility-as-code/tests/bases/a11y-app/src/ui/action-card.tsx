// src/ui/action-card.tsx
import { Pressable, StyleSheet, View } from 'react-native';

import type { ReactNode } from 'react';

export type ActionCardProps = {
  /** The visible texts joined in reading order, built with t() in the model hook. */
  readonly openLabel: string;
  readonly onOpen: () => void;
  readonly testID: string;
  /** The visible texts: hidden from the screen reader (the opener says them) and passing touches through. */
  readonly children: ReactNode;
  /** The card's own action, a sibling of the opener drawn above it. */
  readonly action: ReactNode;
};

const styles = StyleSheet.create({
  card: { minHeight: 96 },
  opener: { position: 'absolute', inset: 0 },
  // Drawn above the opener: touches must fall through to it, or tapping the title does nothing.
  texts: { pointerEvents: 'none' },
});

// The card body opens and its action acts: two sibling elements, and the text layer in the same component.
export function ActionCard(props: ActionCardProps): ReactNode {
  return (
    <View style={styles.card}>
      <Pressable
        style={styles.opener}
        accessibilityRole="button"
        accessibilityLabel={props.openLabel}
        onPress={props.onOpen}
        testID={props.testID}
      />
      <View style={styles.texts} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {props.children}
      </View>
      {props.action}
    </View>
  );
}
