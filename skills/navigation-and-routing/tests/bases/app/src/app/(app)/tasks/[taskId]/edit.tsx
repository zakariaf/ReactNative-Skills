// src/app/(app)/tasks/[taskId]/edit.tsx
import { TaskEditorScreen } from '@/features/task-editor/task-editor-screen';
import { useTaskEditorModel } from '@/features/task-editor/use-task-editor-model';

export default function TaskEditorRoute(): React.JSX.Element {
  const model = useTaskEditorModel();
  return <TaskEditorScreen onSave={model.onSave} />;
}
