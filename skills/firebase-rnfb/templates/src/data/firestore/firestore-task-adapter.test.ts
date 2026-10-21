// src/data/firestore/firestore-task-adapter.test.ts
// Runs against the root mock __mocks__/@react-native-firebase/firestore.ts: proves one batch per
// action, merge writes, a commit that is sent and not awaited, and a listener whose unsubscribe returns.
import * as firestore from '@react-native-firebase/firestore';

import { createFirestoreTaskAdapter } from './firestore-task-adapter';

import type { Firestore } from '@react-native-firebase/firestore';

type MockBatch = { set: jest.Mock; commit: jest.Mock };

const mocked = jest.mocked(firestore);
const db = {} as Firestore;

function lastBatch(): MockBatch {
  const batch: unknown = mocked.writeBatch.mock.results.at(-1)?.value;
  return batch as MockBatch;
}

describe('createFirestoreTaskAdapter', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('adds a task and moves the list count in one merged batch, without waiting for the server', () => {
    const adapter = createFirestoreTaskAdapter({ db, uid: 'u1', onWriteRejected: jest.fn() });

    const result = adapter.addTask({ listId: 'inbox', title: ' Buy milk ' });

    expect(result.ok).toBe(true);
    expect(mocked.writeBatch).toHaveBeenCalledTimes(1);
    const batch = lastBatch();
    expect(batch.set).toHaveBeenCalledTimes(2);
    expect(batch.set.mock.calls.map((call: unknown[]) => call[2])).toStrictEqual([
      { merge: true },
      { merge: true },
    ]);
    expect(batch.set.mock.calls[0]?.[1]).toMatchObject({
      listId: 'inbox',
      title: 'Buy milk',
      isDone: false,
    });
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('refuses an invalid draft before anything is written', () => {
    const adapter = createFirestoreTaskAdapter({ db, uid: 'u1', onWriteRejected: jest.fn() });

    expect(adapter.addTask({ listId: '', title: 'Buy milk' })).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-task', field: 'listId' },
    });
    expect(mocked.writeBatch).not.toHaveBeenCalled();
  });

  it('reports a write the server refuses later', async () => {
    const onWriteRejected = jest.fn();
    const adapter = createFirestoreTaskAdapter({ db, uid: 'u1', onWriteRejected });
    mocked.writeBatch.mockReturnValueOnce({
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn(() =>
        Promise.reject(Object.assign(new Error('denied'), { code: 'firestore/permission-denied' })),
      ),
    });

    adapter.setDone({ id: 't1', listId: 'inbox' }, true);
    await Promise.resolve();
    await Promise.resolve();

    expect(onWriteRejected).toHaveBeenCalledWith({
      kind: 'write-rejected',
      taskId: 't1',
      code: 'firestore/permission-denied',
    });
  });

  it('returns the snapshot listener unsubscribe and skips documents that do not parse', () => {
    const unsubscribe = jest.fn();
    mocked.onSnapshot.mockReturnValueOnce(unsubscribe);
    const adapter = createFirestoreTaskAdapter({ db, uid: 'u1', onWriteRejected: jest.fn() });
    const onTasks = jest.fn();

    expect(adapter.watchList('inbox', { onTasks, onError: jest.fn() })).toBe(unsubscribe);

    const onNext = mocked.onSnapshot.mock.calls[0]?.[1] as unknown as (snapshot: unknown) => void;
    const data = jest.fn((id: string) =>
      id === 't1'
        ? {
            listId: 'inbox',
            title: 'Buy milk',
            isDone: false,
            updatedAt: { seconds: 2, nanoseconds: 5e6 },
          }
        : { title: 7 },
    );
    onNext({ docs: ['t1', 't2'].map((id) => ({ id, data: () => data(id) })) });

    expect(onTasks).toHaveBeenCalledWith([
      { id: 't1', listId: 'inbox', title: 'Buy milk', isDone: false, updatedAtMs: 2005 },
    ]);
  });
});
