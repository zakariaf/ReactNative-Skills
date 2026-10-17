// Planted findings: an installed skill's template is never scanned.
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import { FadeIn, withSpring, withTiming } from 'react-native-reanimated';

import { PALETTE } from '@/theme/palette';
import { APP_THEMES } from '@/theme/theme-context';

export const styles = StyleSheet.create({
  card: { backgroundColor: '#FF00AA', fontSize: 14, fontWeight: '700', letterSpacing: 1, borderRadius: 999, shadowRadius: 8, elevation: 4 },
  line: { lineHeight: Math.round(22.44) },
  tint: { color: PALETTE.light.primary },
});
export const fade = () => withTiming(1, { duration: 300 });
export const pop = () => withSpring(1, { damping: 14, stiffness: 420 });
export const entering = FadeIn.duration(300);
export const themes = APP_THEMES;
export const Gradient = LinearGradient;
