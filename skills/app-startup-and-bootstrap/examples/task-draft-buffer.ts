// src/features/task-editor/task-draft-buffer.ts (a shape to imitate, not a template)
// A buffered writer: the task editor saves the title 500 ms after the last key instead of on every
// key. Because it holds a write back, it hands a Flusher to the app root, and useFlushOnBackground
// commits the pending draft when the app leaves the foreground (an iOS swipe-kill from the app
// switcher sends no 'background' event). The write is the repository's synchronous call, so a flush
// has committed when it returns. startApp creates the buffer once and returns its flusher:
//   const drafts = createTaskDraftBuffer({ save: (draft) => data.drafts.save(draft) });
//   return { data, gate, flushers: [drafts.flusher], drafts };
import type { Result } from '@/core/result';
import type { Flusher } from '@/features/root-navigator/background-flush';

export type TaskDraft = { readonly taskId: number; readonly title: string };

export type TaskDraftBufferDeps = {
  /** Synchronous: committed when it returns ok (a repository method). */
  readonly save: (draft: TaskDraft) => Result<void, { readonly kind: string }>;
  /** Injected so tests use fake timers or a manual scheduler. */
  readonly schedule?: (run: () => void, afterMs: number) => () => void;
  readonly debounceMs?: number;
};

export type TaskDraftBuffer = {
  /** Keeps the latest draft and (re)starts the debounce timer. */
  readonly write: (draft: TaskDraft) => void;
  /** Handed to the app root: commits the pending draft at once, if any. */
  readonly flusher: Flusher;
};

const defaultSchedule = (run: () => void, afterMs: number): (() => void) => {
  const timer = setTimeout(run, afterMs);
  return () => {
    clearTimeout(timer);
  };
};

export function createTaskDraftBuffer(deps: TaskDraftBufferDeps): TaskDraftBuffer {
  const schedule = deps.schedule ?? defaultSchedule;
  const debounceMs = deps.debounceMs ?? 500;
  let pending: TaskDraft | null = null;
  let cancel: (() => void) | null = null;

  const flush = (): void => {
    cancel?.();
    cancel = null;
    if (pending === null) return;
    const draft = pending;
    pending = null;
    const saved = deps.save(draft);
    // The repository already recorded an unexpected failure; keep the draft so the next flush retries.
    if (!saved.ok) pending = draft;
  };

  return {
    write: (draft) => {
      pending = draft;
      cancel?.();
      cancel = schedule(flush, debounceMs);
    },
    flusher: { name: 'task-draft', flush },
  };
}
