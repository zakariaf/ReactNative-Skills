// functions/src/tasks/summarize-list.ts
// A cost-bearing callable: it calls a paid provider, so it consumes the App Check token, binds only its
// own secret, reads the kill switch first and counts the daily quota only when the provider really runs.
import * as v from 'valibot';

import { SUMMARY_API_KEY } from '../config/secrets.ts';
import type { DailyQuota } from '../lib/daily-quota.ts';
import { defineCallable } from '../lib/define-callable.ts';
import type { PaidCallsFlag } from '../lib/paid-calls-flag.ts';
import { fingerprintOf, type SummaryCache } from './summary-cache.ts';
import type { SummaryProvider } from './summary-provider.ts';

export const SummarizeListInput = v.object({
  listId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  taskTitles: v.pipe(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(200))), v.minLength(1), v.maxLength(50)),
});

export interface SummarizeListDeps {
  flag: PaidCallsFlag;
  quota: DailyQuota;
  cache: SummaryCache;
  provider: SummaryProvider;
  now: () => Date;
}

export function makeSummarizeList(deps: SummarizeListDeps) {
  return defineCallable({
    name: 'summarizeList',
    input: SummarizeListInput,
    consumeAppCheckToken: true,
    secrets: [SUMMARY_API_KEY],
    maxInstances: 5,
    timeoutSeconds: 60,
    handler: async ({ listId, taskTitles }, { uid }) => {
      const fingerprint = fingerprintOf(taskTitles);
      const cached = await deps.cache.get(uid, listId, fingerprint);
      if (cached !== null) return { ok: true, value: { summary: cached, cached: true } };

      if (!(await deps.flag.enabled())) return { ok: false, error: { kind: 'service-paused' } };

      const now = deps.now();
      const quota = await deps.quota.reserve(uid, now);
      if (!quota.ok) return { ok: false, error: { kind: 'quota-exceeded', params: { limit: quota.limit, resetsAt: quota.resetsAt } } };

      const outcome = await deps.provider.summarize(taskTitles, SUMMARY_API_KEY.value());
      if (!outcome.ok) {
        await deps.quota.release(uid, now);
        return { ok: false, error: { kind: outcome.reason === 'unavailable' ? 'unavailable' : 'internal' } };
      }
      await deps.cache.put(uid, listId, fingerprint, outcome.summary);
      return { ok: true, value: { summary: outcome.summary, cached: false } };
    },
  });
}
