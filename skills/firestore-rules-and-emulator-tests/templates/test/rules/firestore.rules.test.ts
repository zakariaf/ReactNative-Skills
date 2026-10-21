// test/rules/firestore.rules.test.ts
import {
  assertFails,
  assertSucceeds,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

import { createRulesTestEnvironment } from './rules-test-env';

// One describe per match block of firestore.rules, titled with its path exactly as the rules file
// writes it: check-rules-tests finds the tests of a block by that title. Each allow has an
// assertSucceeds and each block at least one assertFails.

const OWNER = 'user-a';
const OTHER = 'user-b';
const EARLIER = Timestamp.fromMillis(Date.UTC(2026, 0, 1));

let testEnv: RulesTestEnvironment;

/** The client database as `uid` sees it, or as a signed-out client for null. */
function dbAs(uid: string | null): ReturnType<RulesTestContext['firestore']> {
  const context =
    uid === null ? testEnv.unauthenticatedContext() : testEnv.authenticatedContext(uid);
  return context.firestore();
}

/** Writes a document with the rules off: the state a test starts from, never the thing it proves. */
async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

describe('firestore.rules', () => {
  beforeAll(async () => {
    testEnv = await createRulesTestEnvironment('firestore');
  });

  afterEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('users/{uid}/lists/{listId}', () => {
    const path = `users/${OWNER}/lists/list-1`;
    const newList = (): Record<string, unknown> => ({
      title: 'Groceries',
      createdAt: serverTimestamp(),
    });

    it('lets the owner create a list with the allowed fields', async () => {
      await assertSucceeds(setDoc(doc(dbAs(OWNER), path), newList()));
    });

    it('denies a list in another user folder', async () => {
      await assertFails(setDoc(doc(dbAs(OTHER), path), newList()));
    });

    it('denies a field outside the allow-list', async () => {
      await assertFails(setDoc(doc(dbAs(OWNER), path), { ...newList(), ownerUid: OTHER }));
    });

    it('denies an empty title', async () => {
      await assertFails(setDoc(doc(dbAs(OWNER), path), { ...newList(), title: '' }));
    });

    it('lets the owner rename a list and denies a client-chosen updatedAt', async () => {
      await seed(path, { title: 'Groceries', createdAt: EARLIER });
      await assertSucceeds(
        updateDoc(doc(dbAs(OWNER), path), { title: 'Shopping', updatedAt: serverTimestamp() }),
      );
      await assertFails(
        updateDoc(doc(dbAs(OWNER), path), { title: 'Shopping', updatedAt: EARLIER }),
      );
    });

    it('lets only the owner read and delete a list', async () => {
      await seed(path, { title: 'Groceries', createdAt: EARLIER });
      await assertSucceeds(getDoc(doc(dbAs(OWNER), path)));
      await assertFails(getDoc(doc(dbAs(OTHER), path)));
      await assertFails(deleteDoc(doc(dbAs(OTHER), path)));
      await assertSucceeds(deleteDoc(doc(dbAs(OWNER), path)));
    });
  });

  describe('users/{uid}/tasks/{taskId}', () => {
    const path = `users/${OWNER}/tasks/task-1`;
    const newTask = (): Record<string, unknown> => ({
      title: 'Buy milk',
      done: false,
      createdAt: serverTimestamp(),
    });

    it('lets the owner create a task with the allowed fields', async () => {
      await assertSucceeds(setDoc(doc(dbAs(OWNER), path), { ...newTask(), listId: 'list-1' }));
    });

    it('denies a signed-out create', async () => {
      await assertFails(setDoc(doc(dbAs(null), path), newTask()));
    });

    it('denies a field outside the allow-list', async () => {
      await assertFails(setDoc(doc(dbAs(OWNER), path), { ...newTask(), ownerUid: OTHER }));
    });

    it('denies a wrong type and a client clock', async () => {
      await assertFails(setDoc(doc(dbAs(OWNER), path), { ...newTask(), done: 'yes' }));
      await assertFails(setDoc(doc(dbAs(OWNER), path), { ...newTask(), createdAt: EARLIER }));
    });

    it('lets the owner complete a task and denies rewriting createdAt', async () => {
      await seed(path, { title: 'Buy milk', done: false, createdAt: EARLIER });
      await assertSucceeds(
        updateDoc(doc(dbAs(OWNER), path), { done: true, updatedAt: serverTimestamp() }),
      );
      await assertFails(updateDoc(doc(dbAs(OWNER), path), { createdAt: serverTimestamp() }));
    });

    it('lets only the owner read and delete a task', async () => {
      await seed(path, { title: 'Buy milk', done: false, createdAt: EARLIER });
      await assertSucceeds(getDoc(doc(dbAs(OWNER), path)));
      await assertFails(getDoc(doc(dbAs(OTHER), path)));
      await assertFails(deleteDoc(doc(dbAs(OTHER), path)));
      await assertSucceeds(deleteDoc(doc(dbAs(OWNER), path)));
    });
  });

  describe('users/{uid}/activity/{eventId}', () => {
    const folder = `users/${OWNER}/activity`;
    const event = (): Record<string, unknown> => ({
      kind: 'task-completed',
      taskId: 'task-1',
      at: serverTimestamp(),
    });

    it('lets the owner append an event', async () => {
      await assertSucceeds(addDoc(collection(dbAs(OWNER), folder), event()));
    });

    it('denies an unknown kind and another user', async () => {
      await assertFails(
        addDoc(collection(dbAs(OWNER), folder), { ...event(), kind: 'task-renamed' }),
      );
      await assertFails(addDoc(collection(dbAs(OTHER), folder), event()));
    });

    it('denies every update and delete: the log is append-only', async () => {
      await seed(`${folder}/event-1`, { kind: 'task-completed', taskId: 'task-1', at: EARLIER });
      await assertSucceeds(getDoc(doc(dbAs(OWNER), `${folder}/event-1`)));
      await assertFails(updateDoc(doc(dbAs(OWNER), `${folder}/event-1`), { kind: 'task-created' }));
      await assertFails(deleteDoc(doc(dbAs(OWNER), `${folder}/event-1`)));
    });
  });

  describe('entitlements/{uid}', () => {
    const path = `entitlements/${OWNER}`;

    it('lets the owner read the entitlement the server wrote', async () => {
      await seed(path, { premium: true, updatedAt: EARLIER });
      await assertSucceeds(getDoc(doc(dbAs(OWNER), path)));
      await assertFails(getDoc(doc(dbAs(OTHER), path)));
    });

    it('denies every client write, the owner included', async () => {
      await assertFails(setDoc(doc(dbAs(OWNER), path), { premium: true }));
      await seed(path, { premium: false, updatedAt: EARLIER });
      await assertFails(updateDoc(doc(dbAs(OWNER), path), { premium: true }));
      await assertFails(deleteDoc(doc(dbAs(OWNER), path)));
    });
  });
});
