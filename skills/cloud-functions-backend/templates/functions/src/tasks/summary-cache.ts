// functions/src/tasks/summary-cache.ts
// Summaries are cached per list and content fingerprint, so a repeat call costs nothing and uses no quota.
import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';

import { db } from '../lib/admin.ts';

export interface SummaryCache {
  get: (uid: string, listId: string, fingerprint: string) => Promise<string | null>;
  put: (uid: string, listId: string, fingerprint: string, summary: string) => Promise<void>;
}

export function fingerprintOf(taskTitles: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(taskTitles)).digest('hex');
}

export function firestoreSummaryCache(): SummaryCache {
  const refFor = (uid: string, listId: string) => db().collection('users').doc(uid).collection('listSummaries').doc(listId);
  return {
    get: async (uid, listId, fingerprint) => {
      const snapshot = await refFor(uid, listId).get();
      const summary: unknown = snapshot.get('summary');
      return snapshot.get('fingerprint') === fingerprint && typeof summary === 'string' ? summary : null;
    },
    put: async (uid, listId, fingerprint, summary) => {
      await refFor(uid, listId).set({ fingerprint, summary, updatedAt: FieldValue.serverTimestamp() });
    },
  };
}
