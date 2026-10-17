// scripts/audit/network-pods-layer.ts
// iOS vendor pods. Podfile.lock separates pods built from the repo (EXTERNAL SOURCES: autolinked
// npm modules, whose sources the native layer scans) from pods downloaded from the CocoaPods trunk
// (SPEC REPOS), which can bring an unreviewed binary SDK. Every trunk pod must be brought by an SDK
// declared in contracts/privacy.json, and an external pod must come from a folder inside the repo:
// a :git, :http or remote :podspec source, or a :path outside the repo, is code no other layer reads.
import path from 'node:path';

/** Podfile.lock lists trunk pods under "SPEC REPOS:" -> "  trunk:" -> "    - Name". */
export function trunkPods(podfileLock: string): string[] {
  const section = podfileLock.split('\nSPEC REPOS:\n')[1]?.split('\n\n')[0] ?? '';
  return section
    .split('\n')
    .map((line) => /^ {4}- "?([^"\s]+)"?$/u.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** Podfile.lock's "EXTERNAL SOURCES:": each pod with its source keys (:path, :podspec, :git, :http). */
export function externalSources(
  podfileLock: string,
): Map<string, Readonly<Record<string, string>>> {
  const section = podfileLock.split('\nEXTERNAL SOURCES:\n')[1]?.split('\n\n')[0] ?? '';
  const sources = new Map<string, Record<string, string>>();
  let current: Record<string, string> = {};
  for (const line of section.split('\n')) {
    const pod = /^ {2}"?([^"\s]+?)"?:$/u.exec(line)?.[1];
    if (pod !== undefined) {
      current = {};
      sources.set(pod, current);
    }
    const key = /^ {4}:(\w+): "?([^"]*)"?$/u.exec(line);
    if (key?.[1] !== undefined) {
      current[key[1]] = key[2] ?? '';
    }
  }
  return sources;
}

const REMOTE_KEYS = ['git', 'http'] as const;

/** The source of an external pod that is neither the trunk nor a folder in the repo, or null. */
export function foreignSource(source: Readonly<Record<string, string>>): [string, string] | null {
  const remote = REMOTE_KEYS.find((key) => source[key] !== undefined);
  if (remote !== undefined) {
    return [remote, source[remote] ?? ''];
  }
  const key = source['path'] === undefined ? 'podspec' : 'path';
  const value = source[key];
  if (value === undefined) {
    return null;
  }
  // :path and :podspec are relative to ios/, which sits at the app root. A folder inside the app,
  // or an installed npm package (autolinked; the native layer scans it, hoisted or not), is fine.
  const inRepo = path.posix.normalize(path.posix.join('ios', value));
  const isPackage = /(?:^|\/)node_modules\//u.test(path.posix.normalize(value));
  const isOutside = inRepo === '..' || inRepo.startsWith('../') || path.posix.isAbsolute(value);
  const isInside = !value.includes('://') && (isPackage || !isOutside);
  return isInside ? null : [key, value];
}

/** Every problem of one Podfile.lock against the pods the declared SDKs bring. */
export function podProblems(podfileLock: string, declared: ReadonlySet<string>): string[] {
  const trunk = trunkPods(podfileLock)
    .filter((pod) => !declared.has(pod))
    .map((pod) => `trunk pod ${pod} is not brought by an SDK declared in contracts/privacy.json`);
  const external = [...externalSources(podfileLock)].flatMap(([pod, source]) => {
    const foreign = declared.has(pod) ? null : foreignSource(source);
    return foreign === null
      ? []
      : [
          `pod ${pod} comes from a :${foreign[0]} source (${foreign[1]}), not the trunk or the repo`,
        ];
  });
  return [...trunk, ...external];
}
