// scripts/asc/find-app.test.ts
// App Store Connect is a fake here: no test reaches the network.
import { findAppByBundleId } from './find-app.ts';

import type { AscRequest, AscResponse } from './asc-client.ts';

type App = { readonly id: string; readonly name: string; readonly bundleId: string };

const TASKS: App = { id: '6700000001', name: 'Tasks', bundleId: 'com.acme.tasks' };
const TASKS_TWO: App = { id: '6700000002', name: 'Tasks Two', bundleId: 'com.acme.tasks2' };

/** A fake ascRequest answering every GET with these apps; it records the paths it was asked. */
function answering(apps: readonly App[]): {
  readonly paths: string[];
  readonly request: (token: string, request: AscRequest) => Promise<AscResponse>;
} {
  const paths: string[] = [];
  const data = apps.map(({ id, name, bundleId }) => ({
    type: 'apps',
    id,
    attributes: { name, bundleId },
  }));
  return {
    paths,
    request: (_token, request) => {
      paths.push(request.path);
      return Promise.resolve({ ok: true, status: 200, json: { data } });
    },
  };
}

describe('findAppByBundleId', () => {
  it('asks for the app records of the bundle id with their names and bundle ids', async () => {
    const asc = answering([TASKS]);
    await findAppByBundleId('token', 'com.acme.tasks', asc.request);
    expect(asc.paths).toStrictEqual([
      '/v1/apps?filter[bundleId]=com.acme.tasks&fields[apps]=name,bundleId',
    ]);
  });

  it('returns only the record whose bundle id is exactly the one asked for', async () => {
    const asc = answering([TASKS_TWO, TASKS]);
    await expect(findAppByBundleId('token', 'com.acme.tasks', asc.request)).resolves.toStrictEqual({
      id: '6700000001',
      name: 'Tasks',
    });
  });

  it('finds no record when only another bundle id answers (the app record is a human step)', async () => {
    const asc = answering([TASKS_TWO]);
    await expect(findAppByBundleId('token', 'com.acme.tasks', asc.request)).resolves.toBeNull();
  });

  it('stops when two records carry the same bundle id', async () => {
    const asc = answering([TASKS, { ...TASKS, id: '6700000003' }]);
    await expect(findAppByBundleId('token', 'com.acme.tasks', asc.request)).rejects.toThrow(
      'App Store Connect has 2 app records for com.acme.tasks (6700000001, 6700000003)',
    );
  });

  it("names App Store Connect's answer when the request fails", async () => {
    const request = (): Promise<AscResponse> =>
      Promise.resolve({ ok: false, status: 401, errors: [{ code: 'NOT_AUTHORIZED', detail: '' }] });
    await expect(findAppByBundleId('token', 'com.acme.tasks', request)).rejects.toThrow(
      'App Store Connect answered 401 (NOT_AUTHORIZED)',
    );
  });
});
