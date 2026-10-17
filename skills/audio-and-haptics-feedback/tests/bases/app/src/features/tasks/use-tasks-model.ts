// src/features/tasks/use-tasks-model.ts (stand-in): events play rows of the cue table; saves play
// the success and error moments.
import { playCue } from '@/services/feedback/play-cue';
import { playUiFeedback } from '@/services/feedback/ui-feedback';

import { TASKS_FEEDBACK } from './tasks-feedback';

import type { FeedbackPorts } from '@/services/feedback/play-cue';

export function onTaskCompleted(ports: FeedbackPorts): void {
  playCue(ports, TASKS_FEEDBACK['task-completed']);
}

export function onTaskSaved(ports: FeedbackPorts, isSaved: boolean): void {
  playUiFeedback(ports, isSaved ? 'success' : 'error');
}
