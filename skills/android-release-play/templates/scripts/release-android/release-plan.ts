// scripts/release-android/release-plan.ts
// The pure decisions of `npm run release:android` (local lane): the release contract, the preflight
// refusals, the toolchain, the gate stamp that must match the bytes before any upload, the rollout
// step check, the release an upload sends, the package.json the prebuild rewrites, and the paths and
// arguments of each step.
import type { TrackRelease } from './play-client.ts';

/** contracts/android-release.json, the parts the release tooling reads (optional keys defaulted). */
export type ReleaseContract = {
  readonly lane: 'eas' | 'local';
  readonly applicationId: string;
  readonly uploadTrack: 'internal' | 'alpha' | 'beta';
  readonly rollout: readonly number[];
  /** The branch local-lane releases come from (default main). */
  readonly releaseBranch: string;
  /** The language of the release notes: the default store listing's (default en-US). */
  readonly releaseNotesLanguage: string;
};

/** What check-store-aab.mjs --stamp writes after a PASS on one bundle. */
export type GateStamp = {
  readonly result: string;
  readonly sha256: string;
  readonly versionCode: number;
  readonly applicationId: string;
  readonly isRehearsal: boolean;
};

/** What the preflight reads from the repo before anything is bumped or built. */
export type ReleaseState = {
  readonly branch: string;
  readonly releaseBranch: string;
  readonly isTreeClean: boolean;
  readonly isVerifyGreen: boolean;
  readonly lane: string;
};

export const CONTRACT_PATH = 'contracts/android-release.json';
export const DEFAULT_RELEASE_BRANCH = 'main';
export const DEFAULT_RELEASE_NOTES_LANGUAGE = 'en-US';
export const AAB_PATH = 'android/app/build/outputs/bundle/release/app-release.aab';
export const STAMP_PATH = 'build/release-android/aab-gate.json';
export const LOG_DIR = 'build/release-android/logs';
export const PREBUILD_ARGS = ['expo', 'prebuild', '--platform', 'android', '--clean'];
/** The Play bundle; assembleRelease would make an APK, which Play no longer takes for new apps. */
export const BUNDLE_ARGS = ['-p', 'android', 'bundleRelease', '--console=plain'];

const TRACKS: readonly ReleaseContract['uploadTrack'][] = ['internal', 'alpha', 'beta'];
const BRANCH_NAME = /^(?!-)[\w./-]+$/u;
const PLAY_LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
/** The npm scripts `expo prebuild` rewrites: 'expo start --android' becomes 'expo run:android'. */
const PREBUILD_REWRITTEN_SCRIPTS = new Set(['ios', 'android']);

function withoutRewrittenScripts(text: string): string {
  const pkg = JSON.parse(text) as { readonly scripts?: Readonly<Record<string, string>> };
  const scripts = Object.entries(pkg.scripts ?? {}).filter(
    ([name]) => !PREBUILD_REWRITTEN_SCRIPTS.has(name),
  );
  return JSON.stringify({ ...pkg, scripts: Object.fromEntries(scripts) });
}

/**
 * True when package.json after the prebuild (`after`) differs from `before` only in the ios and
 * android scripts: the build then writes `before` back, so the tree stays clean for the next run's
 * preflight. Any other change stays for the developer to review.
 */
export function onlyScriptsRewritten(before: string, after: string): boolean {
  return before !== after && withoutRewrittenScripts(before) === withoutRewrittenScripts(after);
}

function isTrack(value: unknown): value is ReleaseContract['uploadTrack'] {
  return TRACKS.some((track) => track === value);
}

function isFractionList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((step) => typeof step === 'number');
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An optional string key: its default when absent, else the value when it matches. */
function optionalText(
  value: unknown,
  rule: { readonly key: string; readonly fallback: string; readonly pattern: RegExp },
): string {
  if (value === undefined) {
    return rule.fallback;
  }
  if (typeof value !== 'string' || !rule.pattern.test(value)) {
    throw new Error(
      `${CONTRACT_PATH} ${rule.key} must look like "${rule.fallback}" or be left out`,
    );
  }
  return value;
}

/** Parses the contract text; throws with the key that is wrong. */
export function parseReleaseContract(text: string): ReleaseContract {
  const data: unknown = JSON.parse(text);
  if (!isObject(data)) {
    throw new Error(`${CONTRACT_PATH} is not a JSON object`);
  }
  const { lane, applicationId, uploadTrack, rollout, releaseBranch, releaseNotesLanguage } = data;
  if (lane !== 'eas' && lane !== 'local') {
    throw new Error(`${CONTRACT_PATH} lane must be "eas" or "local"`);
  }
  if (typeof applicationId !== 'string') {
    throw new Error(`${CONTRACT_PATH} applicationId must be the production android.package`);
  }
  if (!isTrack(uploadTrack)) {
    throw new Error(`${CONTRACT_PATH} uploadTrack must be internal, alpha or beta`);
  }
  if (!isFractionList(rollout)) {
    throw new Error(
      `${CONTRACT_PATH} rollout must list fractions, for example [0.05, 0.2, 0.5, 1]`,
    );
  }
  return {
    lane,
    applicationId,
    uploadTrack,
    rollout,
    releaseBranch: optionalText(releaseBranch, {
      key: 'releaseBranch',
      fallback: DEFAULT_RELEASE_BRANCH,
      pattern: BRANCH_NAME,
    }),
    releaseNotesLanguage: optionalText(releaseNotesLanguage, {
      key: 'releaseNotesLanguage',
      fallback: DEFAULT_RELEASE_NOTES_LANGUAGE,
      pattern: PLAY_LANGUAGE,
    }),
  };
}

/** Every reason this commit may not be released; empty when the release may start. */
export function preflightProblems(state: ReleaseState): string[] {
  return [
    ...(state.lane === 'local'
      ? []
      : [
          `${CONTRACT_PATH} lane is ${state.lane}: EAS builds and submits this app (eas-build-and-submit)`,
        ]),
    ...(state.isTreeClean
      ? []
      : [
          'the working tree is not clean: commit or stash first (the release commits the build number)',
        ]),
    ...(state.branch === state.releaseBranch
      ? []
      : [
          `releases come from ${state.releaseBranch} (the contract releaseBranch), this is ${state.branch}`,
        ]),
    ...(state.isVerifyGreen ? [] : ['npm run verify is not green on this commit']),
  ];
}

/** JAVA_HOME (JDK 17) and ANDROID_HOME must be set; the build never guesses a toolchain. */
export function toolchainProblems(env: Readonly<Record<string, string | undefined>>): string[] {
  return [
    ...((env['JAVA_HOME'] ?? '') !== ''
      ? []
      : ['JAVA_HOME is not set: point it at a JDK 17 (Android Studio ships one)']),
    ...((env['ANDROID_HOME'] ?? '') !== ''
      ? []
      : ['ANDROID_HOME is not set: point it at the Android SDK (android-emulator-build)']),
  ];
}

/** The upload goes out only for the exact bytes the gate passed, never after a rehearsal. */
export function uploadProblems(input: {
  readonly stamp: GateStamp | null;
  readonly aabSha256: string;
  readonly applicationId: string;
}): string[] {
  const { stamp } = input;
  if (stamp === null) {
    return ['no gate stamp: run check-store-aab.mjs with --stamp on this bundle first'];
  }
  if (stamp.result !== 'PASS' || stamp.isRehearsal) {
    return ['the stamp is not a passing gate run (a rehearsal is never release evidence)'];
  }
  if (stamp.sha256 !== input.aabSha256) {
    return [
      'the bundle changed after the gate (sha256 differs): run check-store-aab.mjs on these bytes',
    ];
  }
  return stamp.applicationId === input.applicationId
    ? []
    : [`the gate checked ${stamp.applicationId}, this release is ${input.applicationId}`];
}

/**
 * The release an upload puts on the testing track: completed (draft while the Play app is a draft),
 * with the notes in the contract releaseNotesLanguage when given.
 */
export function uploadRelease(input: {
  readonly notes: string | null;
  readonly isDraftApp: boolean;
  readonly language: string;
}): Omit<TrackRelease, 'versionCodes'> {
  const status = input.isDraftApp ? 'draft' : 'completed';
  return input.notes === null
    ? { status }
    : { status, releaseNotes: [{ language: input.language, text: input.notes }] };
}

/** A rollout fraction must be one of the contract's steps. */
export function rolloutStepProblems(fraction: number, steps: readonly number[]): string[] {
  return steps.includes(fraction)
    ? []
    : [
        `--fraction ${String(fraction)} is not one of the contract rollout steps ${steps.join(', ')}`,
      ];
}

/** The gate command the build prints for the person or agent to run next. */
export function gateCommand(versionCode: number): string {
  return `node <android-release-play>/scripts/check-store-aab.mjs . --aab ${AAB_PATH} --version-code ${String(versionCode)} --stamp ${STAMP_PATH}`;
}
