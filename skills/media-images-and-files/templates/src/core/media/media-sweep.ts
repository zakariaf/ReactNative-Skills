// src/core/media/media-sweep.ts
// Which stored files nothing references any more (orphans: left by a crash between writing a file
// and saving its record, by an import the user abandoned, by a record deleted without its file),
// and which referenced files are missing (a broken link to show as a placeholder and report).
// Pure TypeScript: the media sweeper in src/data/media applies the plan.
import type { MediaRef } from '@/core/media/media-ref';

export type MediaSweepPlan = {
  /** Stored files no record references: delete them. Sorted. */
  readonly orphans: readonly MediaRef[];
  /** Referenced files that are not stored: show the placeholder, report once. Sorted. */
  readonly missing: readonly MediaRef[];
};

export type MediaSweepInput = {
  /** Every file in the media folder. */
  readonly stored: readonly MediaRef[];
  /** Every MediaRef the app's records hold (all tables, all drafts). */
  readonly referenced: ReadonlySet<MediaRef>;
  /**
   * Files the importer stored in this process: never orphans. `referenced` is read table by table
   * with awaits, so a file imported (or saved to a table already read) during the sweep is in this set
   * only; files abandoned this session become orphans at the next launch.
   */
  readonly sessionRefs?: ReadonlySet<MediaRef>;
  /**
   * Files a record outside the live tables still needs: the refs held by data-export-and-restore's
   * safety copy (the undo of the last restore) while it exists. Never orphans, so undoing a restore
   * brings its photos back too.
   */
  readonly protectedRefs?: ReadonlySet<MediaRef>;
};

const byName = (left: MediaRef, right: MediaRef): number =>
  left < right ? -1 : Number(left > right);

/** The plan for one sweep (after startup, after a restore); imports may run meanwhile. */
export function planMediaSweep({
  stored,
  referenced,
  sessionRefs,
  protectedRefs,
}: MediaSweepInput): MediaSweepPlan {
  const storedSet = new Set(stored);
  const isKept = (ref: MediaRef): boolean =>
    referenced.has(ref) || (sessionRefs?.has(ref) ?? false) || (protectedRefs?.has(ref) ?? false);
  const orphans = [...storedSet].filter((ref) => !isKept(ref));
  const missing = [...referenced].filter((ref) => !storedSet.has(ref));
  return { orphans: orphans.sort(byName), missing: missing.sort(byName) };
}
