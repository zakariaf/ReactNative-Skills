// scripts/audit/privacy-manifest.ts
// The iOS privacy manifests CocoaPods puts into the app, and what the app's own manifest must
// declare. Apple does not reliably read static pods' manifests, so the app's manifest
// (src/config/privacy-manifest.ts, embedded by app.config.ts ios.privacyManifests) carries every
// required-reason API any pod declares. Trunk pods keep their manifests under ios/Pods/<pod>/;
// development pods (EXTERNAL SOURCES from node_modules) are bundled from their own folder, as their
// Local Podspecs entry names them. readManifest needs macOS (plutil); the rest is pure.
import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { externalSources } from './network-pods-layer.ts';

export type ApiDeclaration = {
  readonly NSPrivacyAccessedAPIType: string;
  readonly NSPrivacyAccessedAPITypeReasons: readonly string[];
};
export type CollectedDataType = {
  readonly NSPrivacyCollectedDataType: string;
  readonly NSPrivacyCollectedDataTypeLinked: boolean;
  readonly NSPrivacyCollectedDataTypeTracking: boolean;
};
export type PrivacyManifest = {
  readonly NSPrivacyTracking?: boolean;
  readonly NSPrivacyTrackingDomains?: readonly string[];
  readonly NSPrivacyAccessedAPITypes?: readonly ApiDeclaration[];
  readonly NSPrivacyCollectedDataTypes?: readonly CollectedDataType[];
};
export type PodManifest = {
  readonly pod: string;
  readonly path: string;
  readonly manifest: PrivacyManifest;
};

/** plutil ships with macOS and reads XML and binary plists. */
export function readManifest(file: string): PrivacyManifest {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
  return JSON.parse(json) as PrivacyManifest;
}

/** category -> reason codes, merged over many manifests. */
export function mergeReasons(manifests: readonly PrivacyManifest[]): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const manifest of manifests) {
    for (const api of manifest.NSPrivacyAccessedAPITypes ?? []) {
      const reasons = merged.get(api.NSPrivacyAccessedAPIType) ?? new Set<string>();
      api.NSPrivacyAccessedAPITypeReasons.forEach((reason) => reasons.add(reason));
      merged.set(api.NSPrivacyAccessedAPIType, reasons);
    }
  }
  return merged;
}

/** Every (category, reason) a pod declares that the app does not. */
export function missingReasons(
  required: ReadonlyMap<string, ReadonlySet<string>>,
  declared: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  return [...required].flatMap(([category, reasons]) =>
    [...reasons]
      .filter((reason) => declared.get(category)?.has(reason) !== true)
      .map((reason) => `${category} ${reason}`),
  );
}

/**
 * The app's own manifest: the app's code tracks nothing (NSPrivacyTracking false) and lists no
 * NSPrivacyTrackingDomains: iOS fails requests to listed domains for everyone who declines App
 * Tracking Transparency, which would stop ads and attribution for them.
 */
export function appTrackingProblems(manifest: PrivacyManifest): string[] {
  const problems: string[] = [];
  if (manifest.NSPrivacyTracking !== false) {
    problems.push('the app manifest must set NSPrivacyTracking: false');
  }
  if ((manifest.NSPrivacyTrackingDomains ?? []).length > 0) {
    problems.push('the app manifest must list no NSPrivacyTrackingDomains');
  }
  return problems;
}

/** Problems of the merged pod manifests against the app's own and the declared tracking pods. */
export function privacyProblems(
  pods: readonly PodManifest[],
  app: PrivacyManifest,
  trackingAllowed: ReadonlySet<string>,
): string[] {
  const required = mergeReasons(pods.map(({ manifest }) => manifest));
  // A pod tracks when it says so in any of three places: real SDKs often set only the per-type flag
  // (Google-Mobile-Ads-SDK 13.6.0 has no NSPrivacyTracking key, just Device ID tracking=true).
  const tracksIn = (manifest: PrivacyManifest): boolean =>
    manifest.NSPrivacyTracking === true ||
    (manifest.NSPrivacyTrackingDomains ?? []).length > 0 ||
    (manifest.NSPrivacyCollectedDataTypes ?? []).some(
      (item) => item.NSPrivacyCollectedDataTypeTracking,
    );
  const flagged = new Set<string>();
  const tracking = pods.filter(({ pod, manifest }) => {
    if (trackingAllowed.has(pod) || flagged.has(pod) || !tracksIn(manifest)) {
      return false;
    }
    flagged.add(pod);
    return true;
  });
  return [
    ...missingReasons(required, mergeReasons([app])).map((gap) => `the app manifest lacks ${gap}`),
    ...tracking.map(
      ({ pod, path: file }) =>
        `pod ${pod} declares tracking but no tracking SDK in contracts/privacy.json brings it (${file})`,
    ),
    ...appTrackingProblems(app),
  ];
}

/** "pod: DeviceID linked=true tracking=true" lines: the App Privacy input the pods declare. */
export function collectedLines(pods: readonly PodManifest[]): string[] {
  const lines = pods.flatMap(({ pod, manifest }) =>
    (manifest.NSPrivacyCollectedDataTypes ?? []).map((item) => {
      const type = item.NSPrivacyCollectedDataType.replace('NSPrivacyCollectedDataType', '');
      return `${pod}: ${type} linked=${String(item.NSPrivacyCollectedDataTypeLinked)} tracking=${String(item.NSPrivacyCollectedDataTypeTracking)}`;
    }),
  );
  return [...new Set(lines)];
}

type PodspecJson = {
  readonly resource_bundles?: Readonly<Record<string, string | readonly string[]>>;
  readonly resources?: string | readonly string[];
  readonly ios?: unknown;
  readonly subspecs?: readonly unknown[];
};

function podspecResources(podspec: unknown): string[] {
  if (typeof podspec !== 'object' || podspec === null) {
    return [];
  }
  const spec = podspec as PodspecJson;
  const own = [...Object.values(spec.resource_bundles ?? {}), spec.resources ?? []].flat();
  return [...own, ...[spec.ios, ...(spec.subspecs ?? [])].flatMap(podspecResources)];
}

const GLOB_MAGIC = /[*?[{]/u;

/**
 * The privacy manifests a podspec bundles, relative to the pod's root. CocoaPods reads every
 * resource entry as a glob pattern, so a pattern is expanded in the pod's folder and only its
 * PrivacyInfo.xcprivacy matches count; a pattern whose folder is missing throws, naming the pod.
 */
export function podspecPrivacyFiles(podspec: unknown, pod: string, root: string): string[] {
  const files = podspecResources(podspec).flatMap((resource) => {
    if (!GLOB_MAGIC.test(resource)) {
      return resource.endsWith('.xcprivacy') ? [resource] : [];
    }
    if (!existsSync(root)) {
      throw new Error(`pod ${pod}: cannot expand "${resource}" (its folder ${root} is missing)`);
    }
    return globSync(resource, { cwd: root }).filter(
      (file) => path.basename(file) === 'PrivacyInfo.xcprivacy',
    );
  });
  return [...new Set(files)].sort();
}

/** The development pods' manifests: EXTERNAL SOURCES with a local :path or :podspec. */
export function localPodManifestPaths(iosDir: string): { pod: string; path: string }[] {
  const lock = readFileSync(path.join(iosDir, 'Podfile.lock'), 'utf8');
  return [...externalSources(lock)].flatMap(([pod, source]) => {
    const local =
      source['path'] ??
      (source['podspec']?.includes('://') === false ? path.dirname(source['podspec']) : undefined);
    const spec = path.join(iosDir, 'Pods', 'Local Podspecs', `${pod}.podspec.json`);
    if (local === undefined || !existsSync(spec)) {
      return [];
    }
    const root = path.join(iosDir, local);
    const podspec = JSON.parse(readFileSync(spec, 'utf8')) as unknown;
    return podspecPrivacyFiles(podspec, pod, root).map((file) => ({
      pod,
      path: path.join(root, file),
    }));
  });
}
