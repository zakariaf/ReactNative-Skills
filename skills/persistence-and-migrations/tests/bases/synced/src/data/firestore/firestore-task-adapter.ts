// src/data/firestore/firestore-task-adapter.ts: tasks in Firestore (React Native Firebase, modular API).
import { collection, doc, getFirestore, onSnapshot, query, where, writeBatch } from '@react-native-firebase/firestore';

import type { Task, TaskStorePort } from '@/data/tasks/task-store-port';

export function createFirestoreTaskAdapter(uid: string): TaskStorePort {
  const db = getFirestore();
  const tasks = collection(db, 'users', uid, 'tasks');
  return {
    saveTask: (task) => {
      const batch = writeBatch(db);
      batch.set(doc(tasks, task.id), task, { merge: true });
      void batch.commit();
    },
    watchList: (listId, onTasks) =>
      onSnapshot(query(tasks, where('listId', '==', listId)), (snapshot) => {
        onTasks(snapshot.docs.map((entry) => entry.data({ serverTimestamps: 'estimate' }) as Task));
      }),
  };
}
