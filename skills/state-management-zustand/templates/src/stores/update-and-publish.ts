// src/stores/update-and-publish.ts: a write that spans several stores: one transaction, then every store re-reads.
import type { Result } from '@/core/result';
import type { Stores } from '@/stores/stores-context';

/**
 * Runs `write` (ONE persisted transaction: a repository method such as removeList, a reset, an
 * import), then every store re-reads what is on disk. A failed write publishes nothing. Never build
 * such a change from several store calls (a kill between them leaves half of it on disk), and never
 * call the write alone (the other stores would keep showing the old rows until the next launch).
 * contracts/stores.json lists these writes under crossStoreWrites.
 */
export function updateAndPublish<TValue, TFailure>(
  stores: Stores,
  write: () => Result<TValue, TFailure>,
): Result<TValue, TFailure> {
  const written = write();
  if (!written.ok) return written;
  stores.lists.getState().reload();
  stores.tasks.getState().reload();
  return written;
}
