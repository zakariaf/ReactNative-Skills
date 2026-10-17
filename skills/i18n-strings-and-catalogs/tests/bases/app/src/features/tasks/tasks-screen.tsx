// src/features/tasks/tasks-screen.tsx
import { Button, View } from 'react-native';

import { T } from '@/i18n/t';
import { useT } from '@/i18n/t-context';
import { AppText } from '@/ui/app-text';

export type TasksScreenProps = {
  readonly summary: string;
  readonly page: number;
  readonly isDone: boolean;
  readonly onDelete: () => void;
};

export function TasksScreen({ summary, page, isDone, onDelete }: TasksScreenProps): React.JSX.Element {
  const t = useT();
  return (
    <View>
      <T id="tasks.list.title" testID="tasks.title" />
      <AppText testID="tasks.summary">{summary}</AppText>
      <T id="tasks.page" values={{ page }} />
      <Button
        title={isDone ? t('common.cancel') : t('common.delete')}
        accessibilityLabel={t('tasks.delete.title')}
        onPress={onDelete}
      />
    </View>
  );
}
