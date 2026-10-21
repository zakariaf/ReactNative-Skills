// functions/src/tasks/summary-provider.ts
// The paid provider behind a small port, so the callable is tested with a fake and the provider can be
// swapped. Only the function that binds the secret passes the key in; nothing here reads process.env.
export type SummaryOutcome = { ok: true; summary: string } | { ok: false; reason: 'rejected' | 'unavailable' };

export interface SummaryProvider {
  summarize: (taskTitles: readonly string[], apiKey: string) => Promise<SummaryOutcome>;
}

export const SUMMARY_API_URL = '__SUMMARY_API_URL__';

export function httpSummaryProvider(fetchImpl: typeof fetch = fetch): SummaryProvider {
  return {
    summarize: async (taskTitles, apiKey) => {
      try {
        const response = await fetchImpl(SUMMARY_API_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ items: taskTitles }),
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status >= 500 || response.status === 429) return { ok: false, reason: 'unavailable' };
        if (!response.ok) return { ok: false, reason: 'rejected' };
        const body: unknown = await response.json();
        const summary = typeof body === 'object' && body !== null && 'summary' in body ? body.summary : undefined;
        return typeof summary === 'string' ? { ok: true, summary } : { ok: false, reason: 'rejected' };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    },
  };
}
