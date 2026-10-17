// src/ui/confetti.tsx
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { makeStyles } from '@/theme/make-styles';
import { EASING, MOTION_MS } from '@/theme/motion';
import { useTheme } from '@/theme/use-theme';

import { COMPONENT_SPECS } from './component-specs';

import type { Theme } from '@/theme/theme-types';
import type { ReactNode } from 'react';

const CONFETTI = COMPONENT_SPECS.confetti;
const FALL = { duration: MOTION_MS.slow, easing: Easing.bezier(...EASING.overshoot) };
type Paint = 'primary' | 'success' | 'warning';
/**
 * Where the pieces lie (percent of the band's width from its left edge, pt from its top) and how
 * they tilt. The scatter is the same in every language: the band lays out left to right.
 */
const PIECES: readonly {
  readonly x: number;
  readonly y: number;
  readonly deg: number;
  readonly paint: Paint;
}[] = [
  { x: 4, y: 18, deg: 18, paint: 'primary' },
  { x: 24, y: 2, deg: -12, paint: 'success' },
  { x: 46, y: 30, deg: 30, paint: 'warning' },
  { x: 68, y: 8, deg: -24, paint: 'primary' },
  { x: 88, y: 36, deg: 8, paint: 'success' },
];

export type ConfettiProps = {
  /** No celebration under reduce motion: the band renders nothing. */
  readonly isReducedMotion: boolean;
  readonly testID: string;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    band: { height: CONFETTI.band, alignSelf: 'stretch', direction: 'ltr' },
    piece: {
      position: 'absolute',
      width: CONFETTI.piece,
      height: CONFETTI.piece,
      borderRadius: CONFETTI.radius,
    },
  });
  return styles;
});

function paintOf(theme: Theme, paint: Paint): string {
  return theme.colors[paint];
}

/** A short, bounded celebration (all tasks done): five pieces fall into place once. Decorative. */
export function Confetti({ isReducedMotion, testID }: ConfettiProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const drop = useSharedValue(0);
  // Allowed effect: starts the one-shot animation; sets no React state.
  useEffect(() => {
    if (!isReducedMotion) drop.set(withTiming(1, FALL));
  }, [drop, isReducedMotion]);
  const fall = useAnimatedStyle(() => ({
    opacity: drop.get(),
    transform: [{ translateY: interpolate(drop.get(), [0, 1], [-CONFETTI.fall, 0]) }],
  }));
  if (isReducedMotion) return null;
  return (
    <Animated.View
      style={[styles.band, fall]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {PIECES.map((piece) => (
        <View
          key={`${String(piece.x)}-${String(piece.y)}`}
          style={[
            styles.piece,
            {
              start: `${String(piece.x)}%`,
              top: piece.y,
              backgroundColor: paintOf(theme, piece.paint),
              transform: [{ rotate: `${String(piece.deg)}deg` }],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}
