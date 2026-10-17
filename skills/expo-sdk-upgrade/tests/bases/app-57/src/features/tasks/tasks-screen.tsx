// src/features/tasks/tasks-screen.tsx
import { Modal, View } from 'react-native';

type TasksScreenProps = { readonly isEditorOpen: boolean };

export function TasksScreen({ isEditorOpen }: TasksScreenProps): React.JSX.Element {
  return (
    <View>
      <Modal visible={isEditorOpen} animationType="fade" transparent>
        <View />
      </Modal>
    </View>
  );
}
