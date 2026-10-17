// src/ui/toggle.tsx
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { makeStyles } from '@/theme/make-styles';
import { EASING, MOTION_MS } from '@/theme/motion';
import { useTextLocale } from '@/theme/use-text-locale';
import { useTheme } from '@/theme/use-theme';

import { CheckMark } from './check-mark';
import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const TOGGLE = COMPONENT_SPECS.toggle;
/** How far the knob travels: the track's inner width minus the knob and its two insets. */
const TRAVEL = TOGGLE.width - TOGGLE.knob - 2 * (TOGGLE.knobInset + TOGGLE.border);
const SLIDE = { duration: MOTION_MS.standard, easing: Easing.bezier(...EASING.standard) };

export type ToggleProps = {
  readonly isOn: boolean;
  /** The knob jumps instead of sliding. */
  readonly isReducedMotion: boolean;
  /** A part id, usually `<row>.toggle`; the check inside is `<row>.toggle.check`. */
  readonly testID?: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    track: {
      width: TOGGLE.width,
      height: TOGGLE.height,
      borderRadius: TOGGLE.radius,
      borderWidth: TOGGLE.border,
      justifyContent: 'center',
    },
    off: { borderColor: theme.colors.border, backgroundColor: theme.colors.sunken },
    on: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
    knob: {
      position: 'absolute',
      start: TOGGLE.knobInset,
      width: TOGGLE.knob,
      height: TOGGLE.knob,
      borderRadius: TOGGLE.knob / 2,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
  return styles;
});

/**
 * The on/off graphic of a switch row. Position and a check carry the state, not colour alone. It
 * is not a target of its own: the whole row is the switch, so the graphic hides itself.
 */
export function Toggle({ isOn, isReducedMotion, testID }: ToggleProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const { direction } = useTextLocale();
  const travel = TRAVEL * (direction === 'rtl' ? -1 : 1);
  const position = useSharedValue(isOn ? 1 : 0);
  // Allowed effect: drives an animation when the prop changes; sets no React state.
  useEffect(() => {
    const target = isOn ? 1 : 0;
    position.set(isReducedMotion ? target : withTiming(target, SLIDE));
  }, [isOn, isReducedMotion, position]);
  const checkId = testID === undefined ? {} : { testID: `${testID}.check` };
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.get() * travel }],
  }));
  return (
    <View
      style={[styles.track, isOn ? styles.on : styles.off]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(testID === undefined ? {} : { testID })}
    >
      <Animated.View style={[styles.knob, knobStyle]}>
        {isOn ? <CheckMark color={theme.colors.primary} {...checkId} /> : null}
      </Animated.View>
    </View>
  );
}
