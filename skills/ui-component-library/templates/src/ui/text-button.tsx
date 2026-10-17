// src/ui/text-button.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';

import type { TextTone } from './app-text';
import type { Theme } from '@/theme/theme-types';
import type { ReactNode } from 'react';

const TEXT_BUTTON = COMPONENT_SPECS.textButton;

export type TextButtonProps = {
  /** Translated; also the accessible name. */
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  /** 'danger' for a quiet destructive action (Remove). Default 'default'. */
  readonly tone?: 'default' | 'danger';
  readonly isDisabled?: boolean;
  readonly hint?: string;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    face: {
      paddingBlock: TEXT_BUTTON.paddingBlock,
      paddingInline: TEXT_BUTTON.paddingInline,
      alignItems: 'center',
    },
    inline: { alignSelf: 'flex-start' },
    // Drawn, not styled: textDecorationLine cannot set a thickness or an offset on iOS or Android,
    // so a design that specifies them gets a bar of the label's colour under the text.
    underline: {
      alignSelf: 'stretch',
      height: TEXT_BUTTON.underlineThickness,
      marginTop: TEXT_BUTTON.underlineOffset,
    },
  });
  return styles;
});

/** The label's tone and the matching ink for the drawn underline. */
function inkOf(
  theme: Theme,
  props: TextButtonProps,
): { readonly tone: TextTone; readonly color: string } {
  if (props.isDisabled === true) return { tone: 'muted', color: theme.colors.textMuted };
  if (props.tone === 'danger') return { tone: 'danger', color: theme.colors.danger };
  return { tone: 'default', color: theme.colors.text };
}

/** A flat, underlined text action for the quieter choice (Not now, Show details). */
export function TextButton(props: TextButtonProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const ink = inkOf(theme, props);
  return (
    <PressableSurface
      label={props.label}
      onPress={props.onPress}
      testID={props.testID}
      radius={RADII.sm}
      fill="transparent"
      edgeWidth={0}
      isReducedMotion={props.isReducedMotion}
      isDisabled={props.isDisabled === true}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      faceStyle={styles.face}
      layoutStyle={styles.inline}
    >
      <View>
        <AppText
          variant="buttonLabel"
          tone={ink.tone}
          align="center"
          testID={`${props.testID}.label`}
        >
          {props.label}
        </AppText>
        <View
          style={[styles.underline, { backgroundColor: ink.color }]}
          testID={`${props.testID}.underline`}
        />
      </View>
    </PressableSurface>
  );
}
