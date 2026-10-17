// scripts/eas/eas-commands.ts
// The EAS CLI command lines a release runs, built from one typed plan so that every call names its
// profile, never prompts, keeps the stored credentials as they are and submits the one file its
// store-artifact gate read; the whole release sequence (build, record checks, download, store-artifact
// gates, submits by --path); and the annotated upload tag written after a successful submission
// (vX.Y.Z+ios.<n>, vX.Y.Z+android.<n>).
// Pure: nothing here runs eas. The preflight prints these lines; the developer's word runs them.
import type { EasPlatform } from './eas-profile.ts';

/** App Store Connect's limit for a build's "What to Test" text (betaBuildLocalizations whatsNew). */
export const WHAT_TO_TEST_MAX = 4000;

export type BuildPlan = {
  readonly profile: string;
  readonly platform: EasPlatform | 'all';
  /**
   * Submits each build the moment it finishes, before its record is checked. False by default; true
   * only from a store profile, only for iOS (Android always submits the .aab its store-artifact gate
   * read) and only when the developer agreed to skip the record check.
   */
  readonly autoSubmit: boolean;
  /** Shown on the build page; the commit subject is a good default. */
  readonly message: string;
  readonly whatToTest?: string;
};

export type SubmitPlan = {
  readonly profile: string;
  readonly platform: EasPlatform;
  /**
   * The downloaded artifact the store-artifact gate passed (.ipa for iOS, .aab for Android); never
   * --latest, which takes whatever build finished last.
   */
  readonly path: string;
  readonly whatToTest?: string;
};

export type UploadTag = { readonly name: string; readonly message: string };

/**
 * What the check lines need: the record checker's path, the repo's upload tags (git tag --list 'v*')
 * and the app config version the store-artifact gate lines name (a <version> fill-in when unknown).
 */
export type RecordCheck = {
  readonly checker: string;
  readonly uploadTags: readonly string[];
  readonly version?: string;
};

/** The commands a store release runs after the preflight, in order. */
export type ReleaseLines = {
  /** `eas build ... --json > dist/eas/builds.json` (the records come back as data). */
  readonly build: string;
  /** One check-eas-build line per platform, run on the saved records before anything is submitted. */
  readonly checks: readonly string[];
  /**
   * Per platform: download the record's artifact to GATED_ARTIFACTS[platform], then the store's own
   * gate on that file (fill-ins: <ios-archive-url>, <ios-build-number>, ...); none with autoSubmit.
   */
  readonly gates: readonly string[];
  /** One `eas submit --path <gated file>` line per platform; none with autoSubmit. */
  readonly submits: readonly string[];
  /**
   * Platforms with no upload tag yet: their check line carries --previous <last-<platform>-build-number>
   * for the reader to fill in (eas build:version:get), or to replace with --first on a first upload.
   */
  readonly untagged: readonly EasPlatform[];
};

/** Where the build line saves the records that check-eas-build reads. */
export const BUILDS_JSON = 'dist/eas/builds.json';

/**
 * Where each platform's downloaded artifact is gated and submitted from: the paths
 * ios-release-testflight and android-release-play use, so the gated file and the submitted file are
 * one file (build/ is git-ignored, which requireCommit needs).
 */
export const GATED_ARTIFACTS: Readonly<Record<EasPlatform, string>> = {
  ios: 'build/ios-release/export/app.ipa',
  android: 'build/release-android/app-release.aab',
};

const ARTIFACT_EXTENSION: Readonly<Record<EasPlatform, string>> = { ios: '.ipa', android: '.aab' };
const VERSION = /^\d+\.\d+\.\d+$/u;
/** A value the reader fills in, such as <ios-build-number>; commandLine leaves it unquoted. */
const FILL_IN = /^<[a-z-]+>$/u;

function whatToTestArgs(text: string | undefined, platform: EasPlatform | 'all'): string[] {
  if (text === undefined) return [];
  if (platform === 'android') throw new Error('--what-to-test is a TestFlight field (iOS only)');
  if (text.trim() === '') throw new Error('the What to Test text is empty');
  if (text.length > WHAT_TO_TEST_MAX) {
    throw new Error(
      `the What to Test text has ${String(text.length)} characters, over ${String(WHAT_TO_TEST_MAX)}`,
    );
  }
  return ['--what-to-test', text];
}

/** `eas build` arguments; `isStoreProfile` says whether plan.profile builds for the stores. */
export function easBuildArgs(plan: BuildPlan, isStoreProfile: boolean): readonly string[] {
  if (plan.autoSubmit && !isStoreProfile) {
    throw new Error(`--auto-submit needs a store profile; "${plan.profile}" is not one`);
  }
  if (plan.autoSubmit && plan.platform !== 'ios') {
    throw new Error(
      '--auto-submit is iOS only: Android submits the .aab its store-artifact gate read (android-release-play)',
    );
  }
  if (plan.whatToTest !== undefined && !plan.autoSubmit) {
    throw new Error('--what-to-test only reaches TestFlight together with --auto-submit');
  }
  return [
    'build',
    '--profile',
    plan.profile,
    '--platform',
    plan.platform,
    '--non-interactive',
    '--freeze-credentials',
    '--message',
    plan.message,
    ...(plan.autoSubmit ? ['--auto-submit'] : []),
    ...whatToTestArgs(plan.whatToTest, plan.platform),
  ];
}

function submitArgs(plan: SubmitPlan): readonly string[] {
  return [
    'submit',
    '--profile',
    plan.profile,
    '--platform',
    plan.platform,
    '--path',
    plan.path,
    '--non-interactive',
    ...whatToTestArgs(plan.whatToTest, plan.platform),
  ];
}

/** `eas submit` arguments for the one file the store-artifact gate passed. */
export function easSubmitArgs(plan: SubmitPlan): readonly string[] {
  const extension = ARTIFACT_EXTENSION[plan.platform];
  if (!plan.path.endsWith(extension)) {
    throw new Error(
      `"${plan.path}" is not a gated ${extension} file (the store-artifact gate reads one)`,
    );
  }
  return submitArgs(plan);
}

/** Whether the upload tags hold one for this platform (vX.Y.Z+<platform>.<n>). */
export function hasUploadTag(tags: readonly string[], platform: EasPlatform): boolean {
  const pattern = new RegExp(`^v\\d+\\.\\d+\\.\\d+\\+${platform}\\.\\d+$`, 'u');
  return tags.some((tag) => pattern.test(tag.trim()));
}

/**
 * One check-eas-build line. Without an upload tag the checker cannot know the last uploaded number
 * (it stops with "no upload tag"), so the line asks for it as a fill-in.
 */
function checkLine(check: RecordCheck, platform: EasPlatform): string {
  const line = `node ${check.checker} . --build ${BUILDS_JSON} --platform ${platform}`;
  return hasUploadTag(check.uploadTags, platform)
    ? line
    : `${line} --previous <last-${platform}-build-number>`;
}

/** Download the record's artifact, then the platform's store-artifact gate on that file. */
function gateLines(platform: EasPlatform, version: string): readonly string[] {
  const file = GATED_ARTIFACTS[platform];
  const download = `curl -fsSL -o ${file} <${platform}-archive-url>`;
  return platform === 'ios'
    ? [
        download,
        `node <ios-release-testflight>/scripts/check-store-artifact.mjs . --ipa ${file} --variant production --version ${version} --build <ios-build-number>`,
      ]
    : [
        download,
        `node <android-release-play>/scripts/check-store-aab.mjs . --aab ${file} --version-code <android-build-number> --stamp build/release-android/aab-gate.json`,
      ];
}

/**
 * The release sequence: build (records saved as JSON), check each record with check-eas-build
 * (`check.checker` is its path), download each artifact and run its store-artifact gate, then submit
 * each gated file with --path, What to Test on the iOS submit. With plan.autoSubmit (iOS only) the
 * build line submits and What to Test rides on it, so there are no gate or submit lines.
 */
export function releaseLines(
  plan: BuildPlan,
  isStoreProfile: boolean,
  check: RecordCheck,
): ReleaseLines {
  whatToTestArgs(plan.whatToTest, plan.platform); // refuses a bad text before any line is printed
  const platforms: readonly EasPlatform[] =
    plan.platform === 'all' ? ['ios', 'android'] : [plan.platform];
  const { whatToTest, ...withoutText } = plan;
  const build = easBuildArgs(plan.autoSubmit ? plan : withoutText, isStoreProfile);
  const submits = plan.autoSubmit
    ? []
    : platforms.map((platform) => {
        const text = platform === 'ios' && whatToTest !== undefined ? { whatToTest } : {};
        const path = GATED_ARTIFACTS[platform];
        return commandLine(easSubmitArgs({ profile: plan.profile, platform, path, ...text }));
      });
  return {
    build: `${commandLine([...build, '--json'])} > ${BUILDS_JSON}`,
    checks: platforms.map((platform) => checkLine(check, platform)),
    gates: plan.autoSubmit
      ? []
      : platforms.flatMap((platform) => gateLines(platform, check.version ?? '<version>')),
    submits,
    untagged: platforms.filter((platform) => !hasUploadTag(check.uploadTags, platform)),
  };
}

/** The annotated tag for one uploaded build (git tag -a <name> -m <message>). */
export function uploadTag(version: string, platform: EasPlatform, buildNumber: number): UploadTag {
  if (!VERSION.test(version)) throw new Error(`version "${version}" is not MAJOR.MINOR.PATCH`);
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) {
    throw new Error(`build number ${String(buildNumber)} is not a positive integer`);
  }
  const store = platform === 'ios' ? 'App Store' : 'Play';
  return {
    name: `v${version}+${platform}.${String(buildNumber)}`,
    message: `${store} build ${String(buildNumber)}`,
  };
}

/**
 * One shell-safe line for the report (single quotes around anything but plain words); a fill-in such
 * as <ios-build-number> stays as it is, for the reader to replace.
 */
export function commandLine(args: readonly string[]): string {
  const quote = (arg: string): string =>
    /^[\w@%+=:,./-]+$/u.test(arg) || FILL_IN.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
  return ['eas', ...args].map(quote).join(' ');
}
