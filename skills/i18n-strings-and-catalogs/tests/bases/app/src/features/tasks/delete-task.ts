// src/features/tasks/delete-task.ts
import { Alert } from 'react-native';

import type { TFunction } from '@/i18n/create-t';

export function confirmDelete(t: TFunction, onConfirm: () => void): void {
  Alert.alert(t('tasks.delete.title'), t('tasks.delete.body'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('common.delete'), style: 'destructive', onPress: onConfirm },
  ]);
}
