// src/features/tasks/components/task-card.tsx: a component may hold 80 code lines (a .ts function 40).
import { View } from 'react-native';

import { TaskField } from './task-field';

export type TaskCardProps = {
  readonly labels: Readonly<Record<string, string>>;
  readonly values: Readonly<Record<string, string>>;
};

/** All fields of one task, one row each. */
export function TaskCard({ labels, values }: TaskCardProps): React.JSX.Element {
  const title = values['title'] ?? '';
  const isEmpty = title === '';
  if (isEmpty) {
    return <View testID="task-card.empty" />;
  }
  return (
    <View testID="task-card.root">
      <TaskField label={labels.field0} value={values.field0} />
      <TaskField label={labels.field1} value={values.field1} />
      <TaskField label={labels.field2} value={values.field2} />
      <TaskField label={labels.field3} value={values.field3} />
      <TaskField label={labels.field4} value={values.field4} />
      <TaskField label={labels.field5} value={values.field5} />
      <TaskField label={labels.field6} value={values.field6} />
      <TaskField label={labels.field7} value={values.field7} />
      <TaskField label={labels.field8} value={values.field8} />
      <TaskField label={labels.field9} value={values.field9} />
      <TaskField label={labels.field10} value={values.field10} />
      <TaskField label={labels.field11} value={values.field11} />
      <TaskField label={labels.field12} value={values.field12} />
      <TaskField label={labels.field13} value={values.field13} />
      <TaskField label={labels.field14} value={values.field14} />
      <TaskField label={labels.field15} value={values.field15} />
      <TaskField label={labels.field16} value={values.field16} />
      <TaskField label={labels.field17} value={values.field17} />
      <TaskField label={labels.field18} value={values.field18} />
      <TaskField label={labels.field19} value={values.field19} />
      <TaskField label={labels.field20} value={values.field20} />
      <TaskField label={labels.field21} value={values.field21} />
      <TaskField label={labels.field22} value={values.field22} />
      <TaskField label={labels.field23} value={values.field23} />
      <TaskField label={labels.field24} value={values.field24} />
      <TaskField label={labels.field25} value={values.field25} />
      <TaskField label={labels.field26} value={values.field26} />
      <TaskField label={labels.field27} value={values.field27} />
      <TaskField label={labels.field28} value={values.field28} />
      <TaskField label={labels.field29} value={values.field29} />
      <TaskField label={labels.field30} value={values.field30} />
      <TaskField label={labels.field31} value={values.field31} />
      <TaskField label={labels.field32} value={values.field32} />
      <TaskField label={labels.field33} value={values.field33} />
      <TaskField label={labels.title} value={title} />
    </View>
  );
}
