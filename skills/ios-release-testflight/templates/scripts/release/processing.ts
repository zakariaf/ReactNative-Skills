// scripts/release/processing.ts
// Reading Apple's answers after an upload: the delivery id in altool's JSON (its field name is not
// documented, so it is searched for), the processing state from the REST builds endpoint, and the
// version rule against the last release tag.
import { ascField } from '../asc/asc-client.ts';

export type ProcessingState = 'PROCESSING' | 'VALID' | 'INVALID' | 'FAILED';
const STATES: readonly ProcessingState[] = ['PROCESSING', 'VALID', 'INVALID', 'FAILED'];

/** Depth-first search for the first string under a key like deliveryUuid / delivery-id / DeliveryID. */
export function findDeliveryId(json: unknown): string | null {
  if (Array.isArray(json)) {
    return json.map(findDeliveryId).find((found) => found !== null) ?? null;
  }
  if (typeof json !== 'object' || json === null) {
    return null;
  }
  for (const [key, value] of Object.entries(json)) {
    if (/^delivery[-_ ]?(uuid|id)$/i.test(key) && typeof value === 'string' && value !== '') {
      return value;
    }
    const nested = findDeliveryId(value);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

/** GET /v1/builds?filter[app]=...: attributes.processingState of the first build, if any. */
export function processingStateOf(json: unknown): ProcessingState | null {
  const data = ascField(json, 'data');
  const first: unknown = Array.isArray(data) ? data[0] : undefined;
  const state = ascField(ascField(first, 'attributes'), 'processingState');
  return STATES.find((candidate) => candidate === state) ?? null;
}

export function buildsPath(appleAppId: string, buildNumber: number, version: string): string {
  const query = [
    `filter[app]=${encodeURIComponent(appleAppId)}`,
    `filter[version]=${String(buildNumber)}`,
    `filter[preReleaseVersion.version]=${encodeURIComponent(version)}`,
  ];
  return `/v1/builds?${query.join('&')}`;
}

function semverParts(version: string): readonly number[] {
  return version.split('.').map(Number);
}

function compareVersions(a: string, b: string): number {
  const [x, y] = [semverParts(a), semverParts(b)];
  for (let index = 0; index < 3; index += 1) {
    const diff = (x[index] ?? 0) - (y[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Release tags are <prefix>vX.Y.Z; upload tags (<prefix>vX.Y.Z+ios.N) do not count. */
export function lastReleaseVersion(tags: readonly string[], prefix: string): string | null {
  const releases = tags
    .filter((tag) => tag.startsWith(`${prefix}v`) && !tag.includes('+'))
    .map((tag) => tag.slice(`${prefix}v`.length))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version))
    .sort(compareVersions);
  return releases.at(-1) ?? null;
}

/** A store build needs a version above the last release (App Store Connect: ITMS-90062). */
export function isVersionAboveLastRelease(
  version: string,
  tags: readonly string[],
  prefix: string,
): boolean {
  const last = lastReleaseVersion(tags, prefix);
  return last === null || compareVersions(version, last) > 0;
}
