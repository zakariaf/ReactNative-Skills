// test/rules/storage.rules.test.ts
import {
  assertFails,
  assertSucceeds,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

import { createRulesTestEnvironment } from './rules-test-env';

// One describe per match block of storage.rules, titled with its path as the rules file writes it
// below /b/{bucket}/o.

const OWNER = 'user-a';
const OTHER = 'user-b';
const MIB = 1024 * 1024;

let testEnv: RulesTestEnvironment;

/** Storage as `uid` sees it, or as a signed-out client for null. */
function storageAs(uid: string | null): ReturnType<RulesTestContext['storage']> {
  const context =
    uid === null ? testEnv.unauthenticatedContext() : testEnv.authenticatedContext(uid);
  return context.storage();
}

/** A file of `size` bytes; the content does not matter to the rules, only its size and type. */
function bytes(size: number): Uint8Array {
  return new Uint8Array(size);
}

async function seed(path: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), path), bytes(16), { contentType: 'image/png' });
  });
}

describe('storage.rules', () => {
  beforeAll(async () => {
    testEnv = await createRulesTestEnvironment('storage');
  });

  afterEach(async () => {
    await testEnv.clearStorage();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('users/{uid}/attachments/{fileName}', () => {
    const path = `users/${OWNER}/attachments/photo-1.png`;

    it('lets the owner upload an accepted image under the cap', async () => {
      await assertSucceeds(
        uploadBytes(ref(storageAs(OWNER), path), bytes(1024), { contentType: 'image/png' }),
      );
    });

    it('denies another user, a signed-out client, a wrong type and an oversized file', async () => {
      await assertFails(
        uploadBytes(ref(storageAs(OTHER), path), bytes(1024), { contentType: 'image/png' }),
      );
      await assertFails(
        uploadBytes(ref(storageAs(null), path), bytes(1024), { contentType: 'image/png' }),
      );
      await assertFails(
        uploadBytes(ref(storageAs(OWNER), path), bytes(1024), { contentType: 'application/pdf' }),
      );
      await assertFails(
        uploadBytes(ref(storageAs(OWNER), path), bytes(5 * MIB), { contentType: 'image/png' }),
      );
    });

    it('lets only the owner read and delete', async () => {
      await seed(path);
      await assertSucceeds(getBytes(ref(storageAs(OWNER), path)));
      await assertFails(getBytes(ref(storageAs(OTHER), path)));
      await assertFails(deleteObject(ref(storageAs(OTHER), path)));
      await assertSucceeds(deleteObject(ref(storageAs(OWNER), path)));
    });
  });
});
