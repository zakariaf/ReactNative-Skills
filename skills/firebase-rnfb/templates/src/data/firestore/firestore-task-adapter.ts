// src/data/firestore/firestore-task-adapter.ts
// TaskStorePort over React Native Firebase Firestore (modular API). Each user action is one
// writeBatch: it lands in the offline cache at once and is queued for the server, and the commit is
// never awaited (offline it would stay pending until the server answers). No runTransaction: a
// transaction needs the server and fails offline. Every write merges, so fields a newer app version
// added survive. Reads use estimated server timestamps (set on the instance) and are checked.
import {
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';
import * as v from 'valibot';

import { err, ok } from '@/core/result';
import { decodeTask, TASK_DRAFT } from '@/data/firestore/task-doc-codec';

import type {
  Task,
  TaskDraft,
  TaskListListener,
  TaskStorePort,
  TaskWriteRejection,
  Unsubscribe,
} from '@/data/tasks/task-store-port';
import type { CollectionReference, Firestore, WriteBatch } from '@react-native-firebase/firestore';

export type FirestoreTaskAdapterDeps = {
  readonly db: Firestore;
  /** The signed-in user's id: every document lives under users/{uid}/. */
  readonly uid: string;
  /** Called when the server refuses a write that already left the cache. */
  readonly onWriteRejected: (rejection: TaskWriteRejection) => void;
};

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'unknown';
}

type Collections = {
  readonly deps: FirestoreTaskAdapterDeps;
  readonly tasks: CollectionReference;
  readonly lists: CollectionReference;
};

/** Sends the batch without waiting: the cache has it now, the server answers whenever it can. */
function send(deps: FirestoreTaskAdapterDeps, batch: WriteBatch, taskId: string): void {
  void batch.commit().catch((error: unknown) => {
    deps.onWriteRejected({ kind: 'write-rejected', taskId, code: errorCode(error) });
  });
}

function addTask(at: Collections, draft: TaskDraft): ReturnType<TaskStorePort['addTask']> {
  const parsed = v.safeParse(TASK_DRAFT, draft);
  if (!parsed.success) {
    return err({
      kind: 'invalid-task',
      field: parsed.issues[0].path?.[0]?.key === 'listId' ? 'listId' : 'title',
    });
  }
  const { listId, title } = parsed.output;
  const ref = doc(at.tasks);
  const batch = writeBatch(at.deps.db);
  batch.set(ref, { listId, title, isDone: false, updatedAt: serverTimestamp() }, { merge: true });
  batch.set(
    doc(at.lists, listId),
    { openCount: increment(1), updatedAt: serverTimestamp() },
    { merge: true },
  );
  send(at.deps, batch, ref.id);
  return ok({ id: ref.id });
}

function setDone(at: Collections, task: Pick<Task, 'id' | 'listId'>, isDone: boolean): void {
  const batch = writeBatch(at.deps.db);
  batch.set(doc(at.tasks, task.id), { isDone, updatedAt: serverTimestamp() }, { merge: true });
  const openCount = increment(isDone ? -1 : 1);
  batch.set(
    doc(at.lists, task.listId),
    { openCount, updatedAt: serverTimestamp() },
    { merge: true },
  );
  send(at.deps, batch, task.id);
}

/** Returns onSnapshot's unsubscribe, so the caller's effect can hand it back to React. */
function watchList(at: Collections, listId: string, listener: TaskListListener): Unsubscribe {
  return onSnapshot(
    query(at.tasks, where('listId', '==', listId)),
    (snapshot) => {
      const decoded = snapshot.docs.map((entry) =>
        decodeTask(entry.id, entry.data({ serverTimestamps: 'estimate' })),
      );
      listener.onTasks(decoded.filter((task): task is Task => task !== null));
    },
    (error) => {
      listener.onError({ kind: 'watch-failed', code: errorCode(error) });
    },
  );
}

export function createFirestoreTaskAdapter(deps: FirestoreTaskAdapterDeps): TaskStorePort {
  const at: Collections = {
    deps,
    tasks: collection(deps.db, 'users', deps.uid, 'tasks'),
    lists: collection(deps.db, 'users', deps.uid, 'lists'),
  };
  return {
    addTask: (draft) => addTask(at, draft),
    setDone: (task, isDone) => {
      setDone(at, task, isDone);
    },
    watchList: (listId, listener) => watchList(at, listId, listener),
  };
}
