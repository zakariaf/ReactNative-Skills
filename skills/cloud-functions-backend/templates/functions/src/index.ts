// functions/src/index.ts
// Exports only. The global options module is imported first so every function created below sees them.
import './config/global-options.ts';

import { firestoreDailyQuota } from './lib/daily-quota.ts';
import { firestorePaidCallsFlag } from './lib/paid-calls-flag.ts';
import { makeSummarizeList } from './tasks/summarize-list.ts';
import { firestoreSummaryCache } from './tasks/summary-cache.ts';
import { httpSummaryProvider } from './tasks/summary-provider.ts';

export const summarizeList = makeSummarizeList({
  flag: firestorePaidCallsFlag(),
  quota: firestoreDailyQuota('summaryQuotas', 20),
  cache: firestoreSummaryCache(),
  provider: httpSummaryProvider(),
  now: () => new Date(),
});
