// src/ui/pressable-surface.tsx
// The one press implementation: a face with an edge, the press feedback the theme chooses
// (PRESS.kind: dim, shrink, or sink into a shadow like a key), the Android ripple, accessibility
// state, and the injected press feedback (sound, haptics; Android's own click is turned off while
// that feedback plays a sound). Buttons, rows, segments and keys compose it.
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { makeStyles } from '@/theme/make-styles';
import { EASING, MOTION_MS, SPRINGS } from '@/theme/motion';
import { ELEVATION, MIN_TOUCH, PRESS, STROKE } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { usePressFeedback, usePressFeedbackPlaysSound } from './press-feedback-context';

import type { PressKind } from '@/theme/tokens';
import type { ReactNode } from 'react';
import type { AccessibilityRole, PressableProps, StyleProp, ViewStyle } from 'react-native';

export type PressableSurfaceProps = {
  /** Translated; also the accessibility label. */
  readonly label: string;
  /** The action; the press feedback runs first, except for a switch (its handler plays its own). */
  readonly onPress: () => void;
  readonly testID: string;
  readonly radius: number;
  /** Face paint from the theme: colors.surface or colors.primary. */
  readonly fill: string;
  /** From the app's reduce-motion hook (accessibility-as-code), via the screen model. */
  readonly isReducedMotion: boolean;
  /** Default PRESS.kind; only a control that must feel different (a keypad's keys) passes another. */
  readonly pressKind?: PressKind;
  /** 'sink' only: ELEVATION.raised or .control, the shadow offset and the press depth. */
  readonly elevation?: number;
  /** Android ripple colour; default colors.separator (pass a tint of onPrimary on a primary fill). */
  readonly rippleColor?: string;
  /** Edge colour; default colors.border (a destructive button passes colors.danger, never primary). */
  readonly edgeColor?: string;
  /** Edge width; default STROKE.regular. */
  readonly edgeWidth?: number;
  /** 'sink': a selected segment sits pushed in (by layout). Other kinds show selection by fill. */
  readonly isPushedIn?: boolean;
  /** Muted face (PRESS.disabledEdge), ignores presses; 'sink' also sits pushed in. */
  readonly isDisabled?: boolean;
  /** Keeps its paint, ignores presses; the label says what is happening. */
  readonly isBusy?: boolean;
  readonly accessibilityRole?: AccessibilityRole;
  readonly isSelected?: boolean;
  readonly isChecked?: boolean;
  readonly hint?: string;
  /** Layout of the face (padding, direction, alignment, min height) from the component. */
  readonly faceStyle?: StyleProp<ViewStyle>;
  /** In a row of buttons (a dialog): the key and its face fill the row's height. */
  readonly isStretched?: boolean;
  /** Layout of the whole control in its parent (flex, alignSelf, width); never paint. */
  readonly layoutStyle?: StyleProp<ViewStyle>;
  /** Extra press-in / press-out work (hold-to-confirm); the feedback animation always runs. */
  readonly onPressIn?: () => void;
  readonly onPressOut?: () => void;
  /** Screen-reader alternatives for hold gestures ('activate' replaces the double tap). */
  readonly accessibilityActions?: PressableProps['accessibilityActions'];
  readonly onAccessibilityAction?: PressableProps['onAccessibilityAction'];
  readonly children: ReactNode;
};

/** What a press looks like on this platform: the theme's kind, or the Android ripple. */
export type PressFeedbackLook = PressKind | 'ripple';

/**
 * 'sink' keeps its key look everywhere; otherwise Android draws its ripple when PRESS asks for it,
 * and 'scale' becomes a dim under reduce motion (a size change is motion, a dim is not).
 */
export function pressLookOf(
  kind: PressKind,
  os: string,
  isReducedMotion: boolean,
): PressFeedbackLook {
  if (kind === 'sink') return 'sink';
  if (os === 'android' && PRESS.androidRipple) return 'ripple';
  return kind === 'scale' && isReducedMotion ? 'opacity' : kind;
}

const PRESS_IN = { duration: MOTION_MS.pressIn, easing: Easing.bezier(...EASING.decelerate) };
const RELEASE_FADE = { duration: MOTION_MS.fast, easing: Easing.bezier(...EASING.standard) };

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    // 'sink': same box as the face; it slides from `elevation` below the face to 0 as the key sinks.
    // A View, not boxShadow, so it moves with the press and draws on Android 7 and 8 too. It hangs
    // below the layout box like a CSS box-shadow: leave the gap in the layout, never clip a parent.
    shadow: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 },
    shadowPaint: { backgroundColor: theme.colors.shadow },
    // The ripple is drawn over the control and clipped to its corners.
    rippleClip: { overflow: 'hidden' },
    // isStretched: the key fills the height its row gives it, so both dialog buttons are as tall as
    // the taller one (CSS align-items: stretch): a one-line "Cancel" beside a two-line "Delete list".
    stretched: { flexGrow: 1 },
    face: {
      minHeight: MIN_TOUCH,
      minWidth: MIN_TOUCH,
      borderWidth: STROKE.regular,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    faceDisabled: { backgroundColor: theme.colors.sunken, borderColor: theme.colors.border },
    edgeDashed: { borderStyle: 'dashed', borderColor: theme.colors.textMuted },
  });
  return styles;
});

type Styles = ReturnType<typeof useStyles>;

function faceStylesOf(
  props: PressableSurfaceProps,
  styles: Styles,
  isDisabled: boolean,
): StyleProp<ViewStyle> {
  return [
    styles.face,
    {
      borderRadius: props.radius,
      backgroundColor: props.fill,
      ...(props.edgeColor === undefined ? {} : { borderColor: props.edgeColor }),
      ...(props.edgeWidth === undefined ? {} : { borderWidth: props.edgeWidth }),
    },
    isDisabled && styles.faceDisabled,
    isDisabled && PRESS.disabledEdge === 'dashed' && styles.edgeDashed,
    props.isStretched === true && styles.stretched,
    props.faceStyle,
  ];
}

function a11yProps(props: PressableSurfaceProps, isInactive: boolean): PressableProps {
  return {
    accessibilityLabel: props.label,
    ...(props.accessibilityActions === undefined
      ? {}
      : { accessibilityActions: props.accessibilityActions }),
    ...(props.onAccessibilityAction === undefined
      ? {}
      : { onAccessibilityAction: props.onAccessibilityAction }),
    ...(props.hint === undefined ? {} : { accessibilityHint: props.hint }),
    accessibilityState: {
      disabled: isInactive,
      busy: props.isBusy === true,
      ...(props.isSelected === undefined ? {} : { selected: props.isSelected }),
      ...(props.isChecked === undefined ? {} : { checked: props.isChecked }),
    },
  };
}

type PressState = {
  readonly look: PressFeedbackLook;
  readonly isInactive: boolean;
  readonly isSunk: boolean;
  /** The sink depth; 0 for every other look. */
  readonly elevation: number;
  readonly role: AccessibilityRole;
};

function pressStateOf(props: PressableSurfaceProps): PressState {
  const look = pressLookOf(props.pressKind ?? PRESS.kind, Platform.OS, props.isReducedMotion);
  const isInactive = props.isDisabled === true || props.isBusy === true;
  return {
    look,
    isInactive,
    // Only a sinking key has a pushed-in place, and it gets there by layout (pressableStyleOf).
    isSunk: look === 'sink' && (isInactive || props.isPushedIn === true),
    elevation: look === 'sink' ? (props.elevation ?? ELEVATION.flat) : 0,
    role: props.accessibilityRole ?? 'button',
  };
}

/**
 * A key that stays pushed in moves by layout (`top` on the Pressable), never by a transform:
 * VoiceOver, TalkBack and Maestro report the layout frame, not the transformed one. Transforms are
 * only the transient press. The ripple is clipped to the control's corners.
 */
function pressableStyleOf(
  props: PressableSurfaceProps,
  { isSunk, elevation, look }: PressState,
  styles: Styles,
): StyleProp<ViewStyle> {
  return [
    props.layoutStyle,
    isSunk && { top: elevation },
    look === 'ripple' && [styles.rippleClip, { borderRadius: props.radius }],
  ];
}

function rippleOf(
  props: PressableSurfaceProps,
  look: PressFeedbackLook,
  color: string,
): PressableProps {
  return look === 'ripple'
    ? { android_ripple: { color: props.rippleColor ?? color, foreground: true } }
    : {};
}

/**
 * A pressable face whose press looks the way the theme says (PRESS), with the same accessibility,
 * feedback seam and reduce-motion behaviour in every look. Every press also runs the app's press
 * feedback (usePressFeedback, silent without a provider). When that feedback plays a sound
 * (PressFeedbackProvider playsSound), android_disableSound silences Android's system click, which
 * Pressability plays on every press while the Touch sounds setting is on; the two would double.
 */
export function PressableSurface(props: PressableSurfaceProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const depth = useSharedValue(0);
  const state = pressStateOf(props);
  const { look, isSunk, elevation } = state;
  const squashFactor = props.isReducedMotion ? 0 : 1;
  const onPressFeedback = usePressFeedback();
  const hasFeedbackSound = usePressFeedbackPlaysSound();

  const pressStyle = useAnimatedStyle(() => {
    const pressed = isSunk ? 0 : depth.get();
    const shrink = look === 'scale' ? 1 - (1 - PRESS.scale) * pressed : 1;
    const sink = look === 'sink' ? pressed : 0;
    return {
      opacity: look === 'opacity' ? 1 - (1 - PRESS.opacity) * pressed : 1,
      transform: [
        { translateY: sink * elevation },
        { scaleX: shrink * (1 + PRESS.squash.x * squashFactor * sink) },
        { scaleY: shrink * (1 + PRESS.squash.y * squashFactor * sink) },
      ],
    };
  });
  const shadowStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - (isSunk ? 1 : depth.get())) * elevation }],
  }));

  function handlePressIn(): void {
    depth.set(withTiming(1, PRESS_IN));
    props.onPressIn?.();
  }
  function handlePressOut(): void {
    depth.set(look === 'opacity' ? withTiming(0, RELEASE_FADE) : withSpring(0, SPRINGS.release));
    props.onPressOut?.();
  }
  function handlePress(): void {
    if (state.role !== 'switch') onPressFeedback();
    props.onPress();
  }

  return (
    <Pressable
      accessibilityRole={state.role}
      {...a11yProps(props, state.isInactive)}
      {...rippleOf(props, look, theme.colors.separator)}
      android_disableSound={hasFeedbackSound}
      disabled={state.isInactive}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      testID={props.testID}
      style={pressableStyleOf(props, state, styles)}
    >
      <Animated.View style={[props.isStretched === true && styles.stretched, pressStyle]}>
        {elevation > 0 && (
          <Animated.View
            style={[styles.shadow, styles.shadowPaint, { borderRadius: props.radius }, shadowStyle]}
          />
        )}
        <View style={faceStylesOf(props, styles, props.isDisabled === true)}>{props.children}</View>
      </Animated.View>
    </Pressable>
  );
}
