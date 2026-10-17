// src/ui/parity-launch-marker.tsx
// The launch marker of a parity capture: an invisible 1 x 1 pt accessible element whose testID is
// parity.launch.<nonce>. capture-app.mjs refuses a hierarchy dump without the marker of its own
// launch, which proves the dump came from this launch on this device (a Maestro call once answered
// from another session's simulator). The parity root draws one, and every modal root draws one as the
// first child of its accessibilityViewIsModal view (never beside it: iOS hides that view's siblings),
// because a modal layer hides everything outside it from the accessibility tree that Maestro reads.
// It renders nothing unless a parity launch provides a request, so production builds never show it.
import { StyleSheet, View } from 'react-native';

import { useFrameRequest } from '@/hooks/use-frame-request';

import type { ReactNode } from 'react';

const styles = StyleSheet.create({
  marker: { position: 'absolute', width: 1, height: 1 },
});

export function ParityLaunchMarker(): ReactNode {
  const request = useFrameRequest();
  if (request === null) return null;
  return (
    <View
      testID={`parity.launch.${request.nonce}`}
      accessible
      accessibilityLabel={request.nonce}
      style={styles.marker}
    />
  );
}
