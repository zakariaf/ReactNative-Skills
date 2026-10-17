// src/data/document/document-store.ts: the storage port of the app document: two slots of rows, no documents.
export type SlotName = 'current' | 'backup';

/** One row of document_slots: the whole document as JSON plus its envelope. */
export type SlotRecord = {
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly writtenAtMs: number;
  readonly writeCount: number;
  /** fnv1a32 of payload, 8 hex characters. */
  readonly checksum: string;
  readonly payload: string;
};

/** Adapters: sqlite-document-store.ts (the app), fake-document-store.ts (tests). */
export type DocumentStore = {
  readonly read: (slot: SlotName) => SlotRecord | null;
  /** Writes the given slots in ONE transaction: both commit, or neither does. */
  readonly write: (slots: { readonly current?: SlotRecord; readonly backup?: SlotRecord }) => void;
  /** Copies a slot row into document_quarantine (never deletes it), keeping the newest 10. */
  readonly quarantine: (slot: SlotName, reason: string, atMs: number) => void;
};
