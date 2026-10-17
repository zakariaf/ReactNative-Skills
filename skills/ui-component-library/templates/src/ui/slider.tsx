// src/ui/slider.tsx
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { makeStyles } from '@/theme/make-styles';
import { shadow } from '@/theme/shadow-styles';
import { ELEVATION } from '@/theme/tokens';
import { useTextLocale } from '@/theme/use-text-locale';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';
import type { AccessibilityActionEvent, LayoutChangeEvent } from 'react-native';

const SLIDER = COMPONENT_SPECS.slider;
/** A screen reader's swipe up or down moves the value by a tenth. */
export const SLIDER_STEP = 0.1;
/** A drag starts after 8 pt sideways; 8 pt up or down first hands the touch to the scrolling list. */
const DRAG_SLOP = 8;
const PERCENT = 100;
const ACTIONS = [{ name: 'increment' }, { name: 'decrement' }] as const;

export type SliderProps = {
  /** 0..1 */
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** Translated name ("Reminder volume"). */
  readonly label: string;
  readonly testID: string;
  /** What it controls is off: the fill turns muted, the value stays. */
  readonly isMuted?: boolean;
  /** Gesture ids for tests (fireGestureHandler from react-native-gesture-handler/jest-utils). */
  readonly gestureTestID?: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    target: {
      flex: 1,
      minHeight: SLIDER.height,
      minWidth: SLIDER.minWidth,
      justifyContent: 'center',
    },
    track: {
      height: SLIDER.trackHeight,
      borderRadius: SLIDER.trackRadius,
      backgroundColor: theme.colors.sunken,
      overflow: 'hidden',
    },
    fill: { height: '100%', backgroundColor: theme.colors.primary },
    fillMuted: { backgroundColor: theme.colors.textMuted },
    thumb: {
      position: 'absolute',
      width: SLIDER.thumb,
      height: SLIDER.thumb,
      borderRadius: SLIDER.thumb / 2,
      borderWidth: SLIDER.thumbBorder,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      ...shadow(ELEVATION.raised, theme.colors.shadow),
    },
  });
  return styles;
});

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * A value from 0 to 1: a 44 pt target, the fill from the start edge, a draggable thumb. Screen
 * readers adjust it with swipes (increment and decrement actions, a tenth per step).
 */
export function Slider(props: SliderProps): ReactNode {
  const styles = useStyles();
  const { direction } = useTextLocale();
  const [width, setWidth] = useState(0);
  const value = clampUnit(props.value);
  const valueAt = (x: number): number => {
    if (width <= 0) return value;
    const ratio = clampUnit(x / width);
    return direction === 'rtl' ? 1 - ratio : ratio;
  };
  // Sideways drags move the value; a vertical swipe fails the pan so the list under it scrolls.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .onStart((event) => {
      props.onChange(valueAt(event.x));
    })
    .onUpdate((event) => {
      props.onChange(valueAt(event.x));
    });
  // A tap jumps to the tapped point.
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((event) => {
      props.onChange(valueAt(event.x));
    });
  if (props.gestureTestID !== undefined) {
    pan.withTestId(`${props.gestureTestID}.pan`);
    tap.withTestId(`${props.gestureTestID}.tap`);
  }
  const handleLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };
  const handleAction = (event: AccessibilityActionEvent): void => {
    const delta = event.nativeEvent.actionName === 'increment' ? SLIDER_STEP : -SLIDER_STEP;
    props.onChange(clampUnit(Math.round((value + delta) * PERCENT) / PERCENT));
  };
  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        style={styles.target}
        onLayout={handleLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={props.label}
        accessibilityValue={{ min: 0, max: PERCENT, now: Math.round(value * PERCENT) }}
        accessibilityActions={ACTIONS}
        onAccessibilityAction={handleAction}
        testID={props.testID}
      >
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              props.isMuted === true && styles.fillMuted,
              { width: `${String(value * PERCENT)}%` },
            ]}
            testID={`${props.testID}.fill`}
          />
        </View>
        {width > 0 ? (
          <View style={[styles.thumb, { start: value * width - SLIDER.thumb / 2 }]} />
        ) : null}
      </View>
    </GestureDetector>
  );
}
