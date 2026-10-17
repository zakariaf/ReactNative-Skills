// src/features/tasks/components/task-row.tsx
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/app-text';
import { Icon } from '@/ui/icons/icon';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingStart: 16, paddingEnd: 12, borderTopStartRadius: 12 },
  due: { marginStart: 'auto', marginEnd: 8 },
  badge: { position: 'absolute', top: 4, end: 4 },
});

export type TaskRowProps = {
  readonly title: string;
  readonly dueText: string;
  readonly countText: string;
};

export function TaskRow({ title, dueText, countText }: TaskRowProps): React.JSX.Element {
  return (
    <View style={styles.row} testID="tasks.task-row">
      <AppText>{title}</AppText>
      <View style={[styles.due, { paddingStart: 4 }]}>
        <AppText align="end">{dueText}</AppText>
      </View>
      <View style={styles.badge}>
        <AppText>{countText}</AppText>
      </View>
      <Icon name="chevron" />
    </View>
  );
}
