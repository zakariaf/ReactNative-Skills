// src/data/document/fake-document-store.ts: an in-memory DocumentStore for service, store and screen tests.
import type { DocumentStore, SlotName, SlotRecord } from '@/data/document/document-store';

/** `failNextWrite` throws once before anything changes (a crash before COMMIT). */
export type FakeDocumentStore = DocumentStore & {
  readonly slots: Map<SlotName, SlotRecord>;
  readonly quarantined: { readonly slot: SlotName; readonly reason: string }[];
  failNextWrite: boolean;
};

export function createFakeDocumentStore(): FakeDocumentStore {
  const fake: FakeDocumentStore = {
    slots: new Map(),
    quarantined: [],
    failNextWrite: false,
    read: (slot) => fake.slots.get(slot) ?? null,
    write: (slots) => {
      if (fake.failNextWrite) {
        fake.failNextWrite = false;
        throw new Error('simulated crash before COMMIT');
      }
      if (slots.current !== undefined) fake.slots.set('current', slots.current);
      if (slots.backup !== undefined) fake.slots.set('backup', slots.backup);
    },
    quarantine: (slot, reason) => {
      fake.quarantined.push({ slot, reason });
    },
  };
  return fake;
}
