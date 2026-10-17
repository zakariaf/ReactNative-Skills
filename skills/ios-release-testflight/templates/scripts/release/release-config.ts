// scripts/release/release-config.ts
// The app's own release facts, read from contracts/ios-release.json: the production bundle id, the
// branch releases come from, the npm scripts the release runs, what the store-artifact gate must
// find (usage strings, the encryption answer) or never find (forbidden bundle strings, unfinished
// markers), the ads mode the store build ships with, and the What to Test lines. The
// ios-release-testflight skill's checkers read the same file, including the keys only they use
// (adIdsFile), which this reader ignores.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as v from 'valibot';

import { variantIdentity } from '../../src/config/app-variant.ts';

import type { AppVariant } from '../../src/config/app-variant.ts';

/** The contract file, relative to the repo root. */
export const RELEASE_CONTRACT = join('contracts', 'ios-release.json');

const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const USAGE_KEY = /^NS[A-Za-z]+UsageDescription$/;
const TEXT = v.pipe(v.string(), v.minLength(1));
const TEXTS = v.array(TEXT);

const CONTRACT_SCHEMA = v.object({
  appId: v.pipe(v.string(), v.regex(BUNDLE_ID, 'must be a reverse-DNS bundle id')),
  appDir: v.optional(TEXT, '.'),
  releaseBranch: v.optional(TEXT, 'main'),
  preflight: v.optional(TEXTS, ['verify']),
  postPrebuild: v.optional(TEXTS, []),
  usageStrings: v.optional(
    v.array(v.pipe(v.string(), v.regex(USAGE_KEY, 'must be NS*UsageDescription'))),
    [],
  ),
  usesNonExemptEncryption: v.optional(v.nullable(v.boolean()), null),
  forbiddenBundleStrings: v.optional(TEXTS, []),
  unfinishedMarkers: v.optional(TEXTS, []),
  productionAdsMode: v.optional(v.picklist(['live', 'off']), 'live'),
  whatToTest: v.optional(
    v.object({
      always: v.optional(TEXTS, []),
      whenChanged: v.optional(v.array(v.object({ paths: TEXTS, line: TEXT })), []),
    }),
    { always: [], whenChanged: [] },
  ),
});

/** A tester note listed when files under one of `paths` changed since the last build (or on the first). */
export type ChangeCheck = { readonly paths: readonly string[]; readonly line: string };

/** Everything the release needs from the contract, defaults filled in. */
export type ReleaseConfig = {
  /** The production bundle id; testing variants extend it (variantIdentity). */
  readonly appId: string;
  /** The app's folder ('.' for a single app; when multi-package, apps/<app>). */
  readonly appDir: string;
  readonly releaseBranch: string;
  /** npm scripts run before the build number is bumped (default: verify). */
  readonly preflight: readonly string[];
  /** npm scripts run from the repo root right after the clean prebuild (they may read ios/Pods). */
  readonly postPrebuild: readonly string[];
  readonly usageStrings: readonly string[];
  readonly usesNonExemptEncryption: boolean | null;
  readonly forbiddenBundleStrings: readonly string[];
  readonly unfinishedMarkers: readonly string[];
  /** ADS_MODE of a production build when --ads is not given ('off' for an app that ships without ads). */
  readonly productionAdsMode: 'live' | 'off';
  readonly whatToTest: {
    readonly always: readonly string[];
    readonly whenChanged: readonly ChangeCheck[];
  };
};

/** Validates the parsed contract and fills the defaults; names every invalid key. */
export function parseReleaseConfig(raw: unknown): ReleaseConfig {
  const result = v.safeParse(CONTRACT_SCHEMA, raw);
  if (!result.success) {
    const where = result.issues.map(
      (issue) => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`,
    );
    throw new Error(`${RELEASE_CONTRACT} is not valid: ${where.join('; ')}`);
  }
  return result.output;
}

/** The contract of the repo at `root`; a release without it stops before anything happens. */
export function readReleaseConfig(root: string): ReleaseConfig {
  const path = join(root, RELEASE_CONTRACT);
  if (!existsSync(path)) {
    throw new Error(
      `${RELEASE_CONTRACT} is missing: copy the ios-release-testflight skill's templates/contracts/ios-release.json and set appId`,
    );
  }
  return parseReleaseConfig(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

/** The bundle id a build of `variant` carries: <appId>, <appId>.preview, <appId>.dev. */
export function variantBundleId(appId: string, variant: AppVariant): string {
  return variantIdentity({ appId, name: '', scheme: '' }, variant).appId;
}

/** The tag and commit prefix of the app ('' for a single app; '<folder>/' when multi-package). */
export function appPrefix(config: Pick<ReleaseConfig, 'appDir'>): string {
  const folder = config.appDir.replace(/\/+$/, '').split('/').at(-1) ?? '.';
  return folder === '.' || folder === '' ? '' : `${folder}/`;
}

/** What releaseAdsMode reads from the parsed options. */
export type AdsChoice = { readonly variant: AppVariant; readonly adsMode: string | null };

/**
 * The ADS_MODE a run exports, resolved once for the build env and the store gate so the two never
 * differ: --ads when given; 'off' for a production build of an app whose contract ships without ads
 * (productionAdsMode "off"); otherwise null, the app's own default for the variant (admob's
 * resolveAdsMode: live in production, test in preview).
 */
export function releaseAdsMode(
  options: AdsChoice,
  config: Pick<ReleaseConfig, 'productionAdsMode'>,
): string | null {
  if (options.adsMode !== null) return options.adsMode;
  return options.variant === 'production' && config.productionAdsMode === 'off' ? 'off' : null;
}
