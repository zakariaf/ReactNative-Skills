// scripts/asc/find-app.ts
// The App Store Connect app record of one bundle id. Apple's filter[bundleId] is not an exact
// match, so the answer is filtered here by the bundle id it carries: the release then acts only on
// the app's own record (com.acme.tasks never picks com.acme.tasks2).
import { ascField, ascRequest, errorCodes } from './asc-client.ts';

export type AppRecord = { readonly id: string; readonly name: string };

type AppEntry = AppRecord & { readonly bundleId: string };

function toAppEntry(item: unknown): AppEntry | null {
  const id = ascField(item, 'id');
  const attributes = ascField(item, 'attributes');
  const name = ascField(attributes, 'name');
  const bundleId = ascField(attributes, 'bundleId');
  return typeof id === 'string' && typeof name === 'string' && typeof bundleId === 'string'
    ? { id, name, bundleId }
    : null;
}

/**
 * The record for exactly this bundle id, or null when there is none (a human step: no API endpoint
 * creates an app record). Two records stop the run. `request` is ascRequest; tests pass a fake.
 */
export async function findAppByBundleId(
  token: string,
  bundleId: string,
  request = ascRequest,
): Promise<AppRecord | null> {
  const path = `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId`;
  const response = await request(token, { method: 'GET', path });
  if (!response.ok) {
    throw new Error(
      `App Store Connect answered ${String(response.status)} (${errorCodes(response)})`,
    );
  }
  const data = ascField(response.json, 'data');
  const apps = (Array.isArray(data) ? data : [])
    .map(toAppEntry)
    .filter((app): app is AppEntry => app?.bundleId === bundleId);
  if (apps.length > 1) {
    const ids = apps.map((app) => app.id).join(', ');
    throw new Error(
      `App Store Connect has ${String(apps.length)} app records for ${bundleId} (${ids}): ask the developer which one is the app`,
    );
  }
  const [app] = apps;
  return app === undefined ? null : { id: app.id, name: app.name };
}
