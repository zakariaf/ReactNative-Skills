// scripts/release-android/version-code.ts
// The versionCode of the local lane. Each platform counts its own builds, as on the EAS lane:
// app.config.ts holds `const ANDROID_VERSION_CODE = <n>;`, which feeds android.versionCode only (the
// iOS twin keeps its own IOS_BUILD_NUMBER), and every upload is tagged vX.Y.Z+android.<n>. Google
// Play refuses a versionCode it has seen, for good, so the next number is above both the config and
// every Android upload tag (the per-platform form, plus the shared vX.Y.Z+<n> form an app may already
// have), and a number is never reused or rolled back. (The EAS lane keeps the counter on EAS
// servers: appVersionSource remote with autoIncrement; nothing here runs there.)

/** The greatest versionCode Google Play accepts. */
export const VERSION_CODE_MAX = 2_100_000_000;

const VERSION_CODE_CONST = /\bconst ANDROID_VERSION_CODE = (?<value>\d+);/u;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Android upload tags: vX.Y.Z+android.<n>, and the shared vX.Y.Z+<n> of an app that kept one number
 * for both stores before; optionally under <app>/ (multi-package).
 */
function uploadTagPattern(prefix: string | null): RegExp {
  const head = prefix === null ? '' : `${escapeRegExp(prefix)}/`;
  return new RegExp(`^${head}v\\d+\\.\\d+\\.\\d+\\+(?:android\\.)?(\\d+)$`, 'u');
}

/** The build numbers of the Android upload tags, in tag order (iOS-only tags are ignored). */
export function androidBuildNumbers(tags: readonly string[], prefix: string | null): number[] {
  const pattern = uploadTagPattern(prefix);
  return tags
    .map((tag) => pattern.exec(tag)?.[1])
    .filter((digits): digits is string => digits !== undefined)
    .map(Number);
}

/** The literal ANDROID_VERSION_CODE of app.config.ts; throws when there is not exactly one. */
export function readVersionCode(appConfig: string): number {
  const count = appConfig.match(/\bconst ANDROID_VERSION_CODE = /gu)?.length ?? 0;
  const value = VERSION_CODE_CONST.exec(appConfig)?.groups?.['value'];
  if (count !== 1 || value === undefined) {
    throw new Error(
      'app.config.ts needs exactly one `const ANDROID_VERSION_CODE = <n>;` (it feeds android.versionCode)',
    );
  }
  return Number(value);
}

/** One above the highest number the config or any Android upload tag has used. */
export function nextVersionCode(input: {
  readonly current: number;
  readonly tags: readonly string[];
  readonly prefix: string | null;
}): number {
  const next = Math.max(input.current, ...androidBuildNumbers(input.tags, input.prefix)) + 1;
  if (next > VERSION_CODE_MAX) {
    throw new Error(
      `versionCode ${String(next)} is above Google Play's maximum ${String(VERSION_CODE_MAX)}`,
    );
  }
  return next;
}

/** app.config.ts with ANDROID_VERSION_CODE set to `next`, which must be higher than the current one. */
export function bumpVersionCode(appConfig: string, next: number): string {
  const current = readVersionCode(appConfig);
  if (next <= current) {
    throw new Error(
      `ANDROID_VERSION_CODE ${String(current)} can only go up, not to ${String(next)}: a versionCode is never reused`,
    );
  }
  return appConfig.replace(VERSION_CODE_CONST, `const ANDROID_VERSION_CODE = ${String(next)};`);
}

/**
 * Why this versionCode may not be uploaded: an Android upload tag already carries it or a higher one
 * (Play would refuse it, or it was uploaded already). Empty when it is above every upload tag.
 */
export function usedVersionCodeProblems(
  versionCode: number,
  input: { readonly tags: readonly string[]; readonly prefix: string | null },
): string[] {
  const pattern = uploadTagPattern(input.prefix);
  const blocking = input.tags.find((tag) => Number(pattern.exec(tag)?.[1] ?? -1) >= versionCode);
  return blocking === undefined
    ? []
    : [
        `versionCode ${String(versionCode)} is not above the upload tag ${blocking}: a number is never reused or rolled back`,
      ];
}

/** The annotated tag of an upload: vX.Y.Z+android.<n> (Android counts its own builds). */
export function uploadTag(input: {
  readonly version: string;
  readonly versionCode: number;
  readonly prefix: string | null;
}): string {
  const head = input.prefix === null ? '' : `${input.prefix}/`;
  return `${head}v${input.version}+android.${String(input.versionCode)}`;
}

/**
 * The tag prefix of the app this runs in: the last folder of `git rev-parse --show-prefix`
 * ('apps/mobile/' -> 'mobile', multi-package), or null at the repo root (single app).
 */
export function tagPrefixOf(showPrefix: string): string | null {
  const folders = showPrefix.split('/').filter((folder) => folder !== '');
  return folders.at(-1) ?? null;
}
