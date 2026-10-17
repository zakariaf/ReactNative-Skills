// src/ui/toast.tsx
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
import { shadow } from '@/theme/shadow-styles';
import { ELEVATION } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { BusyIndicator } from './busy-indicator';
import { COMPONENT_SPECS } from './component-specs';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';

const TOAST = COMPONENT_SPECS.toast;
const DROP = { duration: MOTION_MS.standard, easing: Easing.bezier(...EASING.decelerate) };
const FADE = { duration: MOTION_MS.reducedFade };

export type ToastProps = {
  /** Translated message. The screen also announces it (useAnnounce): iOS does not read live regions. */
  readonly text: string;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  /** An icon at the start, or 'busy' for the busy blocks (Restoring...). */
  readonly icon?: IconSlot | 'busy';
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    // Floats above the content, so it is the one surface besides dialogs with a shadow.
    toast: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOAST.gap,
      paddingBlock: TOAST.paddingBlock,
      paddingInline: TOAST.paddingInline,
      borderRadius: TOAST.radius,
      borderWidth: TOAST.border,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      ...shadow(ELEVATION.raised, theme.colors.shadow, ELEVATION.control),
    },
    text: { flexShrink: 1 },
  });
  return styles;
});

/** Drops in from below and fades in; only fades under reduce motion. */
function useDropIn(isReducedMotion: boolean): ReturnType<typeof useAnimatedStyle> {
  const progress = useSharedValue(0);
  // Allowed effect: starts the entrance animation once; sets no React state.
  useEffect(() => {
    progress.set(withTiming(1, isReducedMotion ? FADE : DROP));
  }, [isReducedMotion, progress]);
  return useAnimatedStyle(() => {
    const t = progress.get();
    if (isReducedMotion) return { opacity: t };
    return { opacity: t, transform: [{ translateY: interpolate(t, [0, 1], [TOAST.drop, 0]) }] };
  });
}

function leading(props: ToastProps, color: string): ReactNode {
  if (props.icon === 'busy')
    return <BusyIndicator color={color} isReducedMotion={props.isReducedMotion} />;
  return props.icon?.({ size: TOAST.icon, color }) ?? null;
}

/**
 * A short message about something that just happened. An alert with a polite live region (TalkBack
 * reads it); the screen owns its timer and also announces it for VoiceOver.
 */
export function Toast(props: ToastProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const dropIn = useDropIn(props.isReducedMotion);
  return (
    <Animated.View
      style={[styles.toast, dropIn]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={props.testID}
    >
      {leading(props, theme.colors.text)}
      <View style={styles.text}>
        <AppText variant="toast">{props.text}</AppText>
      </View>
    </Animated.View>
  );
}
