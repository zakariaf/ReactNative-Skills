// src/features/root-navigator/route-params.ts (React Navigation static API): the params of the routes
// that take any. Small, serialisable data only: ids and plain values that survive state restore and a
// deep link. The screen reads the task itself from its store.
export type TaskDetailParams = { readonly taskId: string };

export type TaskEditorParams = { readonly taskId: string } | { readonly listId: string };
