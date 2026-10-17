// src/features/task-search/use-task-search-model.ts (example: a shape to imitate, never copied)
// Search as you type over the tasks on the device (a SQLite full-text query), latest wins: every
// keystroke starts a request through one LatestRequest, which aborts the previous one and gives the
// new one a signal; a result whose signal aborted is dropped, so a slow answer for "t" never
// replaces the answer for "ta". delayOrAbort debounces (a keystroke inside the pause aborts it, so
// only the pause ends), and withTimeout bounds each search, so a hung query cannot leave the spinner
// up forever. Two guards drop a late answer: withTimeout turns an abort before the task settles into
// `cancelled`, and `if (signal.aborted) return;` catches an answer that settled just before a newer
// keystroke but resumes after it (the test "drops an answer that resumes after a newer keystroke").
// Searching server data is not this shape: put the query in a useQuery key
// (networking-and-server-state). The handler stays synchronous (typescript-and-lint-rules rule 10);
// the unmount cleanup cancels whatever is still running. Assumes Services has
// `taskDetails: TaskDetailsPort`.
import { useEffect, useState } from 'react';

import { createLatestRequest } from '@/core/async/latest-request';
import { delayOrAbort } from '@/services/async/delay-or-abort';
import { withTimeout } from '@/services/async/with-timeout';
import { useServices } from '@/services/services-context';

import type { TaskDetails } from '@/services/task-details/task-details-port';

export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_DEADLINE_MS = 8000;

export type TaskSearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'searching' }
  | { readonly status: 'found'; readonly results: readonly TaskDetails[] }
  | { readonly status: 'failed'; readonly reason: 'timed-out' | 'not-found' };

/** What the search screen renders and calls. Callbacks return void (async-safety rule 2). */
export type TaskSearchModel = {
  readonly query: string;
  readonly state: TaskSearchState;
  readonly onQueryChange: (text: string) => void;
};

/** Searches tasks as the user types; only the newest query's answer is ever shown. */
export function useTaskSearchModel(): TaskSearchModel {
  const { taskDetails, errorLog } = useServices();
  const [latest] = useState(createLatestRequest);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<TaskSearchState>({ status: 'idle' });
  useEffect(() => {
    return () => {
      latest.cancel();
    };
  }, [latest]);
  const search = async (text: string): Promise<void> => {
    const signal = latest.start();
    setState({ status: 'searching' });
    if ((await delayOrAbort(SEARCH_DEBOUNCE_MS, signal)) === 'aborted') return;
    const result = await withTimeout(
      (inner) => taskDetails.search(text, inner),
      SEARCH_DEADLINE_MS,
      signal,
    );
    if (signal.aborted) return;
    if (result.ok) setState({ status: 'found', results: result.value });
    else if (result.error.kind !== 'cancelled')
      setState({ status: 'failed', reason: result.error.kind });
  };
  const onQueryChange = (text: string): void => {
    setQuery(text);
    if (text.trim() === '') {
      latest.cancel();
      setState({ status: 'idle' });
      return;
    }
    search(text).catch((error: unknown) => {
      errorLog.record('service', error);
    });
  };
  return { query, state, onQueryChange };
}
