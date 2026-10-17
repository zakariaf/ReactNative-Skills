// scripts/eas/release-plan.ts
// The decisions of the release preflight, as pure functions over facts the CLI gathered: a clean
// committed tree on the release branch, a store profile, a version above the last release tag, and
// an app config whose ids are the ones submit pins. Each returns the problems ([] = go on).
import { EAS_PLATFORMS, storeProfileProblems, submitIdsOf } from './eas-profile.ts';

import type { EasJson, EasPlatform } from './eas-profile.ts';

export type RepoFacts = {
  /** `git status --porcelain` output: empty for a clean tree. */
  readonly gitStatus: string;
  /** `git rev-parse --abbrev-ref HEAD`. */
  readonly branch: string;
  readonly releaseBranch: string;
};

export type ConfigFacts = {
  /** `expo config --type public --json` evaluated with the profile's env. */
  readonly version: string | null;
  readonly ids: Readonly<Record<EasPlatform, string | null>>;
  /** Every tag `git tag --list 'v*'` printed. */
  readonly tags: readonly string[];
};

const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/u;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;

function parts(text: string, pattern: RegExp): readonly number[] | null {
  const match = pattern.exec(text);
  return match === null ? null : match.slice(1, 4).map(Number);
}

/** -1, 0 or 1 for two parsed x.y.z versions. */
function compare(a: readonly number[], b: readonly number[]): number {
  const index = a.findIndex((value, i) => value !== b[i]);
  if (index < 0) return 0;
  return (a[index] ?? 0) < (b[index] ?? 0) ? -1 : 1;
}

/** The highest release tag vX.Y.Z (upload tags with +ios.N / +android.N do not count), or null. */
export function lastReleaseVersion(tags: readonly string[]): string | null {
  const released = tags
    .map((tag) => parts(tag, RELEASE_TAG))
    .filter((value): value is readonly number[] => value !== null)
    .sort(compare);
  const last = released.at(-1);
  return last === undefined ? null : last.join('.');
}

/** Problems with the tree and the profile, checked before the slow gates run. */
export function repoProblems(eas: EasJson, profile: string, facts: RepoFacts): readonly string[] {
  const problems: string[] = [];
  if (facts.gitStatus.trim() !== '') {
    problems.push('the working tree has uncommitted or untracked files: commit or stash them');
  }
  if (facts.branch !== facts.releaseBranch) {
    problems.push(
      `HEAD is on "${facts.branch}", not on the release branch "${facts.releaseBranch}"`,
    );
  }
  for (const platform of EAS_PLATFORMS) {
    problems.push(...storeProfileProblems(eas, profile, platform));
  }
  return [...new Set(problems)];
}

/** Problems with the app config the profile's env produces. */
export function configProblems(
  eas: EasJson,
  profile: string,
  facts: ConfigFacts,
): readonly string[] {
  const problems: string[] = [];
  const version = facts.version === null ? null : parts(facts.version, VERSION);
  const last = lastReleaseVersion(facts.tags);
  if (version === null) {
    problems.push(`the app config version "${String(facts.version)}" is not MAJOR.MINOR.PATCH`);
  } else if (last !== null && compare(version, parts(last, VERSION) ?? []) <= 0) {
    problems.push(`version ${version.join('.')} is not above the last release v${last}: raise it`);
  }
  const pinned = submitIdsOf(eas, profile);
  for (const platform of EAS_PLATFORMS) {
    const id = facts.ids[platform];
    const pin = pinned[platform];
    if (pin !== null && id !== pin) {
      problems.push(
        `the ${platform} id of the build is ${String(id)}, but submit.${profile} pins ${pin}`,
      );
    }
  }
  return problems;
}
