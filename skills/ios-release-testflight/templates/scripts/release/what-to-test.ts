// scripts/release/what-to-test.ts
// The TestFlight "What to Test" text: English and for testers only, so it is not an in-app string.
// Built and length-checked in the preflight, so an over-long --notes stops the run before the build
// number commit and the upload.
import type { ChangeCheck } from './release-config.ts';

/** TestFlight accepts up to 4000 characters of whatsNew. */
export const WHATS_NEW_MAX = 4000;
/** The most commit subjects listed; the rest become one "and N more" line. */
export const MAX_CHANGE_LINES = 20;

/** The app's builds since its previous upload tag ('' = none: the first build). */
export type BuildHistory = {
  readonly previousTag: string;
  /** feat/fix commit subjects since that tag. */
  readonly subjects: readonly string[];
  /** `git diff --name-only <previous tag>..HEAD` */
  readonly files: readonly string[];
};

export type WhatToTestInput = {
  readonly appName: string;
  readonly version: string;
  readonly buildNumber: number;
  readonly variant: 'preview' | 'production';
  /** release:ios --notes: what testers should check. */
  readonly notes: readonly string[];
  readonly knownIssues: readonly string[];
  readonly history: BuildHistory;
  /** contracts/ios-release.json whatToTest: lines always listed, and lines tied to changed paths. */
  readonly always: readonly string[];
  readonly whenChanged: readonly ChangeCheck[];
};

/**
 * The "What changed" lines: nothing to list on the first build (everything is new), and at most
 * MAX_CHANGE_LINES subjects after that, so the text always fits TestFlight's limit.
 */
export function summarizeChanges(subjects: readonly string[], isFirstBuild: boolean): string[] {
  if (isFirstBuild) {
    return ['first TestFlight build: everything is new'];
  }
  if (subjects.length <= MAX_CHANGE_LINES) {
    return [...subjects];
  }
  const more = subjects.length - MAX_CHANGE_LINES;
  return [...subjects.slice(0, MAX_CHANGE_LINES), `and ${String(more)} more fixes and features`];
}

/** The whenChanged lines that apply: every one on a first build, else those whose paths changed. */
export function changeChecks(history: BuildHistory, checks: readonly ChangeCheck[]): string[] {
  const isFirstBuild = history.previousTag === '';
  return checks
    .filter(
      (check) =>
        isFirstBuild ||
        history.files.some((file) => check.paths.some((path) => file.startsWith(path))),
    )
    .map((check) => check.line);
}

function bullets(lines: readonly string[], fallback: string): string[] {
  return (lines.length === 0 ? [fallback] : lines).map((line) => `- ${line}`);
}

/** The text step "what-to-test" sends; throws when it would exceed TestFlight's limit. */
export function releaseWhatToTest(input: WhatToTestInput): string {
  const isFirstBuild = input.history.previousTag === '';
  const checks = [
    ...input.notes,
    ...changeChecks(input.history, input.whenChanged),
    ...input.always,
  ];
  const text = [
    `${input.appName} ${input.version} (${String(input.buildNumber)}) · ${input.variant} build`,
    'What changed',
    ...bullets(summarizeChanges(input.history.subjects, isFirstBuild), 'no user-visible changes'),
    'Please check',
    ...bullets(checks, 'the main flows you use every day'),
    'Known issues',
    ...bullets(input.knownIssues, 'none'),
  ].join('\n');
  if (text.length > WHATS_NEW_MAX) {
    throw new Error(
      `What to Test would be ${String(text.length)} characters; TestFlight allows ${String(WHATS_NEW_MAX)}: shorten --notes or --known-issue, then rerun (nothing was built, committed or uploaded)`,
    );
  }
  return text;
}
