// src/ui/parity-launch-marker.tsx
// A stand-in for design-visual-parity's ParityLaunchMarker: a ui file another skill owns.
import { View } from 'react-native';

import type { ReactNode } from 'react';

export function ParityLaunchMarker(): ReactNode {
  return <View style={{ position: 'absolute', width: 1, height: 1 }} />;
}
