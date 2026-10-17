// scripts/release/build-number.ts
// Pure: the iOS build number lives in exactly one line of app.config.ts,
//   const IOS_BUILD_NUMBER = 7;
// (used as ios.buildNumber: String(IOS_BUILD_NUMBER)), and only the release bumps it. Also the
// release commit subject and the tags that trace each TestFlight build back to its commit.
const BUILD_NUMBER_LINE = /^(const IOS_BUILD_NUMBER = )(\d+)(;)$/gm;

export type BuildNumberBump = {
  readonly text: string;
  readonly previous: number;
  readonly next: number;
};

/** The current number and the source with it raised by one; refuses anything but one such line. */
export function bumpBuildNumber(appConfigSource: string): BuildNumberBump {
  const found = [...appConfigSource.matchAll(BUILD_NUMBER_LINE)];
  const digits = found[0]?.[2];
  if (found.length !== 1 || digits === undefined) {
    throw new Error(
      `expected exactly one "const IOS_BUILD_NUMBER = <int>;" line in app.config.ts, found ${String(found.length)}`,
    );
  }
  const previous = Number(digits);
  const next = previous + 1;
  const text = appConfigSource.replace(BUILD_NUMBER_LINE, `$1${String(next)}$3`);
  return { text, previous, next };
}

/** The commit scope: release for a single app, the app's folder name when multi-package. */
export function releaseScope(prefix: string): string {
  return prefix === '' ? 'release' : prefix.replace(/\/$/, '');
}

/** The bump commit's subject (git-commits-and-reporting: the release step writes it). */
export function bumpSubject(prefix: string, buildNumber: number): string {
  return `chore(${releaseScope(prefix)}): build ${String(buildNumber)}`;
}

/** The upload tag, annotated, after the build reached VALID: v1.4.0+ios.14 (or mobile/v1.4.0+ios.14). */
export function buildTag(prefix: string, version: string, buildNumber: number): string {
  return `${prefix}v${version}+ios.${String(buildNumber)}`;
}

/** The release tag the developer's "ship" creates: v1.4.0. */
export function releaseTag(prefix: string, version: string): string {
  return `${prefix}v${version}`;
}

export type ResumeCheck = {
  /** '' for a single app, '<folder>/' when multi-package. */
  readonly prefix: string;
  /** app.config.ts as it is now (after the earlier run's bump commit). */
  readonly appConfigSource: string;
  /** `git log -1 --format=%s` */
  readonly headSubject: string;
  /** `git tag --list` */
  readonly tags: readonly string[];
};

/**
 * The build number a resumed release reuses. Allowed only while HEAD is still the bump commit for
 * that number and no upload tag carries it; otherwise a fresh run takes a new number (gaps are
 * harmless, App Store Connect only rejects duplicates).
 */
export function resumableBuildNumber(check: ResumeCheck): number {
  const current = bumpBuildNumber(check.appConfigSource).previous;
  const expected = bumpSubject(check.prefix, current);
  if (check.headSubject.trim() !== expected) {
    throw new Error(
      `cannot resume: HEAD is "${check.headSubject.trim()}", not "${expected}". Run release:ios without --resume.`,
    );
  }
  const suffix = `+ios.${String(current)}`;
  if (check.tags.some((tag) => tag.startsWith(`${check.prefix}v`) && tag.endsWith(suffix))) {
    throw new Error(
      `cannot resume: build ${String(current)} is already tagged (uploaded and processed)`,
    );
  }
  return current;
}
