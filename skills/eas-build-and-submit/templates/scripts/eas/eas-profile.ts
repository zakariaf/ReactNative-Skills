// scripts/eas/eas-profile.ts
// Resolves an eas.json build profile the way EAS CLI 24.10.0 does (@expo/eas-json 24.9.0: the
// extends chain at most 5 deep, update keys win, env and the platform blocks merge one level, then the
// platform block over the common keys, then the defaults distribution "store" and credentials
// "remote"), and says why a profile may not reach the stores. Pure: the caller reads the file.
import { isAppVariant, isStoreVariant } from '../../src/config/app-variant.ts';

export type EasPlatform = 'ios' | 'android';

export type BuildProfile = {
  readonly extends?: string;
  readonly distribution?: 'store' | 'internal';
  readonly autoIncrement?: boolean | string;
  readonly developmentClient?: boolean;
  readonly environment?: string;
  readonly node?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly simulator?: boolean;
  readonly buildType?: 'apk' | 'app-bundle';
  readonly withoutCredentials?: boolean;
  readonly ios?: BuildProfile;
  readonly android?: BuildProfile;
};

export type SubmitProfile = {
  readonly ios?: { readonly ascAppId?: string; readonly bundleIdentifier?: string };
  readonly android?: {
    readonly applicationId?: string;
    readonly track?: string;
    readonly releaseStatus?: string;
  };
};

export type EasJson = {
  readonly cli?: {
    readonly version?: string;
    readonly appVersionSource?: 'local' | 'remote';
    readonly requireCommit?: boolean;
  };
  readonly build?: Readonly<Record<string, BuildProfile>>;
  readonly submit?: Readonly<Record<string, SubmitProfile>>;
};

export const EAS_PLATFORMS: readonly EasPlatform[] = ['ios', 'android'];

const MAX_EXTENDS = 5;
const DEFAULTS: BuildProfile = { distribution: 'store' };

/** EAS's mergeProfiles: update wins; env, ios and android merge one level deeper. */
function merge(base: BuildProfile, update: BuildProfile): BuildProfile {
  const env =
    base.env !== undefined && update.env !== undefined ? { ...base.env, ...update.env } : {};
  const ios =
    base.ios !== undefined && update.ios !== undefined ? { ios: merge(base.ios, update.ios) } : {};
  const android =
    base.android !== undefined && update.android !== undefined
      ? { android: merge(base.android, update.android) }
      : {};
  const merged = { ...base, ...update, ...ios, ...android };
  return Object.keys(env).length > 0 ? { ...merged, env } : merged;
}

function chain(eas: EasJson, name: string, depth: number): BuildProfile {
  if (depth >= MAX_EXTENDS) {
    throw new Error(`build profile "${name}": extends chain too long or a cycle`);
  }
  const profile = eas.build?.[name];
  if (profile === undefined) {
    const what = depth === 0 ? 'missing build profile' : 'extends a missing build profile';
    throw new Error(`${what} "${name}" in eas.json`);
  }
  const { extends: parent, ...rest } = profile;
  return parent === undefined ? rest : merge(chain(eas, parent, depth + 1), rest);
}

/** The profile EAS CLI builds for one platform. Throws on a missing profile or a broken chain. */
export function resolveBuildProfile(
  eas: EasJson,
  name: string,
  platform: EasPlatform,
): BuildProfile {
  const { ios, android, ...common } = chain(eas, name, 0);
  const block = platform === 'ios' ? ios : android;
  return merge(DEFAULTS, merge(common, block ?? {}));
}

function profileProblems(profile: BuildProfile, where: string): readonly string[] {
  const variant = profile.env?.['APP_VARIANT'] ?? '';
  const problems: string[] = [];
  if (!isAppVariant(variant) || !isStoreVariant(variant)) {
    problems.push(`${where} builds variant "${variant}", not production`);
  }
  if (profile.distribution !== 'store' || profile.simulator === true) {
    problems.push(`${where} is not a store build (distribution store, no simulator)`);
  }
  if (profile.autoIncrement !== true) {
    problems.push(`${where} has no autoIncrement: true, so a build number could repeat`);
  }
  if (profile.node === undefined) problems.push(`${where} pins no node for the EAS install`);
  return problems;
}

/** Why `profile` may not build for the stores on `platform` ([] when it may). */
export function storeProfileProblems(
  eas: EasJson,
  name: string,
  platform: EasPlatform,
): readonly string[] {
  const profile = resolveBuildProfile(eas, name, platform);
  const problems = [...profileProblems(profile, `build.${name} (${platform})`)];
  if (eas.cli?.appVersionSource !== 'remote') problems.push('cli.appVersionSource is not "remote"');
  if (eas.cli?.requireCommit !== true) problems.push('cli.requireCommit is not true');
  return problems;
}

/** The store ids submit.<profile> pins per platform (null when not pinned). */
export function submitIdsOf(
  eas: EasJson,
  profile: string,
): Readonly<Record<EasPlatform, string | null>> {
  const submit = eas.submit?.[profile];
  return {
    ios: submit?.ios?.bundleIdentifier ?? null,
    android: submit?.android?.applicationId ?? null,
  };
}
