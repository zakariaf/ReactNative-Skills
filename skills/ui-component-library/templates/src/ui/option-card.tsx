// src/ui/option-card.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { STROKE } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';
import { RadioMark } from './radio-mark';

import type { ReactNode } from 'react';

const OPTION = COMPONENT_SPECS.optionCard;

export type OptionCardProps = {
  /** Translated; also the accessible name. */
  readonly label: string;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  readonly description?: string;
  /** The label's own language when it is not the UI's (an autonym in a language picker). */
  readonly labelLanguage?: string;
  /** A small hugging badge ("Recommended"), centred in the row. */
  readonly badge?: ReactNode;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    face: {
      minHeight: OPTION.minHeight,
      paddingBlock: OPTION.paddingBlock,
      paddingInline: OPTION.paddingInline,
      gap: OPTION.gap,
      flexDirection: 'row',
      alignItems: 'center',
    },
    block: { alignSelf: 'stretch' },
    text: { flex: 1 },
    // A hugging badge sets alignSelf on itself, which beats the row's alignItems: centre it here.
    badge: { alignSelf: 'center' },
  });
  return styles;
});

/** One choice of a list of choices (a radio): label, optional description and badge, a radio mark. */
export function OptionCard(props: OptionCardProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <PressableSurface
      label={props.label}
      onPress={props.onSelect}
      testID={props.testID}
      accessibilityRole="radio"
      isSelected={props.isSelected}
      radius={OPTION.radius}
      fill={theme.colors.surface}
      edgeColor={props.isSelected ? theme.colors.primary : theme.colors.border}
      edgeWidth={props.isSelected ? STROKE.bold : STROKE.regular}
      isReducedMotion={props.isReducedMotion}
      faceStyle={styles.face}
      layoutStyle={styles.block}
    >
      <View style={styles.text}>
        <AppText
          variant="rowLabel"
          testID={`${props.testID}.label`}
          {...(props.labelLanguage === undefined ? {} : { language: props.labelLanguage })}
        >
          {props.label}
        </AppText>
        {props.description === undefined ? null : (
          <AppText variant="rowDescription" tone="muted" testID={`${props.testID}.description`}>
            {props.description}
          </AppText>
        )}
      </View>
      {props.badge === undefined ? null : <View style={styles.badge}>{props.badge}</View>}
      <RadioMark isSelected={props.isSelected} testID={`${props.testID}.radio`} />
    </PressableSurface>
  );
}
