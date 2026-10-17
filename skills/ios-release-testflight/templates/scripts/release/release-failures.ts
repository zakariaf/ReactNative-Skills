// scripts/release/release-failures.ts
// The release failure playbook as data: match a failed step's output, then either stop and ask the
// developer (never retry: retries can lock the account or burn build numbers) or apply the named fix.

export type FailureVerdict = {
  readonly id: string;
  /** true: stop the run and send the developer one message with `humanStep` and `action`. */
  readonly isStop: boolean;
  /** The human step in plain words, or null when the fix is the agent's. */
  readonly humanStep: string | null;
  readonly action: string;
};

/** A verdict plus the first output line that matched it (the evidence for the message). */
export type Classified = FailureVerdict & { readonly line: string };

type Rule = FailureVerdict & { readonly pattern: RegExp };

const AGENT = { isStop: false, humanStep: null } as const;

const STOPS: readonly Rule[] = [
  {
    id: 'ship-placeholder',
    pattern: /\[ship-placeholder\]/,
    isStop: true,
    humanStep: 'real values',
    action:
      'Give the real values the [ship-placeholder] lines name (the bundle id, ad ids, privacy-policy URL or support address); the agent never types a stand-in value.',
  },
  {
    id: 'xcode-license',
    pattern: /You have not agreed to the Xcode license|xcodebuild -license/i,
    isStop: true,
    humanStep: 'Xcode licence',
    action:
      'Accept the pinned Xcode licence with an administrator password: sudo <DEVELOPER_DIR>/usr/bin/xcodebuild -license accept (the agent never runs sudo).',
  },
  {
    id: 'keychain-locked',
    pattern: /errSecInternalComponent/,
    isStop: true,
    humanStep: 'unlock the keychain',
    action:
      'Unlock the login keychain on the Mac (security unlock-keychain ~/Library/Keychains/login.keychain-db in Terminal), or start the run from the logged-in desktop.',
  },
  {
    id: 'agreement',
    pattern: /agreement|PLA Update available/i,
    isStop: true,
    humanStep: 'accept the agreement',
    action:
      'Accept the new Apple agreement at developer.apple.com and/or App Store Connect > Business, then rerun from the failed step.',
  },
  {
    id: 'app-record-missing',
    pattern:
      /No App Store Connect app record|cannot determine the Apple ID|no suitable application records/i,
    isStop: true,
    humanStep: 'app record',
    action:
      'Create the app record in App Store Connect (Apps > + > New App) with the bundle id the message names, then rerun.',
  },
  {
    id: 'not-authorized',
    pattern:
      /NOT_AUTHORIZED|Unable to authenticate|Authentication credentials are missing or invalid|(?:HTTP|status|answered):? 401\b/i,
    isStop: true,
    humanStep: 'API key',
    action:
      'Check that ASC_KEY_ID and ASC_ISSUER_ID match the key file name and the Mac clock is on network time; if the key was revoked, create a new team key with the Admin role.',
  },
  {
    id: 'forbidden',
    pattern:
      /FORBIDDEN_ERROR|(?:HTTP|status|answered):? 403\b|not allowed to create distribution certificates/i,
    isStop: true,
    humanStep: 'API key',
    action:
      'Create a team API key with the Admin role (individual or App Manager keys cannot sign).',
  },
  {
    id: 'processing-invalid',
    pattern: /processingState"?\s*[:=]\s*"?(INVALID|FAILED)|build status:?\s*(INVALID|FAILED)/i,
    isStop: true,
    humanStep: "Apple's email",
    action:
      "Forward Apple's email about the rejected binary; fix, then rebuild with a new build number.",
  },
];

const FIXES: readonly Rule[] = [
  {
    id: 'build-number-reused',
    pattern: /ITMS-90189/,
    ...AGENT,
    action:
      'Never reuse a build number: rerun without --resume so release:ios takes the next one. Check the TestFlight tab first if the earlier upload may have succeeded.',
  },
  {
    id: 'version-not-raised',
    pattern: /ITMS-90062/,
    ...AGENT,
    action:
      'Raise the version in app.config.ts above the last approved version, commit, and rerun.',
  },
  {
    id: 'purpose-string',
    pattern: /ITMS-90683/,
    ...AGENT,
    action:
      "Add the NS*UsageDescription Apple names (the library's config plugin option or ios.infoPlist, translated through the app config locales; a linked SDK that references the API needs it even when the app never asks), then rebuild with a new build number.",
  },
  {
    id: 'privacy-manifest',
    pattern: /ITMS-9105[36]|ITMS-91061/,
    ...AGENT,
    action:
      'Run the privacy-manifest audit, add the missing category and reason to ios.privacyManifests, then rebuild with a new build number (privacy-and-store-declarations).',
  },
  {
    id: 'signing-flags',
    pattern:
      /No profiles for '[^']+' were found|Automatic signing is disabled|requires a development team/,
    ...AGENT,
    action:
      'Pass -allowProvisioningUpdates and the three -authenticationKey* flags, and set ios.appleTeamId from APPLE_TEAM_ID before the prebuild (it becomes DEVELOPMENT_TEAM).',
  },
  {
    id: 'pod-download',
    pattern: /Failed to download|Couldn't connect to server|CDN: trunk/i,
    ...AGENT,
    action: 'No network or a CDN problem: retry once after 5 minutes; never loosen pod versions.',
  },
];

const RULES: readonly Rule[] = [...STOPS, ...FIXES];

/** The first matching rule, or null for an unknown failure (then read the log and diagnose). */
export function classifyReleaseFailure(output: string): Classified | null {
  const rule = RULES.find((candidate) => candidate.pattern.test(output));
  if (rule === undefined) {
    return null;
  }
  const line = output.split('\n').find((candidate) => rule.pattern.test(candidate)) ?? '';
  const { id, isStop, humanStep, action } = rule;
  return { id, isStop, humanStep, action, line: line.trim() };
}

/** One message to the developer: the step, the exact error line and the one action needed. */
export function stopMessage(step: string, errorLine: string, verdict: FailureVerdict): string {
  const human = verdict.humanStep === null ? '' : ` (human step: ${verdict.humanStep})`;
  return [
    `Release stopped at step "${step}"${human}.`,
    `Error: ${errorLine.trim()}`,
    `Needed: ${verdict.action}`,
    'I will resume from this step once you confirm.',
  ].join('\n');
}

/** Steps that run before the build number is bumped (a plain rerun uses no number). */
const BEFORE_BUMP = new Set(['preflight', 'expo-config']);

/** For the agent: how to rerun after the cause is fixed or the developer confirmed a stop. */
export function resumeHint(step: string): string {
  if (BEFORE_BUMP.has(step) || step.startsWith('preflight-')) {
    return 'Resume: rerun the same release:ios command (no build number was used yet).';
  }
  if (step === 'upload') {
    return 'Resume: if Apple lists the build (TestFlight tab), rerun with --resume processing; otherwise rerun without --resume (a new build number).';
  }
  return 'Resume: rerun the same command with --resume build (the committed build number is still unused); after a code fix, rerun without --resume.';
}
