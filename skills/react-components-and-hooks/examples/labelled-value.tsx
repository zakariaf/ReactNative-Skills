// Example (shape only, never copied into the app): a presentational src/ui/ component.
// One named export per file, read-only props, strings that arrive translated and formatted, themed
// styles through makeStyles, one testID with derived part testIDs, a slot instead of a variant flag,
// no store, feature or service import, no logic beyond layout.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { SPACING } from '@/theme/tokens';

import { AppText } from './app-text';

import type { ReactNode } from 'react';

export type LabelledValueProps = {
  /** Already translated by the model hook: "Done this week". */
  readonly label: string;
  /** Already formatted in the app's digits: "12" or "١٢". */
  readonly value: string;
  /** The root testID; parts append a segment: `<testID>.label`, `<testID>.value`. */
  readonly testID: string;
  /** A slot instead of a variant flag: a badge or an icon placed after the value. */
  readonly accessory?: ReactNode;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    root: { gap: SPACING.xxs },
    valueRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    divider: { borderBottomColor: theme.colors.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  });
  return styles;
});

export function LabelledValue({ label, value, testID, accessory }: LabelledValueProps): ReactNode {
  const styles = useStyles();
  return (
    <View style={[styles.root, styles.divider]} testID={testID}>
      <View style={styles.valueRow}>
        <AppText variant="title" testID={`${testID}.value`}>
          {value}
        </AppText>
        {accessory}
      </View>
      <AppText variant="caption" tone="muted" testID={`${testID}.label`}>
        {label}
      </AppText>
    </View>
  );
}
