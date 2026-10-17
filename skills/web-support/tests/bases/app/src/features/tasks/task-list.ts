// src/features/tasks/task-list.ts
/** The rows inside a scroll window: a parameter named window is not the browser's window. */
export function visibleCount(window: { readonly start: number; readonly end: number }): number {
  return window.end - window.start;
}
