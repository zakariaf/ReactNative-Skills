// src/api/tasks/task-queries.test.ts
// Query options run in a real QueryClient against the fake ApiClient: no React, no network.
import { QueryClient, QueryObserver } from '@tanstack/react-query';

import { apiFailureOf } from '@/api/api-error';
import { createFakeApiClient } from '@test/api/fake-api-client';
import { flushMicrotasks } from '@test/flush-microtasks';

import { taskKeys } from './task-keys';
import { taskQueries } from './task-queries';

const TASK = {
  id: 't/1',
  title: 'Buy milk',
  isDone: false,
  priority: 'normal',
  updatedAt: '2026-10-03T09:30:00Z',
};

describe('taskQueries', () => {
  const clients: QueryClient[] = [];
  const makeClient = (): QueryClient => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    return client;
  };

  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
  });

  it('fetches a filtered list under its key', async () => {
    const api = createFakeApiClient();
    api.respond('GET', '/tasks', { items: [TASK] });
    const options = taskQueries.list(api, 'open');

    await expect(makeClient().query(options)).resolves.toStrictEqual([TASK]);
    expect(options.queryKey).toStrictEqual(taskKeys.list('open'));
    expect(api.calls()[0]?.query).toStrictEqual({ filter: 'open' });
  });

  it('leaves the filter out for all tasks and encodes a detail id', async () => {
    const api = createFakeApiClient();
    api.respond('GET', '/tasks', { items: [] });
    api.respond('GET', '/tasks/t%2F1', TASK);
    const queryClient = makeClient();
    await queryClient.query(taskQueries.list(api, 'all'));
    await queryClient.query(taskQueries.detail(api, 't/1'));

    expect(api.calls().map((call) => [call.path, call.query])).toStrictEqual([
      ['/tasks', { filter: undefined }],
      ['/tasks/t%2F1', undefined],
    ]);
  });

  it('rejects with the typed failure', async () => {
    const api = createFakeApiClient();
    api.fail('GET', '/tasks/t9', { kind: 'not-found' });
    const rejection = await makeClient()
      .query(taskQueries.detail(api, 't9'))
      .catch((error: unknown) => error);

    expect(apiFailureOf(rejection)).toStrictEqual({ kind: 'not-found' });
  });

  it('aborts the request when the last observer leaves', async () => {
    const api = createFakeApiClient();
    api.hold('GET', '/tasks');
    const observer = new QueryObserver(makeClient(), taskQueries.list(api, 'all'));
    const unsubscribe = observer.subscribe(() => undefined);
    await flushMicrotasks();
    unsubscribe();

    expect(api.calls()[0]?.signal?.aborted).toBe(true);
  });

  it('aborts the request when the query is cancelled', async () => {
    const api = createFakeApiClient();
    api.hold('GET', '/tasks/t1');
    const queryClient = makeClient();
    const fetching = queryClient.query(taskQueries.detail(api, 't1')).catch(() => 'cancelled');
    await flushMicrotasks();
    await queryClient.cancelQueries({ queryKey: taskKeys.detail('t1') });

    await expect(fetching).resolves.toBe('cancelled');
    expect(api.calls()[0]?.signal?.aborted).toBe(true);
  });
});
