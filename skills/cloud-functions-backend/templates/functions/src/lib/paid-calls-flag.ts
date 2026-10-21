// functions/src/lib/paid-calls-flag.ts
// The kill switch every paid provider call reads first. The budget alert handler turns it off; only the
// developer turns it back on. It fails closed: a missing doc, a missing field or a read error means off.
import { db } from './admin.ts';

export const FLAGS_DOC = 'ops/flags';
const CACHE_MS = 30_000;

export interface PaidCallsFlag {
  enabled: () => Promise<boolean>;
}

export function firestorePaidCallsFlag(now: () => number = Date.now): PaidCallsFlag {
  let cached: { value: boolean; at: number } | null = null;
  return {
    enabled: async () => {
      if (cached !== null && now() - cached.at < CACHE_MS) return cached.value;
      let value = false;
      try {
        const snapshot = await db().doc(FLAGS_DOC).get();
        value = snapshot.get('paidCallsEnabled') === true;
      } catch {
        value = false;
      }
      cached = { value, at: now() };
      return value;
    },
  };
}
