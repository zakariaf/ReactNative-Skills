// functions/src/lib/daily-quota.ts
// A per-user daily quota counted in a server transaction, so two parallel calls cannot both take the
// last unit. Reserve right before the paid call (after any cache hit), release when that call fails:
// the quota counts real work only.
import { FieldValue } from 'firebase-admin/firestore';

import { db } from './admin.ts';

export type QuotaDecision = { ok: true } | { ok: false; limit: number; resetsAt: string };

export interface DailyQuota {
  reserve: (uid: string, now: Date) => Promise<QuotaDecision>;
  release: (uid: string, now: Date) => Promise<void>;
}

/** The UTC day a call counts against, and the instant the next day starts. */
export function quotaDay(now: Date): { dayKey: string; resetsAt: string } {
  const dayKey = now.toISOString().slice(0, 10);
  const next = new Date(`${dayKey}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { dayKey, resetsAt: next.toISOString() };
}

export function firestoreDailyQuota(collection: string, limit: number): DailyQuota {
  const refFor = (uid: string, now: Date) => db().collection(collection).doc(uid).collection('days').doc(quotaDay(now).dayKey);
  return {
    reserve: async (uid, now) => {
      const ref = refFor(uid, now);
      return db().runTransaction(async (tx): Promise<QuotaDecision> => {
        const snapshot = await tx.get(ref);
        const used: unknown = snapshot.get('used');
        const count = typeof used === 'number' ? used : 0;
        if (count >= limit) return { ok: false, limit, resetsAt: quotaDay(now).resetsAt };
        tx.set(ref, { used: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { ok: true };
      });
    },
    release: async (uid, now) => {
      await refFor(uid, now).set({ used: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
  };
}
