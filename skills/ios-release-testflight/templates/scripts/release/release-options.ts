// scripts/release/release-options.ts
// Pure parts of `npm run release:ios`: the command line, the three App Store Connect ids, the auth
// flags and the xcodebuild / altool argument lists. The .p8 key is only ever named by path here;
// nothing in this module reads it.
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { ascKeyPath, requireEnv } from '../asc/asc-credentials.ts';

import type { ToolEnv } from '../asc/asc-credentials.ts';

/** The variants that reach TestFlight: preview (internal testers only) and production (the store). */
export const RELEASE_VARIANTS = ['preview', 'production'] as const;
export type ReleaseVariant = (typeof RELEASE_VARIANTS)[number];

/** ADS_MODE pairs (admob-ads-and-consent): testing builds never carry live ads, store builds no test ads. */
const ADS_MODES: Readonly<Record<ReleaseVariant, readonly string[]>> = {
  preview: ['test', 'off'],
  production: ['live', 'off'],
};

/**
 * Where a stopped run picks up again. `build`: the committed build number is reused and the run
 * starts again at the prebuild (the stop came before the upload). `processing`: the upload is done,
 * so the run only waits for VALID, sets What to Test and tags.
 */
export const RESUME_POINTS = ['build', 'processing'] as const;
export type ResumePoint = (typeof RESUME_POINTS)[number];

export type ReleaseOptions = {
  readonly variant: ReleaseVariant;
  /** ADS_MODE for the whole run, or null to keep the app's default for the variant. */
  readonly adsMode: string | null;
  readonly notes: readonly string[];
  readonly knownIssues: readonly string[];
  readonly resume: ResumePoint | null;
};

export type AscIds = { readonly keyId: string; readonly issuerId: string; readonly teamId: string };

export const RELEASE_USAGE =
  'usage: npm run release:ios -- --variant preview|production [--ads off|test|live] [--notes "..."]... [--known-issue "..."]... [--resume build|processing]';
const OPTIONS = {
  variant: { type: 'string' },
  ads: { type: 'string' },
  resume: { type: 'string' },
  notes: { type: 'string', multiple: true },
  'known-issue': { type: 'string', multiple: true },
} as const;
const SINGLE = ['variant', 'ads', 'resume'];

function parseFlags(argv: readonly string[]) {
  return parseArgs({ args: [...argv], options: OPTIONS, tokens: true });
}

/** node:util parseArgs, strict: an unknown option, a stray word or a repeated single option throws. */
function readFlags(argv: readonly string[]): ReturnType<typeof parseFlags>['values'] {
  let parsed: ReturnType<typeof parseFlags>;
  try {
    parsed = parseFlags(argv);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`unexpected argument: ${reason} ${RELEASE_USAGE}`);
  }
  const names = parsed.tokens.flatMap((token) => (token.kind === 'option' ? [token.name] : []));
  const repeated = SINGLE.find((name) => names.filter((found) => found === name).length > 1);
  if (repeated !== undefined) {
    throw new Error(`unexpected argument "--${repeated}" (twice). ${RELEASE_USAGE}`);
  }
  return parsed.values;
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], flag: string): T {
  const found = allowed.find((candidate) => candidate === raw);
  if (found === undefined) {
    throw new Error(
      `--${flag} ${raw ?? '(missing)'} is not one of ${allowed.join('|')}. ${RELEASE_USAGE}`,
    );
  }
  return found;
}

/** The variant is required (no default): a release is always a deliberate preview or production build. */
export function parseReleaseArgs(argv: readonly string[]): ReleaseOptions {
  const flags = readFlags(argv);
  const variant = pick(flags.variant, RELEASE_VARIANTS, 'variant');
  const adsMode = flags.ads === undefined ? null : pick(flags.ads, ADS_MODES[variant], 'ads');
  return {
    variant,
    adsMode,
    notes: flags.notes ?? [],
    knownIssues: flags['known-issue'] ?? [],
    resume: flags.resume === undefined ? null : pick(flags.resume, RESUME_POINTS, 'resume'),
  };
}

/** Tools receive only the three ids; a missing one is the API-key human step (all missing ones named). */
export function readAscIds(env: ToolEnv): AscIds {
  const missing = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'APPLE_TEAM_ID'].filter(
    (name) => (env[name] ?? '') === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} not set. Human step (API key): export them in the shell profile, never in the repo, then start a new shell.`,
    );
  }
  return {
    keyId: requireEnv(env, 'ASC_KEY_ID'),
    issuerId: requireEnv(env, 'ASC_ISSUER_ID'),
    teamId: requireEnv(env, 'APPLE_TEAM_ID'),
  };
}

/** The key's path under `home`; nothing here reads the key. */
export function ascKeyFile(home: string, keyId: string): string {
  return ascKeyPath(keyId, home);
}

/** Automatic signing with the team API key: the only signing method (no .p12, no manual profiles). */
export function xcodeAuthArgs(keyFile: string, ids: AscIds): string[] {
  return [
    '-allowProvisioningUpdates',
    ...['-authenticationKeyPath', keyFile],
    ...['-authenticationKeyID', ids.keyId],
    ...['-authenticationKeyIssuerID', ids.issuerId],
  ];
}

export function altoolAuthArgs(ids: AscIds): string[] {
  return ['--api-key', ids.keyId, '--api-issuer', ids.issuerId];
}

/** Where the release writes inside the app folder: archive, export, the unpacked .ipa, logs. */
export const RELEASE_BUILD_DIR = join('build', 'ios-release');

export type ArchiveTarget = { readonly workspace: string; readonly scheme: string };

/** A device archive (generic/platform=iOS: no device is named or touched), Release configuration. */
export function archiveArgs(target: ArchiveTarget, auth: readonly string[]): string[] {
  return [
    ...['-workspace', target.workspace, '-scheme', target.scheme, '-configuration', 'Release'],
    ...['-destination', 'generic/platform=iOS'],
    ...['-archivePath', join(RELEASE_BUILD_DIR, `${target.scheme}.xcarchive`)],
    ...['-derivedDataPath', join(RELEASE_BUILD_DIR, 'dd'), ...auth, 'archive'],
  ];
}

export type ExportTarget = {
  readonly scheme: string;
  readonly variant: ReleaseVariant;
  /** The folder of the export options files, as seen from the app folder. */
  readonly optionsDir: string;
};

/** Preview builds use the internal-only options file (they can never reach the App Store). */
export function exportArgs(target: ExportTarget, auth: readonly string[]): string[] {
  const options = join(target.optionsDir, `export-options-${target.variant}.plist`);
  return [
    '-exportArchive',
    ...['-archivePath', join(RELEASE_BUILD_DIR, `${target.scheme}.xcarchive`)],
    ...['-exportOptionsPlist', options],
    ...['-exportPath', join(RELEASE_BUILD_DIR, 'export'), ...auth],
  ];
}

export type UploadMeta = {
  readonly appleAppId: string;
  readonly bundleId: string;
  readonly buildNumber: number;
  readonly version: string;
};

export function validateArgs(ipa: string, ids: AscIds): string[] {
  return [
    'altool',
    '--validate-app',
    ipa,
    '-t',
    'ios',
    ...altoolAuthArgs(ids),
    '--output-format',
    'json',
  ];
}

/** `--wait` returns once Apple is PROCESSING, not VALID: processing is polled separately. */
export function uploadArgs(ipa: string, meta: UploadMeta, ids: AscIds): string[] {
  return [
    ...['altool', '--upload-package', ipa, '-t', 'ios'],
    ...['--apple-id', meta.appleAppId, '--bundle-id', meta.bundleId],
    ...['--bundle-version', String(meta.buildNumber)],
    ...['--bundle-short-version-string', meta.version],
    ...altoolAuthArgs(ids),
    ...['--wait', '--output-format', 'json'],
  ];
}
