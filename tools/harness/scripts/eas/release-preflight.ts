// scripts/eas/release-preflight.ts
// CLI: node scripts/eas/release-preflight.ts [--profile production] [--platform ios|android|all]
//      [--branch main] [--what-to-test "<text>"] [--auto-submit]   (--help: usage)
// The gates in front of every store build, in order, cheapest first: a clean committed tree on the
// release branch and a store profile in eas.json; then `npm run verify`; then the app config the
// profile's env produces (version above the last release tag, the ids submit pins); then the
// fingerprint of each platform, written to dist/eas/fingerprint-<platform>.json so the finished
// build can be compared with it. It never runs eas: it prints the release sequence (build without
// submitting, check each record, download each artifact and run its store-artifact gate, submit each
// gated file with --path), and the developer's word runs it. --auto-submit (iOS only: Android always
// submits the .aab its gate read) prints a build that submits itself instead, only for a developer who
// agreed to skip the record check. Runs unattended (CI=true): no prompt, and every failed gate exits
// non-zero. Exit 0 ready, 1 a gate failed, 2 bad input.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { releaseLines } from './eas-commands.ts';
import { EAS_PLATFORMS, resolveBuildProfile } from './eas-profile.ts';
import { configProblems, repoProblems } from './release-plan.ts';

import type { BuildPlan, ReleaseLines } from './eas-commands.ts';
import type { EasJson, EasPlatform } from './eas-profile.ts';

const USAGE =
  'Usage: node scripts/eas/release-preflight.ts [--profile production] ' +
  '[--platform ios|android|all] [--branch main] [--what-to-test "<text>"] [--auto-submit]';
const FINGERPRINT_DIR = join('dist', 'eas');
/** The record check of the eas-build-and-submit skill; the reader puts in where that skill lives. */
const RECORD_CHECK = '<eas-build-and-submit>/scripts/check-eas-build.mjs';

type Options = {
  readonly profile: string;
  readonly platform: EasPlatform | 'all';
  readonly branch: string;
  readonly whatToTest: string | undefined;
  readonly autoSubmit: boolean;
};

/** Bad input (exit 2): nothing was run. */
class UsageError extends Error {}

function readOptions(argv: readonly string[]): Options | null {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      profile: { type: 'string', default: 'production' },
      platform: { type: 'string', default: 'all' },
      branch: { type: 'string', default: 'main' },
      'what-to-test': { type: 'string' },
      'auto-submit': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return null;
  const platform = values.platform;
  if (platform !== 'all' && !EAS_PLATFORMS.some((name) => name === platform)) {
    throw new UsageError(`--platform must be ios, android or all, not "${platform}"`);
  }
  return {
    profile: values.profile,
    platform: platform as EasPlatform | 'all',
    branch: values.branch,
    whatToTest: values['what-to-test'],
    autoSubmit: values['auto-submit'],
  };
}

const git = (args: readonly string[]): string =>
  execFileSync('git', [...args], { encoding: 'utf8' }).trim();

function readEasJson(): EasJson {
  try {
    return JSON.parse(readFileSync('eas.json', 'utf8')) as EasJson;
  } catch (error: unknown) {
    throw new UsageError(`eas.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stop(gate: string, problems: readonly string[]): void {
  if (problems.length === 0) return;
  throw new Error(`${gate} failed, nothing was built:\n  ${problems.join('\n  ')}`);
}

function appConfig(env: NodeJS.ProcessEnv): {
  readonly version: string | null;
  readonly ids: Readonly<Record<EasPlatform, string | null>>;
} {
  const args = ['--no-install', 'expo', 'config', '--type', 'public', '--json'];
  const config = JSON.parse(execFileSync('npx', args, { encoding: 'utf8', env })) as {
    readonly version?: string;
    readonly ios?: { readonly bundleIdentifier?: string };
    readonly android?: { readonly package?: string };
  };
  return {
    version: config.version ?? null,
    ids: { ios: config.ios?.bundleIdentifier ?? null, android: config.android?.package ?? null },
  };
}

/**
 * Writes this commit's fingerprint for the profile's env; returns its hash. It equals the one EAS
 * records when the app config reads no variable of the profile's EAS environment (else run the
 * preflight under `eas env:exec <environment>`, see main()).
 */
function writeFingerprint(platform: EasPlatform, env: NodeJS.ProcessEnv): string {
  const args = [
    '--no-install',
    '@expo/fingerprint',
    'fingerprint:generate',
    '--platform',
    platform,
  ];
  const output = execFileSync('npx', args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  const { hash } = JSON.parse(output) as { readonly hash: string };
  mkdirSync(FINGERPRINT_DIR, { recursive: true });
  writeFileSync(join(FINGERPRINT_DIR, `fingerprint-${platform}.json`), output);
  return hash;
}

function runGates(eas: EasJson, options: Options, tags: readonly string[]): string | null {
  const repo = {
    gitStatus: git(['status', '--porcelain']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    releaseBranch: options.branch,
  };
  stop('the tree and profile gate', repoProblems(eas, options.profile, repo));
  console.log('release-preflight: npm run verify ...');
  if (spawnSync('npm', ['run', '-s', 'verify'], { stdio: 'inherit' }).status !== 0) {
    stop('npm run verify', ['see its output above']);
  }
  const env = { ...process.env, ...resolveBuildProfile(eas, options.profile, 'ios').env };
  const config = { ...appConfig(env), tags };
  stop('the app config gate', configProblems(eas, options.profile, config));
  const platforms = options.platform === 'all' ? EAS_PLATFORMS : [options.platform];
  for (const platform of platforms) {
    console.log(`release-preflight: fingerprint ${platform} ${writeFingerprint(platform, env)}`);
  }
  return config.version;
}

/**
 * The release sequence; a bad plan (What to Test too long or for Android, --auto-submit for Android)
 * is bad input.
 */
function planLines(plan: BuildPlan, uploadTags: readonly string[], version?: string): ReleaseLines {
  try {
    return releaseLines(plan, true, {
      checker: RECORD_CHECK,
      uploadTags,
      ...(version === undefined ? {} : { version }),
    });
  } catch (error: unknown) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/** The env:exec hint, then the release sequence with the developer's go-ahead first. */
function printSequence(lines: ReleaseLines, environment: string | undefined): void {
  if (environment !== undefined) {
    console.log(
      `release-preflight: if the app config reads a variable of the EAS environment "${environment}", ` +
        `the fingerprints match the build only when this ran as eas env:exec ${environment} ` +
        `'node scripts/eas/release-preflight.ts <the same options>'`,
    );
  }
  console.log("release-preflight: run these in order, only with the developer's go-ahead:");
  console.log(`  1. build:  ${lines.build}`);
  const isAutoSubmitted = lines.submits.length === 0;
  console.log(
    isAutoSubmitted
      ? '  2. check each record (--auto-submit: each build submitted itself as it finished):'
      : '  2. check each record before anything is submitted:',
  );
  for (const line of lines.checks) console.log(`     ${line}`);
  for (const platform of lines.untagged) {
    console.log(
      `     (no upload tag for ${platform} yet: fill in the last build number the store has, ` +
        `eas build:version:get --platform ${platform}, or replace --previous <...> with --first ` +
        'for the first upload of this app)',
    );
  }
  if (isAutoSubmitted) return;
  console.log(
    '  3. download each artifact (artifacts.applicationArchiveUrl in the record) and run its store-artifact gate:',
  );
  for (const line of lines.gates) console.log(`     ${line}`);
  console.log('  4. submit exactly the files the gates passed:');
  for (const line of lines.submits) console.log(`     ${line}`);
}

function main(): number {
  const options = readOptions(process.argv.slice(2));
  if (options === null) {
    console.log(USAGE);
    return 0;
  }
  const eas = readEasJson();
  const plan = {
    profile: options.profile,
    platform: options.platform,
    autoSubmit: options.autoSubmit,
    message: git(['log', '-1', '--format=%s']),
    ...(options.whatToTest === undefined ? {} : { whatToTest: options.whatToTest }),
  };
  const tags = git(['tag', '--list', 'v*']).split('\n');
  planLines(plan, tags); // refuses a bad plan before any gate runs
  const version = runGates(eas, options, tags);
  const commit = git(['rev-parse', '--short', 'HEAD']);
  console.log(`release-preflight: ready, version ${String(version)}, commit ${commit}`);
  const lines = planLines(plan, tags, version ?? undefined);
  printSequence(lines, resolveBuildProfile(eas, options.profile, 'ios').environment);
  return 0;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  console.error(`release-preflight: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
