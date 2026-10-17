// src/ui/form/keyboard-done-bar.tsx
// A bar that rides on top of the keyboard with one translated "Done" button (forms-and-input).
// The iOS number, decimal and phone pads have no return key, so a form with such a field
// (FIELD_KINDS hasReturnKey: false) renders this bar, or the keyboard cannot be closed on an
// iPhone. It shows only while the keyboard is up. Not react-native-keyboard-controller's
// KeyboardToolbar: in 1.21.9 its buttons speak fixed English labels and hints and cap their text
// at 130 %. Needs KeyboardProvider at the app root, like every keyboard-controller view.
// The bar sits on top of the keyboard, so it covers whatever the form's scroll view keeps just
// above the keyboard: it reports its measured height (onHeightChange; it grows with the text
// size) and useDoneBarSpace turns that into the scroll view's bottomOffset.
import { Keyboard, StyleSheet, View } from 'react-native';
import { KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';

import { makeStyles } from '@/theme/make-styles';
import { MIN_TOUCH, RADII, SPACING, STROKE } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import type { LayoutChangeEvent } from 'react-native';

const BAR_PADDING_BLOCK = SPACING.xs;

/**
 * The bar's height at the default text size: a MIN_TOUCH button, the block padding and the top
 * hairline. The measured height replaces it once the bar is on screen.
 */
export const KEYBOARD_DONE_BAR_MIN_HEIGHT = MIN_TOUCH + BAR_PADDING_BLOCK * 2 + STROKE.hair;

export type KeyboardDoneBarProps = {
  /** Part: `.done`. */
  readonly testID: string;
  /** Translated ("Done"); the button's text and accessible name. */
  readonly label: string;
  /** From the app's reduce-motion hook, via the screen model. */
  readonly isReducedMotion: boolean;
  /** The bar's measured height, for the scroll view's bottomOffset (useDoneBarSpace). */
  readonly onHeightChange?: ((height: number) => void) | undefined;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    bar: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingInline: SPACING.md,
      paddingBlock: BAR_PADDING_BLOCK,
      borderTopWidth: STROKE.hair,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    face: { paddingInline: SPACING.lg, justifyContent: 'center' },
  });
  return styles;
});

function dismissKeyboard(): void {
  Keyboard.dismiss();
}

export function KeyboardDoneBar(props: KeyboardDoneBarProps): React.JSX.Element | null {
  const styles = useStyles();
  const theme = useTheme();
  const isVisible = useKeyboardState((state) => state.isVisible);
  if (!isVisible) return null;
  const { onHeightChange } = props;
  const onLayout =
    onHeightChange === undefined
      ? undefined
      : (event: LayoutChangeEvent): void => {
          onHeightChange(event.nativeEvent.layout.height);
        };
  return (
    <KeyboardStickyView>
      <View style={styles.bar} testID={props.testID} onLayout={onLayout}>
        <PressableSurface
          label={props.label}
          onPress={dismissKeyboard}
          testID={`${props.testID}.done`}
          radius={RADII.md}
          fill={theme.colors.surface}
          isReducedMotion={props.isReducedMotion}
          faceStyle={styles.face}
        >
          <AppText variant="label">{props.label}</AppText>
        </PressableSurface>
      </View>
    </KeyboardStickyView>
  );
}
