// src/features/tasks/use-tasks-model.test.tsx (example: testing a model hook over server state)
// The hook reads useIsFocused, so it renders inside a route (renderRouterWithProviders), with the fake
// ApiClient as the `api` port; the route puts the app's I18nProvider around it (the canonical test app
// carries no catalogs). The test app's QueryClient never retries and never garbage-collects during a
// test. The online manager is a module singleton: a test that takes it offline restores it.
import { defaultScheduler, notifyManager, onlineManager } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { I18nProvider } from '@/i18n/i18n-provider';
import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeApiClient } from '@test/api/fake-api-client';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { useTasksModel } from './use-tasks-model';

import type { TasksModel } from './use-tasks-model';
import type { FakeApiClient } from '@test/api/fake-api-client';
import type { JSX } from 'react';

const TASK = {
  id: 't1',
  title: 'Buy milk',
  isDone: false,
  priority: 'normal',
  updatedAt: '2026-10-03T09:30:00Z',
};

let model: TasksModel | null = null;

/** Hands each committed model to the test (render stays pure: the effect reports it). */
function ModelProbe({ onModel }: { readonly onModel: (next: TasksModel) => void }): null {
  const next = useTasksModel();
  useEffect(() => {
    onModel(next);
  });
  return null;
}

function failOnError(error: Error): never {
  throw error;
}

function TasksRouteProbe(): JSX.Element {
  return (
    <I18nProvider language="en" digits="automatic" onError={failOnError}>
      <ModelProbe
        onModel={(next) => {
          model = next;
        }}
      />
    </I18nProvider>
  );
}

async function renderModel(api: FakeApiClient): Promise<void> {
  const view = await renderRouterWithProviders(
    { index: TasksRouteProbe },
    {
      services: { api, connectivity: createFakeConnectivity(true), errorLog: createFakeErrorLog() },
    },
  );
  // A finished mutation keeps a 5-minute garbage-collection timer (Jest then waits for it to exit)
  // unless its gcTime is Infinity; the test app sets that for queries only.
  const defaults = view.queryClient.getDefaultOptions();
  view.queryClient.setDefaultOptions({
    ...defaults,
    mutations: { ...defaults.mutations, gcTime: Infinity },
  });
}

describe('useTasksModel', () => {
  // The router helper renders under fake timers and then switches to real ones; TanStack Query
  // delivers results with setTimeout(0), and a callback scheduled under fake timers is dropped. A
  // promise-based scheduler delivers every result whatever the timers are.
  beforeAll(() => {
    notifyManager.setScheduler((callback) => {
      Promise.resolve()
        .then(callback)
        .catch((error: unknown) => {
          throw error; // a failing listener still fails the test (unhandled rejection)
        });
    });
  });

  afterAll(() => {
    notifyManager.setScheduler(defaultScheduler);
  });

  afterEach(() => {
    model = null;
    onlineManager.setOnline(true);
  });

  it('shows the tasks the API returns, counted in the summary', async () => {
    const api = createFakeApiClient();
    api.respond('GET', '/tasks', { items: [TASK] });
    await renderModel(api);

    await waitFor(() => {
      expect(model?.listState.kind).toBe('ready');
    });
    expect([model?.tasks, model?.summary]).toStrictEqual([
      [{ id: 't1', title: 'Buy milk', isDone: false }],
      '1 open task',
    ]);
  });

  it('waits offline instead of failing, then loads on reconnect', async () => {
    const api = createFakeApiClient();
    api.respond('GET', '/tasks', { items: [TASK] });
    onlineManager.setOnline(false);
    await renderModel(api);

    expect([model?.listState.kind, api.calls()]).toStrictEqual(['offline', []]);
    await act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(model?.listState.kind).toBe('ready');
    });
  });

  it('flips a task at once, before the server answers', async () => {
    const api = createFakeApiClient();
    api.respond('GET', '/tasks', { items: [TASK] });
    const held = api.hold('PATCH', '/tasks/t1');
    await renderModel(api);
    await waitFor(() => {
      expect(model?.listState.kind).toBe('ready');
    });
    await act(() => {
      model?.onToggle('t1');
    });

    await waitFor(() => {
      expect(model?.tasks).toStrictEqual([{ id: 't1', title: 'Buy milk', isDone: true }]);
    });
    expect(api.calls().map((call) => call.method)).toStrictEqual(['GET', 'PATCH']);
    await act(() => {
      held.release({ body: { ...TASK, isDone: true } });
    });
  });
});
