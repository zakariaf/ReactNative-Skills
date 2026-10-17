// src/ui/list.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const LIST = COMPONENT_SPECS.list;

export type ListProps = {
  readonly testID: string;
  /** ListRow and SubRow elements; the first row passes isFirst. */
  readonly children: ReactNode;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    list: {
      alignSelf: 'stretch',
      borderRadius: LIST.radius,
      borderWidth: LIST.border,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
  });
  return styles;
});

/**
 * A flat group of rows that clips them to its corners. For a short, bounded group (settings, a
 * form section); a long or data-driven list is a FlatList whose rows are ListRow.
 */
export function List({ testID, children }: ListProps): ReactNode {
  const styles = useStyles();
  return (
    <View style={styles.list} testID={testID}>
      {children}
    </View>
  );
}
