// src/ui/list-group.tsx
import { StyleSheet, View } from 'react-native';

import { List } from './list';
import { SectionHeader } from './section-header';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';

export type ListGroupProps = {
  /** Translated heading. */
  readonly title: string;
  /** The group's id: the header is `<testID>.header`, the list `<testID>.list`. */
  readonly testID: string;
  readonly icon?: IconSlot;
  readonly children: ReactNode;
};

const styles = StyleSheet.create({ group: { alignSelf: 'stretch' } });

/** A section header over a list of rows (a settings group). */
export function ListGroup({ title, testID, icon, children }: ListGroupProps): ReactNode {
  return (
    <View style={styles.group} testID={testID}>
      <SectionHeader
        title={title}
        testID={`${testID}.header`}
        {...(icon === undefined ? {} : { icon })}
      />
      <List testID={`${testID}.list`}>{children}</List>
    </View>
  );
}
