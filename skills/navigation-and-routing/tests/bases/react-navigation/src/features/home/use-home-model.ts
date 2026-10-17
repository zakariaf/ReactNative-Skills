// src/features/home/use-home-model.ts
import { useNavigation } from '@react-navigation/native';

export function useHomeModel(): { readonly onOpenTask: (taskId: string) => void; readonly onCompose: () => void } {
  const navigation = useNavigation();
  return {
    onOpenTask: (taskId) => {
      navigation.navigate('TaskDetail', { taskId });
    },
    onCompose: () => {
      navigation.navigate('Compose');
    },
  };
}
