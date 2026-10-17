// src/data/document/document-load-plan.ts: the pure decision of what to load from the two slots, and what to write.
import { decodeSlot } from '@/data/document/document-codec';
import { createDefaultAppDocument } from '@/data/document/schema/default-app-document';

import type { DecodeResult } from '@/data/document/document-codec';
import type { SlotName, SlotRecord } from '@/data/document/document-store';
import type { AppDocument } from '@/data/document/schema/app-document';

/** What the user is told on the first screen, and what the debug view shows. */
export type LoadOutcome =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'loaded' }
  | { readonly kind: 'migrated'; readonly from: number }
  | { readonly kind: 'restored-from-backup'; readonly reason: string }
  | { readonly kind: 'reset-after-damage'; readonly reason: string }
  | { readonly kind: 'newer-version'; readonly found: number };

export type PlannedWrite =
  | { readonly kind: 'quarantine'; readonly slot: SlotName; readonly reason: string }
  /** Write plan.doc into current and backup in one transaction. */
  | { readonly kind: 'write-both' };

/** Pure: the writes run later, through the document service, after startup's reload decisions. */
export type LoadPlan = {
  readonly doc: AppDocument;
  readonly outcome: LoadOutcome;
  readonly writes: readonly PlannedWrite[];
  /** true for a document from a newer build: nothing is written all session. */
  readonly isReadOnly: boolean;
};

export type LoadInput = {
  readonly current: SlotRecord | null;
  readonly backup: SlotRecord | null;
  readonly appId: string;
};

/** The highest write_count seen, so the counter keeps rising across launches. */
export function lastWriteCount(input: LoadInput): number {
  return Math.max(input.current?.writeCount ?? 0, input.backup?.writeCount ?? 0);
}

const MISSING: DecodeResult = { kind: 'damaged', reason: 'missing' };

function fromOk(decoded: Extract<DecodeResult, { kind: 'ok' }>): LoadPlan {
  const outcome: LoadOutcome =
    decoded.migratedFrom === null
      ? { kind: 'loaded' }
      : { kind: 'migrated', from: decoded.migratedFrom };
  return { doc: decoded.doc, outcome, writes: [{ kind: 'write-both' }], isReadOnly: false };
}

function readOnly(appId: string, found: number): LoadPlan {
  return {
    doc: createDefaultAppDocument(appId),
    outcome: { kind: 'newer-version', found },
    writes: [],
    isReadOnly: true,
  };
}

function quarantines(input: LoadInput, reason: string): PlannedWrite[] {
  const slots: SlotName[] = [];
  if (input.current !== null) slots.push('current');
  if (input.backup !== null) slots.push('backup');
  return slots.map((slot) => ({ kind: 'quarantine', slot, reason }));
}

/**
 * current decodes: use it. current (or else backup) is newer: play the default in memory, write
 * nothing. current damaged or missing, backup decodes: quarantine current, restore. Both damaged:
 * quarantine both, start fresh. Both missing: a first launch. Every branch is in the test.
 */
export function planLoad(input: LoadInput): LoadPlan {
  const current = input.current === null ? MISSING : decodeSlot(input.current, input.appId);
  if (current.kind === 'ok') return fromOk(current);
  if (current.kind === 'newer') return readOnly(input.appId, current.version);
  const backup = input.backup === null ? MISSING : decodeSlot(input.backup, input.appId);
  if (backup.kind === 'newer') return readOnly(input.appId, backup.version);
  if (backup.kind === 'ok') {
    const restored = fromOk(backup);
    const bad: PlannedWrite[] =
      input.current === null
        ? []
        : [{ kind: 'quarantine', slot: 'current', reason: current.reason }];
    return {
      ...restored,
      outcome: { kind: 'restored-from-backup', reason: current.reason },
      writes: [...bad, ...restored.writes],
    };
  }
  const isFirstLaunch = input.current === null && input.backup === null;
  return {
    doc: createDefaultAppDocument(input.appId),
    outcome: isFirstLaunch
      ? { kind: 'fresh' }
      : { kind: 'reset-after-damage', reason: current.reason },
    writes: [...quarantines(input, current.reason), { kind: 'write-both' }],
    isReadOnly: false,
  };
}
