// src/features/settings/data-resets.ts
// Pure: what the "Delete all data" row does after its confirmation. It deletes the person's data
// and keeps every setting (and the purchases): it never dispatches a settings action, never names
// the settings storage, and never clears the key-value store, so the theme, language and sound
// choices survive. "Reset settings" is its own row, its own dialog and its own action.
import type { Result } from '@/core/result';

/** The data did not reach the disk deleted: the screen shows settings.delete-all-data.failed. */
export type DataResetFailure = { readonly kind: 'data-not-deleted' };

export type DataResetInput = {
  /**
   * The data layer's reset (persistence-and-migrations: one transaction that keeps the protected
   * tables) written through state-management-zustand's updateAndPublish, so every store re-reads
   * what is on disk once it landed. AppData's reset returns Result<void, StorageFailure> (the raw
   * error is already recorded as 'storage'), so the caller maps the failure at that boundary:
   *
   *   deleteAllData: () =>
   *     updateAndPublish(stores, () => {
   *       const reset = data.resetAllData();
   *       return reset.ok ? reset : err({ kind: 'data-not-deleted' });
   *     }),
   */
  readonly deleteAllData: () => Result<void, DataResetFailure>;
  /**
   * After a reset that landed: server state cached on the device is fetched again, for example
   * `() => { queryClient.invalidateQueries().catch(reportError); }`; a no-op without TanStack Query.
   */
  readonly refetchServerState: () => void;
};

export type DataResets = {
  /** Runs the reset once; the cache is refetched only when the reset reached the disk. */
  readonly onConfirmDeleteAllData: () => Result<void, DataResetFailure>;
};

export function createDataResets(input: DataResetInput): DataResets {
  return {
    onConfirmDeleteAllData: () => {
      const reset = input.deleteAllData();
      if (reset.ok) input.refetchServerState();
      return reset;
    },
  };
}
