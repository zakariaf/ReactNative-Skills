// src/ui/labelled-value.tsx: a presentational component with one testID and derived part ids.
import { StyleSheet, View } from 'react-native';

import { AppText } from './app-text';

import type { ReactNode } from 'react';

export type LabelledValueProps = {
  /** Already translated by the model hook. */
  readonly label: string;
  /** Already formatted in the app's digits. */
  readonly value: string;
  readonly testID: string;
  /** A slot instead of a variant flag. */
  readonly accessory?: ReactNode;
  readonly tags: readonly string[];
};

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 8 } });

export function LabelledValue({ label, value, testID, accessory }: LabelledValueProps): ReactNode {
  return (
    <View testID={testID}>
      <View style={styles.row}>
        <AppText testID={`${testID}.value`}>{value}</AppText>
        {accessory}
      </View>
      <AppText testID={`${testID}.label`}>{label}</AppText>
    </View>
  );
}
