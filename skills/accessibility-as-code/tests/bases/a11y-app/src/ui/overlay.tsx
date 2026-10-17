// src/ui/overlay.tsx
import { StyleSheet, View } from 'react-native';

import type { ReactNode } from 'react';

export type OverlayProps = {
  readonly isOpen: boolean;
  readonly content: ReactNode;
  readonly children: ReactNode;
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  layer: { position: 'absolute', inset: 0 },
});

// One component owns the modal root: VoiceOver stays inside the layer (the iOS flag on the scrim,
// never on the card), and TalkBack cannot reach the content behind it (aria-hidden while open).
export function Overlay({ isOpen, content, children }: OverlayProps): ReactNode {
  return (
    <View style={styles.fill}>
      <View style={styles.fill} aria-hidden={isOpen}>
        {children}
      </View>
      {isOpen ? (
        <View style={styles.layer} accessibilityViewIsModal testID="overlay.scrim">
          {content}
        </View>
      ) : null}
    </View>
  );
}
