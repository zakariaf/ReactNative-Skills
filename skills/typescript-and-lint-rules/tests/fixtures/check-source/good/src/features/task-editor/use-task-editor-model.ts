// src/features/task-editor/use-task-editor-model.ts
// Example (a shape to imitate): a synchronous handler that starts async work. React Native's Strict
// TypeScript API types onPress as returning unknown, so `onPress={async () => ...}` type-checks and
// no-misused-promises stays silent while a rejection vanishes. The handler returns void and ends the
// task with .catch(reportError); the screen passes it to onPress unchanged.
import { useState } from 'react';

import { useReportError } from '@/services/error-log/use-report-error';
import { useServices } from '@/services/services-context';

import type { TaskDraft } from './task-draft';

/** What the task editor screen renders and calls. */
export type TaskEditorModel = {
  readonly isSaving: boolean;
  readonly handleSave: (draft: TaskDraft) => void;
};

/** The only code of the task editor that reads services; the screen stays a pure view. */
export function useTaskEditorModel(): TaskEditorModel {
  const { tasks } = useServices();
  const reportError = useReportError('service');
  const [isSaving, setIsSaving] = useState(false);
  const save = async (draft: TaskDraft): Promise<void> => {
    setIsSaving(true);
    try {
      await tasks.save(draft);
    } finally {
      setIsSaving(false);
    }
  };
  const handleSave = (draft: TaskDraft): void => {
    save(draft).catch(reportError);
  };
  return { isSaving, handleSave };
}
