// scripts/release-android/release-args.ts
// The command line of `npm run release:android` (local lane). Four commands, each one step a person
// asked for: build (bump, prebuild, bundleRelease, then the gate command), upload (the gated bundle to
// the contract's testing track), rollout (promote an uploaded versionCode to production at one of the
// contract's fractions, or raise it), halt (stop a production rollout). upload, rollout and halt take
// --changes-not-sent-for-review only after Play answered that it cannot send the changes for review
// automatically and the developer chose to send them from Play Console.

export type ReleaseCommand =
  | { readonly command: 'build'; readonly notes: string | null }
  | {
      readonly command: 'upload';
      readonly notes: string | null;
      readonly isDraftApp: boolean;
      readonly isReviewSentByHand: boolean;
    }
  | {
      readonly command: 'rollout' | 'halt';
      readonly versionCode: number;
      readonly fraction: number;
      readonly isReviewSentByHand: boolean;
    };

export const RELEASE_ANDROID_USAGE = [
  'usage: npm run release:android -- <command> [options]',
  '  build    [--notes <text>]                       bump the build number, prebuild, bundleRelease, print the gate',
  '  upload   [--notes <text>] [--draft-app]         upload the gated bundle to the contract uploadTrack',
  '  rollout  --version-code <n> --fraction <f>      production at one of the contract rollout steps (1 completes)',
  '  halt     --version-code <n> --fraction <f>      stop the production rollout at the fraction it reached',
  '  --changes-not-sent-for-review                   (upload, rollout, halt) commit with changesNotSentForReview=true:',
  '                                                  only when the developer chose it after that Play stop',
  '  --help, -h                                      print this and exit',
  "upload, rollout and halt reach Google Play: run them only with the developer's word in this session.",
].join('\n');

const NOTES = '--notes';
const VERSION_CODE = '--version-code';
const FRACTION = '--fraction';
const DRAFT_APP = '--draft-app';
const REVIEW_BY_HAND = '--changes-not-sent-for-review';
const FLAGS: Readonly<Record<string, readonly string[]>> = {
  build: [NOTES],
  upload: [NOTES, DRAFT_APP, REVIEW_BY_HAND],
  rollout: [VERSION_CODE, FRACTION, REVIEW_BY_HAND],
  halt: [VERSION_CODE, FRACTION, REVIEW_BY_HAND],
};
const SWITCHES = new Set([DRAFT_APP, REVIEW_BY_HAND]);

export function isHelpRequest(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function readFlags(command: string, argv: readonly string[]): ReadonlyMap<string, string> {
  const allowed = FLAGS[command] ?? [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? '';
    if (!allowed.includes(flag)) {
      throw new Error(`${command}: unexpected argument "${flag}"\n${RELEASE_ANDROID_USAGE}`);
    }
    if (SWITCHES.has(flag)) {
      flags.set(flag, 'true');
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${command}: ${flag} needs a value\n${RELEASE_ANDROID_USAGE}`);
    }
    flags.set(flag, value);
    index += 1;
  }
  return flags;
}

function positiveInteger(flags: ReadonlyMap<string, string>, flag: string): number {
  const value = Number(flags.get(flag));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer (the versionCode the upload reported)`);
  }
  return value;
}

function fractionOf(flags: ReadonlyMap<string, string>): number {
  const value = Number(flags.get(FRACTION));
  if (!(value > 0 && value <= 1)) {
    throw new Error('--fraction must be a number in (0, 1], one of the contract rollout steps');
  }
  return value;
}

export function parseReleaseArgs(argv: readonly string[]): ReleaseCommand {
  const [command = '', ...rest] = argv;
  if (FLAGS[command] === undefined) {
    throw new Error(`unknown command "${command}"\n${RELEASE_ANDROID_USAGE}`);
  }
  const flags = readFlags(command, rest);
  const notes = flags.get(NOTES) ?? null;
  if (command === 'build') {
    return { command, notes };
  }
  const isReviewSentByHand = flags.has(REVIEW_BY_HAND);
  if (command === 'upload') {
    return { command, notes, isDraftApp: flags.has(DRAFT_APP), isReviewSentByHand };
  }
  return {
    command: command === 'rollout' ? 'rollout' : 'halt',
    versionCode: positiveInteger(flags, VERSION_CODE),
    fraction: fractionOf(flags),
    isReviewSentByHand,
  };
}
