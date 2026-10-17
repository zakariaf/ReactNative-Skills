// src/features/tasks/tasks-screen.tsx
import { View } from 'react-native';

import { Icon } from '@/ui/icons/icon';
import { AppText } from '@/ui/app-text';

export type TasksScreenProps = { readonly title: string; readonly emptyText: string };

export function TasksScreen({ title, emptyText }: TasksScreenProps): React.JSX.Element {
  return (
    <View>
      <AppText>{title}</AppText>
      <Icon name="check" color="#15171C" />
      <AppText>{emptyText}</AppText>
    </View>
  );
}
