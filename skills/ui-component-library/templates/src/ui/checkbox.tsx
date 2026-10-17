// src/ui/checkbox.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { CheckMark } from './check-mark';
import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';

import type { ReactNode } from 'react';

const CHECKBOX = COMPONENT_SPECS.checkbox;

export type CheckboxProps = {
  /** Translated name of what it checks ("Complete Buy milk"). */
  readonly label: string;
  readonly isChecked: boolean;
  readonly onToggle: () => void;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  readonly isDisabled?: boolean;
  readonly hint?: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    // The target is the 44 pt face; the drawn box inside it is smaller.
    inline: { alignSelf: 'center' },
    box: {
      width: CHECKBOX.box,
      height: CHECKBOX.box,
      borderRadius: CHECKBOX.radius,
      borderWidth: CHECKBOX.border,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checked: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  });
  return styles;
});

/** A 44 pt checkbox: an empty box, or a filled box with a check (never colour alone). */
export function Checkbox(props: CheckboxProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <PressableSurface
      label={props.label}
      onPress={props.onToggle}
      testID={props.testID}
      accessibilityRole="checkbox"
      isChecked={props.isChecked}
      radius={RADII.sm}
      fill="transparent"
      edgeWidth={0}
      isReducedMotion={props.isReducedMotion}
      isDisabled={props.isDisabled === true}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      layoutStyle={styles.inline}
    >
      <View style={[styles.box, props.isChecked && styles.checked]}>
        {props.isChecked ? (
          <CheckMark color={theme.colors.onPrimary} testID={`${props.testID}.check`} />
        ) : null}
      </View>
    </PressableSurface>
  );
}
