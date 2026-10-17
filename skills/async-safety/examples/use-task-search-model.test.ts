// src/features/task-search/use-task-search-model.test.ts (example: a shape to imitate, never copied)
// Fake timers drive the debounce and the deadline (a UI timer, so no marker is needed outside the
// logic folders); every search settles only when the test says so.
import { act } from '@testing-library/react-native';

import { ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { renderHookWithProviders } from '@test/render-with-providers';

import {
  SEARCH_DEADLINE_MS,
  SEARCH_DEBOUNCE_MS,
  useTaskSearchModel,
} from './use-task-search-model';

import type { Result } from '@/core/result';
import type {
  TaskDetails,
  TaskDetailsFailure,
  TaskDetailsPort,
} from '@/services/task-details/task-details-port';

type SearchCall = {
  readonly query: string;
  readonly signal: AbortSignal;
  readonly settle: (result: Result<readonly TaskDetails[], TaskDetailsFailure>) => void;
};

function createControlledSearch(): {
  readonly port: TaskDetailsPort;
  readonly calls: SearchCall[];
} {
  const calls: SearchCall[] = [];
  const port: TaskDetailsPort = {
    load: (taskId) => Promise.resolve({ ok: false, error: { kind: 'not-found', taskId } }),
    search: (query, signal) => {
      const pending = Promise.withResolvers<Result<readonly TaskDetails[], TaskDetailsFailure>>();
      calls.push({ query, signal, settle: pending.resolve });
      return pending.promise;
    },
  };
  return { port, calls };
}

function found(title: string): readonly TaskDetails[] {
  return [{ id: title, title, notes: '', isDone: false }];
}

function callFor(calls: readonly SearchCall[], query: string): SearchCall {
  const call = calls.find((entry) => entry.query === query);
  if (call === undefined) throw new Error(`no search for "${query}"`);
  return call;
}

function renderSearch(port: TaskDetailsPort) {
  return renderHookWithProviders(() => useTaskSearchModel(), {
    services: { taskDetails: port, errorLog: createFakeErrorLog() },
  });
}

describe('useTaskSearchModel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('searches once the typing pauses', async () => {
    const { port, calls } = createControlledSearch();
    const { result } = await renderSearch(port);
    await act(async () => {
      result.current.onQueryChange('t');
      result.current.onQueryChange('ta');
      await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });

    expect(calls.map((call) => call.query)).toStrictEqual(['ta']);

    await act(() => {
      callFor(calls, 'ta').settle(ok(found('Take out trash')));
    });

    expect(result.current.state).toStrictEqual({
      status: 'found',
      results: found('Take out trash'),
    });
  });

  it('keeps the newer answer when the older search answers last', async () => {
    const { port, calls } = createControlledSearch();
    const { result } = await renderSearch(port);
    await act(async () => {
      result.current.onQueryChange('t');
      await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
      result.current.onQueryChange('ta');
      await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });

    expect(callFor(calls, 't').signal.aborted).toBe(true);

    await act(() => {
      callFor(calls, 'ta').settle(ok(found('Take out trash')));
      callFor(calls, 't').settle(ok(found('Tidy desk')));
    });

    expect(result.current.state).toStrictEqual({
      status: 'found',
      results: found('Take out trash'),
    });
  });

  it('drops an answer that resumes after a newer keystroke', async () => {
    const { port, calls } = createControlledSearch();
    const { result } = await renderSearch(port);
    await act(async () => {
      result.current.onQueryChange('t');
      await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });
    // The answer for "t" settles first, so withTimeout returns it as ok, but the keystroke for "ta"
    // aborts the signal before the search resumes: only the signal check drops it.
    await act(async () => {
      callFor(calls, 't').settle(ok(found('Tidy desk')));
      result.current.onQueryChange('ta');
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(result.current.state).toStrictEqual({ status: 'searching' });
  });

  it('shows timed-out when the search hangs past the deadline', async () => {
    const { port } = createControlledSearch();
    const { result } = await renderSearch(port);
    await act(async () => {
      result.current.onQueryChange('ta');
      await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + SEARCH_DEADLINE_MS);
    });

    expect(result.current.state).toStrictEqual({ status: 'failed', reason: 'timed-out' });
  });

  it('cancels the running search on unmount and leaves no timer behind', async () => {
    const { port, calls } = createControlledSearch();
    const { result, unmount } = await renderSearch(port);
    await act(async () => {
      result.current.onQueryChange('ta');
      await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });
    await unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(callFor(calls, 'ta').signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
