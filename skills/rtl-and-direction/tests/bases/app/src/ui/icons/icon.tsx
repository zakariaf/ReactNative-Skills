// src/ui/icons/icon.tsx
// The one place a flip may live: directional icons mirror in a right-to-left layout.
import { Image, StyleSheet } from 'react-native';

import { useDirection } from '@/i18n/direction-context';

import { DIRECTIONAL_ICONS } from './icon-paths';

import type { IconName } from './icon-paths';

const styles = StyleSheet.create({ icon: { width: 24, height: 24 }, flipped: { transform: [{ scaleX: -1 }] } });

export function Icon({ name }: { readonly name: IconName }): React.JSX.Element {
  const isFlipped = useDirection() === 'rtl' && DIRECTIONAL_ICONS.has(name);
  return <Image source={{ uri: name }} style={[styles.icon, isFlipped && styles.flipped]} />;
}
