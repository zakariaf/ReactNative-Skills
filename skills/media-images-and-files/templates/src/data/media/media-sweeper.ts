// src/data/media/media-sweeper.ts
// Applies one orphan sweep: removes the partial copies a crash left, lists the media folder, plans
// with planMediaSweep, deletes the orphans and reports the missing files. Run it after startup (once
// the records are readable) and after a restore. It may overlap imports and record saves: every ref the
// importer stored in this process (MediaImporter.sessionRefs()) is kept, whatever `referenced` says,
// and so is every ref the restore's safety copy holds (protectedRefs), so the undo keeps its photos.
import { planMediaSweep } from '@/core/media/media-sweep';
import { ok } from '@/core/result';

import type { MediaRef } from '@/core/media/media-ref';
import type { Result } from '@/core/result';
import type { MediaStoreFailure, MediaStorePort } from '@/services/media-store/media-store-port';

export type MediaSweepReport = {
  /** Orphans deleted. */
  readonly removed: readonly MediaRef[];
  /** Orphans whose delete failed (kept for the next sweep). */
  readonly failed: readonly MediaRef[];
  /** Referenced but not stored: the records show a placeholder. */
  readonly missing: readonly MediaRef[];
  /** Partial copies a crash left mid-import, deleted. */
  readonly partialsRemoved: number;
};

export type SweepMediaRequest = {
  readonly store: MediaStorePort;
  /** Every MediaRef the app's records hold, read from every table that stores one. */
  readonly referenced: ReadonlySet<MediaRef>;
  /** Every ref the importer stored in this process (MediaImporter.sessionRefs()): never deleted. */
  readonly sessionRefs: ReadonlySet<MediaRef>;
  /**
   * Refs held by data-export-and-restore's safety copy (the undo of the last restore) while it
   * exists: never deleted, or the undo would bring back records whose photos are gone. An app
   * without restore passes an empty set.
   */
  readonly protectedRefs: ReadonlySet<MediaRef>;
};

export function sweepMedia({
  store,
  referenced,
  sessionRefs,
  protectedRefs,
}: SweepMediaRequest): Result<MediaSweepReport, MediaStoreFailure> {
  const partials = store.removeStalePartials();
  if (!partials.ok) return partials;
  const stored = store.list();
  if (!stored.ok) return stored;
  const plan = planMediaSweep({ stored: stored.value, referenced, sessionRefs, protectedRefs });
  const removed: MediaRef[] = [];
  const failed: MediaRef[] = [];
  for (const ref of plan.orphans) {
    if (store.remove(ref).ok) removed.push(ref);
    else failed.push(ref);
  }
  return ok({ removed, failed, missing: plan.missing, partialsRemoved: partials.value });
}
