// scripts/release/release-preflight.ts
// Release steps 1-2: what must be true before anything is built, committed or uploaded (stop on the
// first failure), the app's identity as app.config.ts resolves it for this variant, the What to Test
// text (built and length-checked here), then the build-number bump commit.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { bumpBuildNumber, bumpSubject, resumableBuildNumber } from './build-number.ts';
import { isVersionAboveLastRelease } from './processing.ts';
import { appPrefix, variantBundleId } from './release-config.ts';
import { ascKeyFile, readAscIds } from './release-options.ts';
import { git, gitLines, readText, runReleaseStep } from './release-steps.ts';
import { releaseWhatToTest } from './what-to-test.ts';
import { loadAscCredentials } from '../asc/asc-credentials.ts';
import { createAscJwt } from '../asc/asc-jwt.ts';
import { findAppByBundleId } from '../asc/find-app.ts';
import { nowEpochSeconds } from '../clock/system-clock.ts';

import type { ReleaseConfig } from './release-config.ts';
import type { AscIds, ReleaseOptions } from './release-options.ts';
import type { ReleaseContext } from './release-steps.ts';
import type { BuildHistory } from './what-to-test.ts';

export type AppIdentity = {
  readonly name: string;
  readonly bundleId: string;
  readonly version: string;
  readonly appleAppId: string;
};

export type Preflight = {
  readonly ids: AscIds;
  readonly keyFile: string;
  readonly app: AppIdentity;
  /** The tester text the what-to-test step sends, built and length-checked before anything else. */
  readonly whatToTest: string;
  /** Lines for the report's "Human steps (not blocking)", such as a pending translation review. */
  readonly humanSteps: readonly string[];
};

/** i18n-strings-and-catalogs' review sheet; a release preflight runs it when the app has it. */
const REVIEW_SHEET = join('scripts', 'i18n', 'review-sheet.ts');

/** The `REVIEW PENDING (not blocking): ...` lines of the review sheet's output (it always exits 0). */
export function reviewPendingLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('REVIEW PENDING (not blocking):'));
}

/** Runs the review sheet for a store build when the app has one; its pending line never blocks. */
function translationReviewSteps(variant: ReleaseOptions['variant']): string[] {
  if (variant !== 'production' || !existsSync(REVIEW_SHEET)) return [];
  const run = spawnSync('node', [REVIEW_SHEET, '--release'], { encoding: 'utf8' });
  return reviewPendingLines(run.stdout);
}

/** The unfinished-work markers (contract unfinishedMarkers) that exist under `root`. */
export function unfinishedMarkersFound(root: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => existsSync(join(root, marker)));
}

/** What changed since the previous upload tag ('' = none: the first build). */
function changesSincePreviousBuild(prefix: string, appDir: string): BuildHistory {
  const previousTag =
    gitLines(['tag', '--list', `${prefix}v*+ios.*`, '--sort=-creatordate'])[0] ?? '';
  if (previousTag === '') return { previousTag, subjects: [], files: [] };
  const range = `${previousTag}..HEAD`;
  const subjects = gitLines(['log', '--format=%s', range, '--', appDir]).filter((subject) =>
    /^(feat|fix)(\(|!|:)/.test(subject),
  );
  return { previousTag, subjects, files: gitLines(['diff', '--name-only', range, '--', appDir]) };
}

function assertCleanBranch(config: ReleaseConfig): void {
  if (git(['status', '--porcelain']) !== '') {
    throw new Error(
      'the working tree is not clean: commit or stash first (a release builds one commit)',
    );
  }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== config.releaseBranch) {
    throw new Error(`releases are made from ${config.releaseBranch}, not "${branch}"`);
  }
  const found = unfinishedMarkersFound('.', config.unfinishedMarkers);
  if (found.length > 0) {
    throw new Error(
      `unfinished work is still marked (${found.join(', ')}): finish it and delete the marker before a release`,
    );
  }
}

/** Checks the key file by path and mode only: it is never opened, printed or copied here. */
function assertKeyFile(ids: AscIds): string {
  const keyFile = ascKeyFile(homedir(), ids.keyId);
  if (!existsSync(keyFile)) {
    throw new Error(
      `no key file AuthKey_${ids.keyId}.p8 in ~/.appstoreconnect/private_keys. Human step (API key).`,
    );
  }
  if ((statSync(keyFile).mode & 0o777) !== 0o600) {
    throw new Error(
      `the key file must be mode 600 (chmod 600 on AuthKey_${ids.keyId}.p8). Human step (API key).`,
    );
  }
  return keyFile;
}

function assertKeychainUnlocked(): void {
  const keychain = join(homedir(), 'Library', 'Keychains', 'login.keychain-db');
  if (spawnSync('security', ['show-keychain-info', keychain]).status !== 0) {
    throw new Error('the login keychain is locked: human step (unlock the keychain), then rerun');
  }
}

/** Name, bundle id and version as app.config.ts resolves them with this run's environment. */
function readIdentity(context: ReleaseContext): Omit<AppIdentity, 'appleAppId'> {
  const json = runReleaseStep(
    'expo-config',
    { file: 'npx', args: ['expo', 'config', '--json', '--type', 'public'] },
    context,
  );
  const config = JSON.parse(json) as {
    name?: string;
    version?: string;
    ios?: { bundleIdentifier?: string };
  };
  const { name = '', version = '', ios } = config;
  const bundleId = ios?.bundleIdentifier ?? '';
  if (name === '' || version === '' || bundleId === '') {
    throw new Error('app.config.ts resolved without name, version or ios.bundleIdentifier');
  }
  return { name, version, bundleId };
}

/** A store build needs a version above the last release tag (App Store Connect: ITMS-90062). */
function assertVersionRaised(version: string, config: ReleaseConfig): void {
  if (!isVersionAboveLastRelease(version, gitLines(['tag', '--list']), appPrefix(config))) {
    throw new Error(
      `version ${version} is not above the last release tag: raise it in app.config.ts (ITMS-90062)`,
    );
  }
}

async function lookUpAppleAppId(bundleId: string, env: NodeJS.ProcessEnv): Promise<string> {
  const token = createAscJwt(loadAscCredentials(env), nowEpochSeconds());
  const app = await findAppByBundleId(token, bundleId);
  if (app === null) {
    throw new Error(
      `No App Store Connect app record for ${bundleId}. Human step (app record): create it (Apps > + > New App).`,
    );
  }
  return app.id;
}

/** The build number this run will use: the next one, or with --resume the stopped run's. */
export function plannedBuildNumber(options: ReleaseOptions, config: ReleaseConfig): number {
  const source = readText(join(config.appDir, 'app.config.ts'));
  if (options.resume === null) return bumpBuildNumber(source).next;
  return resumableBuildNumber({
    prefix: appPrefix(config),
    appConfigSource: source,
    headSubject: git(['log', '-1', '--format=%s']),
    tags: gitLines(['tag', '--list']),
  });
}

export type PreflightInput = {
  readonly options: ReleaseOptions;
  readonly config: ReleaseConfig;
  readonly context: ReleaseContext;
};

/** Step 1: stop on the first failure, before anything is built, committed or uploaded. */
export async function preflight(input: PreflightInput): Promise<Preflight> {
  const { options, config, context } = input;
  assertCleanBranch(config);
  const ids = readAscIds(context.env);
  const keyFile = assertKeyFile(ids);
  assertKeychainUnlocked();
  const identity = readIdentity(context);
  const wanted = variantBundleId(config.appId, options.variant);
  if (identity.bundleId !== wanted) {
    throw new Error(
      `the ${options.variant} bundle id is ${identity.bundleId}, not ${wanted} (contracts/ios-release.json appId and app-variant.ts)`,
    );
  }
  const whatToTest = releaseWhatToTest({
    appName: identity.name,
    version: identity.version,
    buildNumber: plannedBuildNumber(options, config),
    variant: options.variant,
    notes: options.notes,
    knownIssues: options.knownIssues,
    history: changesSincePreviousBuild(appPrefix(config), config.appDir),
    ...config.whatToTest,
  });
  for (const script of config.preflight) {
    runReleaseStep(
      `preflight-${script.replaceAll(':', '-')}`,
      { file: 'npm', args: ['run', '-s', script], atRoot: true },
      context,
    );
  }
  if (options.variant === 'production') assertVersionRaised(identity.version, config);
  const appleAppId = await lookUpAppleAppId(identity.bundleId, context.env);
  const humanSteps = translationReviewSteps(options.variant);
  return { ids, keyFile, app: { ...identity, appleAppId }, whatToTest, humanSteps };
}

/**
 * Step 2: +1 on the single IOS_BUILD_NUMBER line, committed before the archive; never rolled back.
 * With --resume the committed number of the stopped run is reused (checked, never guessed).
 */
export function bumpAndCommit(options: ReleaseOptions, config: ReleaseConfig): number {
  if (options.resume !== null) {
    const reused = plannedBuildNumber(options, config);
    console.log(`release:ios: resuming (${options.resume}) with build ${String(reused)}`);
    return reused;
  }
  const file = join(config.appDir, 'app.config.ts');
  const bump = bumpBuildNumber(readText(file));
  writeFileSync(file, bump.text);
  git(['add', file]);
  const body = `App Store Connect build for the ${options.variant} variant (TestFlight).`;
  git(['commit', '-m', bumpSubject(appPrefix(config), bump.next), '-m', body]);
  return bump.next;
}
