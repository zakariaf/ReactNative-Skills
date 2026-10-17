// src/data/document/document-service.ts: the single writer of the app document. Stores call update(); nothing else writes.
import { encodeAppDocument, validateAppDocument } from '@/data/document/document-codec';

import type { LoadPlan } from '@/data/document/document-load-plan';
import type { DocumentStore, SlotName } from '@/data/document/document-store';
import type { AppDocument } from '@/data/document/schema/app-document';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** Premium turns off only with an explicit revocation date: never by a reset, never by absence. */
export function keepPremiumUnlessRevoked(previous: AppDocument, next: AppDocument): AppDocument {
  const isLost = previous.premium.owned && !next.premium.owned;
  return isLost && next.premium.revokedAtMs === null
    ? { ...next, premium: previous.premium }
    : next;
}

export type DocumentServiceDeps = {
  readonly store: DocumentStore;
  /** Only the write time is read (written_at_ms, quarantined_at_ms). */
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  readonly appVersion: string;
  /** Development and preview builds: an invalid document throws (loud in Jest, E2E and the kill test). */
  readonly isStrict: boolean;
};

export type DocumentService = {
  readonly doc: () => AppDocument;
  /**
   * Guard -> validate -> write `current` in one transaction; with refreshBackup, `backup` too.
   * true when the change reached the disk; false when it did not: a document from a newer build
   * (read-only), a rejected document, a write the store refused, or one a pending quarantine copy
   * held back. A caller that must not go on before the change is on disk (finishing a purchase)
   * reads it; per-change writes may ignore it and let didLastWriteFail() drive the UI.
   */
  readonly update: (
    recipe: (doc: AppDocument) => AppDocument,
    options?: { readonly refreshBackup: boolean },
  ) => boolean;
  readonly applyLoadWrites: () => void;
  readonly isReadOnly: () => boolean;
  /**
   * true after the store refused the last write (SQLITE_FULL, an I/O error): the error is in the
   * error log and the session goes on in memory; false again once a write lands. The UI may read
   * it to say changes are not being saved.
   */
  readonly didLastWriteFail: () => boolean;
};

/**
 * What became of one write: 'rejected' (invalid: nothing written; logged, or thrown in strict
 * builds), 'held' (a pending quarantine copy blocks every write), 'refused' (the store threw;
 * logged) or 'written'. Only a rejected document is kept out of memory.
 */
type WriteResult = 'rejected' | 'held' | 'refused' | 'written';

/** Runs one store call; a throw is recorded and becomes false, never a crash at startup. */
type Attempt = (write: () => void) => boolean;

type QuarantineQueue = {
  /** Copies a damaged slot to quarantine now, or keeps the copy pending when the store refuses. */
  readonly add: (slot: SlotName, reason: string) => void;
  /** Retries every pending copy; true when none is left. */
  readonly flush: () => boolean;
};

/**
 * A quarantine copy is the only copy of a damaged slot, so no slot is written while one is still
 * pending: the write that would overwrite the evidence waits until its copy has landed.
 */
function createQuarantineQueue(deps: DocumentServiceDeps, attempt: Attempt): QuarantineQueue {
  let pending: readonly { readonly slot: SlotName; readonly reason: string }[] = [];
  const flush = (): boolean => {
    pending = pending.filter(
      (copy) =>
        !attempt(() => {
          deps.store.quarantine(copy.slot, copy.reason, deps.clock.nowMs());
        }),
    );
    return pending.length === 0;
  };
  const add = (slot: SlotName, reason: string): void => {
    pending = [...pending, { slot, reason }];
    flush();
  };
  return { add, flush };
}

type Writer = {
  readonly write: (next: AppDocument, isWithBackup: boolean) => WriteResult;
  readonly quarantine: (slot: SlotName, reason: string) => void;
  readonly didLastWriteFail: () => boolean;
};

/**
 * Validates, encodes and writes; the write counter keeps rising across launches. A held or refused
 * write lets the session go on in memory. A backup refresh that did not land stays due: every later
 * write includes the backup until one lands, so a reset or a Premium change always reaches it.
 */
function createWriter(deps: DocumentServiceDeps, writeCountBase: number): Writer {
  let writeCount = writeCountBase;
  let didFail = false;
  let isBackupDue = false;
  const attempt: Attempt = (work) => {
    try {
      work();
      return true;
    } catch (error: unknown) {
      // Never a crash loop: startup writes run on every launch, and a throw here would stop every
      // launch while the disk is full. The next write that lands clears the flag.
      didFail = true;
      deps.errorLog.record('storage', error);
      return false;
    }
  };
  const quarantines = createQuarantineQueue(deps, attempt);
  const write = (next: AppDocument, isWithBackup: boolean): WriteResult => {
    const checked = validateAppDocument(next);
    if ('error' in checked) {
      const error = new Error(`invalid document not written: ${checked.error}`);
      deps.errorLog.record('storage', error);
      if (deps.isStrict) throw error;
      return 'rejected';
    }
    isBackupDue = isBackupDue || isWithBackup;
    if (!quarantines.flush()) return 'held';
    writeCount += 1;
    const meta = { appVersion: deps.appVersion, writtenAtMs: deps.clock.nowMs(), writeCount };
    const record = encodeAppDocument(checked.doc, meta);
    const slots = isBackupDue ? { current: record, backup: record } : { current: record };
    const isWritten = attempt(() => {
      deps.store.write(slots);
    });
    if (!isWritten) return 'refused';
    didFail = false;
    isBackupDue = false;
    return 'written';
  };
  return { write, quarantine: quarantines.add, didLastWriteFail: () => didFail };
}

export function createDocumentService(
  deps: DocumentServiceDeps,
  plan: LoadPlan,
  writeCountBase: number,
): DocumentService {
  // Keep only what the closures read, so the loaded plan is not held all session.
  const { isReadOnly, writes } = plan;
  let doc = plan.doc;
  const writer = createWriter(deps, writeCountBase);
  return {
    doc: () => doc,
    update: (recipe, options) => {
      const next = keepPremiumUnlessRevoked(doc, recipe(doc));
      if (isReadOnly) {
        doc = next; // a newer build's document plays on in memory and is never written
        return false;
      }
      const result = writer.write(next, options?.refreshBackup === true);
      // A rejected document never becomes the one in memory: the app keeps the last valid one.
      if (result !== 'rejected') doc = next;
      return result === 'written';
    },
    applyLoadWrites: () => {
      for (const write of writes) {
        if (write.kind === 'quarantine') writer.quarantine(write.slot, write.reason);
        else writer.write(doc, true);
      }
    },
    isReadOnly: () => isReadOnly,
    didLastWriteFail: writer.didLastWriteFail,
  };
}
