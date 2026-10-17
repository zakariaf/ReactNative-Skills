// src/api/tasks/task-mutations.test.ts
// Mutations run through a MutationObserver (what useMutation uses) against the fake ApiClient, with
// the cache seeded by setQueryData; held answers show the cache while the write is in flight.
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import { createFakeApiClient } from '@test/api/fake-api-client';
import { flushMicrotasks } from '@test/flush-microtasks';

import { taskKeys } from './task-keys';
import { taskMutations } from './task-mutations';

import type { ApiTask } from './task-schemas';

const OPEN: ApiTask = {
  id: 't1',
  title: 'Buy milk',
  isDone: false,
  priority: 'normal',
  updatedAt: '2026-10-03T09:30:00Z',
};
const OTHER: ApiTask = { ...OPEN, id: 't2', title: 'Call Sam' };

// gcTime Infinity: no garbage-collection timer outlives a test (the test app's client does the same).
function seeded(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  queryClient.setQueryData(taskKeys.list('all'), [OPEN, OTHER]);
  queryClient.setQueryData(taskKeys.list('open'), [OPEN, OTHER]);
  return queryClient;
}

function doneFlags(queryClient: QueryClient): readonly (readonly boolean[] | undefined)[] {
  return [taskKeys.list('all'), taskKeys.list('open')].map((key) =>
    queryClient.getQueryData<readonly ApiTask[]>(key)?.map((task) => task.isDone),
  );
}

describe('taskMutations.toggle', () => {
  it('shows the change in every cached list while the write is in flight', async () => {
    const api = createFakeApiClient();
    const held = api.hold('PATCH', '/tasks/t1');
    const queryClient = seeded();
    const observer = new MutationObserver(queryClient, taskMutations.toggle(api, queryClient));
    const mutating = observer.mutate({ id: 't1', isDone: true });
    await flushMicrotasks();
    const whileInFlight = doneFlags(queryClient);
    held.release({ body: { ...OPEN, isDone: true } });
    await mutating;

    expect(whileInFlight).toStrictEqual([
      [true, false],
      [true, false],
    ]);
    expect(api.calls()[0]?.body).toStrictEqual({ isDone: true });
  });

  it('restores every list when the server refuses, then refetches', async () => {
    const api = createFakeApiClient();
    api.fail('PATCH', '/tasks/t1', { kind: 'conflict', code: 'task-deleted' });
    const queryClient = seeded();
    const observer = new MutationObserver(queryClient, taskMutations.toggle(api, queryClient));
    await observer.mutate({ id: 't1', isDone: true }).catch(() => undefined);

    expect(doneFlags(queryClient)).toStrictEqual([
      [false, false],
      [false, false],
    ]);
    expect(queryClient.getQueryState(taskKeys.list('all'))?.isInvalidated).toBe(true);
  });
});

describe('taskMutations.create', () => {
  it('sends the request id as the idempotency key and refreshes the lists', async () => {
    const api = createFakeApiClient();
    api.respond('POST', '/tasks', OTHER);
    const queryClient = seeded();
    const observer = new MutationObserver(queryClient, taskMutations.create(api, queryClient));
    await observer.mutate({ requestId: 'req-7', title: 'Call Sam' });

    expect([api.calls()[0]?.idempotencyKey, api.calls()[0]?.body]).toStrictEqual([
      'req-7',
      { title: 'Call Sam' },
    ]);
    expect(queryClient.getQueryState(taskKeys.list('open'))?.isInvalidated).toBe(true);
  });
});
