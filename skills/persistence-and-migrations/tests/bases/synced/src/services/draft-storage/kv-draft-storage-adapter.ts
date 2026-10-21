// src/services/draft-storage/kv-draft-storage-adapter.ts: device-only drafts in expo-sqlite's key-value store.
import Storage from 'expo-sqlite/kv-store';

export type DraftStoragePort = {
  readonly draft: () => string | null;
  readonly setDraft: (text: string) => void;
};

export function createKvDraftStorageAdapter(): DraftStoragePort {
  return {
    draft: () => Storage.getItemSync('task-draft'),
    setDraft: (text) => {
      Storage.setItemSync('task-draft', text);
    },
  };
}
