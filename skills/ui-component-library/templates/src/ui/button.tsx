// src/ui/button.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { BusyIndicator } from './busy-indicator';
import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';
import { variantPaint } from './variant-paint';

import type { IconSlot } from './icon-slot';
import type { ButtonVariant, VariantPaint } from './variant-paint';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

const BUTTON = COMPONENT_SPECS.button;

export type ButtonProps = {
  /** Translated; also the accessible name. */
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  /** From the reduce-motion hook (accessibility-as-code), passed down by the screen model. */
  readonly isReducedMotion: boolean;
  /** Default 'secondary'. One 'primary' per screen: the action the screen exists for. */
  readonly variant?: ButtonVariant;
  /** 'large' is the screen's main call to action (always a block). */
  readonly size?: 'regular' | 'large';
  /** An icon before the label. */
  readonly icon?: IconSlot;
  /** An icon after the label (a forward arrow: Next, Continue). */
  readonly iconEnd?: IconSlot;
  /** Stretch to the width of the column. */
  readonly isBlock?: boolean;
  /** Share a row with other buttons (a dialog's buttons): grow from a basis, wrap at large text. */
  readonly isInRow?: boolean;
  readonly isDisabled?: boolean;
  /** Keeps the label, shows the busy blocks in place of the icon, ignores presses. */
  readonly isBusy?: boolean;
  /** Translated; only when the result is not obvious from the label. */
  readonly hint?: string;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    face: {
      minHeight: BUTTON.minHeight,
      paddingBlock: BUTTON.paddingBlock,
      paddingInline: BUTTON.paddingInline,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: BUTTON.gap,
    },
    large: { minHeight: BUTTON.minHeightLarge },
    label: { flexShrink: 1 },
    block: { alignSelf: 'stretch' },
    inline: { alignSelf: 'flex-start' },
    inRow: { flexGrow: 1, flexShrink: 1, flexBasis: BUTTON.rowMinBasis },
  });
  return styles;
});

type Styles = ReturnType<typeof useStyles>;

function startSlot(props: ButtonProps, paint: VariantPaint): ReactNode {
  if (props.isBusy === true) {
    return <BusyIndicator color={paint.content} isReducedMotion={props.isReducedMotion} />;
  }
  return props.icon?.({ size: BUTTON.icon, color: paint.content }) ?? null;
}

function layoutStyleOf(props: ButtonProps, styles: Styles): StyleProp<ViewStyle> {
  if (props.isInRow === true) return styles.inRow;
  return props.size === 'large' || props.isBlock === true ? styles.block : styles.inline;
}

/** A labelled button: primary, secondary or danger; regular or large; busy and disabled states. */
export function Button(props: ButtonProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const isDisabled = props.isDisabled === true;
  const paint = variantPaint(theme, props.variant ?? 'secondary', isDisabled);
  return (
    <PressableSurface
      label={props.label}
      onPress={props.onPress}
      testID={props.testID}
      radius={BUTTON.radius}
      fill={paint.fill}
      edgeColor={paint.edge}
      edgeWidth={BUTTON.border}
      isReducedMotion={props.isReducedMotion}
      isDisabled={isDisabled}
      isBusy={props.isBusy === true}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      faceStyle={[styles.face, props.size === 'large' && styles.large]}
      layoutStyle={layoutStyleOf(props, styles)}
      isStretched={props.isInRow === true}
    >
      {startSlot(props, paint)}
      <View style={styles.label}>
        <AppText
          variant="buttonLabel"
          tone={paint.tone}
          align="center"
          testID={`${props.testID}.label`}
        >
          {props.label}
        </AppText>
      </View>
      {props.iconEnd?.({ size: BUTTON.icon, color: paint.content }) ?? null}
    </PressableSurface>
  );
}
