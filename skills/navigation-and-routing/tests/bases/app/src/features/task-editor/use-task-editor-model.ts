// src/features/task-editor/use-task-editor-model.ts
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { useDiscardGuard } from './use-discard-guard';

export function useTaskEditorModel(): { readonly onSave: () => void } {
  const router = useRouter();
  const [title] = useState('');
  const guard = useDiscardGuard(title.length > 0);
  return {
    onSave: () => {
      guard.leave(() => {
        router.back();
      });
    },
  };
}
