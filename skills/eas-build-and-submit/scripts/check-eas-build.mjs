#!/usr/bin/env node
// check-eas-build.mjs: the ship gate between a finished EAS build and its submission. It reads the
// build record (eas build:view <id> --json, or the list eas build --json printed) and proves the
// build is the release it claims to be: a finished store build of the production profile, built from
// the commit under review, for the production app id, with the app config's version, a build number
// above every uploaded one, and the fingerprint the release preflight computed at that commit. A ship
// gate: no SKIP, no NOT APPLICABLE. Run from the repo root:
//   node ${CLAUDE_SKILL_DIR}/scripts/check-eas-build.mjs . --build dist/eas/build-ios.json
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import { UsageError, createReporter, parseArgs, requireDir, run } from './check-lib.mjs';
import { readEasJson, resolveSubmitProfile } from './lib/eas-json.mjs';
import { appConfigFacts, findAppConfig } from './lib/repo-facts.mjs';

const SPEC = {
  name: 'check-eas-build',
  summary: 'Checks a finished EAS build record before it is submitted: a finished store build of the production profile, from the commit under review, for the production app id, with the app config version, a build number above every upload tag, and the fingerprint the release preflight wrote.',
  usage: '[repo-root] --build <file> [options]',
  options: {
    build: { type: 'string', value: 'file', help: 'The build record: eas build:view <id> --json > file, or the list eas build --json printed (repo-relative or absolute)' },
    platform: { type: 'string', value: 'ios|android', help: 'Which build of a list to check (default: the record\'s own platform)' },
    profile: { type: 'string', value: 'name', help: 'The build profile the release uses (default: production)' },
    commit: { type: 'string', value: 'sha', help: 'The commit under review (default: git rev-parse HEAD)' },
    previous: { type: 'string', value: 'n', help: 'The highest build number already uploaded for this platform (default: from the vX.Y.Z+<platform>.<n> tags; with --app-dir apps/<app>, the <app>/vX.Y.Z+<platform>.<n> tags)' },
    first: { type: 'boolean', help: 'The first upload of this app: no earlier build number to compare' },
    fingerprint: { type: 'string', value: 'file', help: 'The fingerprint the preflight wrote (default: dist/eas/fingerprint-<platform>.json)' },
    'app-dir': { type: 'string', value: 'dir', help: "The app folder (app.config.ts, eas.json) relative to the repo root (default '.')" },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  build-record       status FINISHED, the platform asked for, buildProfile = --profile, distribution STORE, not a',
    '                     simulator build, an application archive to submit',
    '  build-commit       gitCommitHash is the commit under review (EAS builds what was committed: cli.requireCommit)',
    '  build-identity     appIdentifier is the id submit.<profile> pins (else the app config\'s production id), never a .dev or',
    '                     .preview id',
    '  build-version      appVersion equals the app config version; appBuildVersion is an integer above every uploaded build',
    '                     of this platform (the vX.Y.Z+<platform>.<n> tags, <app>/vX.Y.Z+... with --app-dir apps/<app>,',
    '                     or --previous)',
    '  build-fingerprint  fingerprint.hash exists and equals the hash the release preflight wrote for this platform: the',
    '                     worker built the same native inputs as the reviewed commit and variant',
    'Ship gate: never SKIP. Missing inputs (no record, no commit outside git, no previous number without --first) are exit 2.',
  ].join('\n'),
};

const VARIANT_SUFFIX = /\.(dev|development|preview|staging)$/;

function readJson(path, label, fix) {
  if (!existsSync(path)) throw new UsageError(`${label} not found: ${path}`, fix);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${label} is not JSON: ${error.message}`, fix);
  }
}

function pickBuild(data, platform) {
  const list = Array.isArray(data) ? data : [data];
  const wanted = platform ? list.filter((build) => String(build?.platform ?? '').toLowerCase() === platform) : list;
  if (wanted.length !== 1) {
    throw new UsageError(`the record holds ${wanted.length} builds${platform ? ` for ${platform}` : ''}, expected one`, 'Pass --platform ios or android, or save one build: eas build:view <id> --json > dist/eas/build-<platform>.json.');
  }
  return wanted[0];
}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * The highest uploaded build number of this platform: --previous, else the upload tags. A single app
 * tags vX.Y.Z+<platform>.<n>; when multi-package each tag starts with the app's folder name
 * (mobile/vX.Y.Z+ios.<n>, git-commits-and-reporting's scheme), so another app's tags never count.
 */
function previousBuild(root, options, platform, appRel) {
  if (options.previous !== undefined) {
    if (!/^\d+$/.test(options.previous)) throw new UsageError(`--previous ${options.previous} is not a build number`, 'Pass the highest uploaded build number, for example --previous 41.');
    return Number(options.previous);
  }
  const prefix = appRel === '.' ? '' : `${posix.basename(appRel)}/`;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tags = git(root, ['tag', '--list', `${prefix}v*+${platform}.*`]);
  const pattern = new RegExp(`^${escaped}v\\d+\\.\\d+\\.\\d+\\+${platform}\\.(\\d+)$`);
  const numbers = (tags ?? '').split('\n').map((tag) => pattern.exec(tag.trim())).filter(Boolean).map((match) => Number(match[1]));
  if (numbers.length > 0) return Math.max(...numbers);
  if (options.first) return 0;
  throw new UsageError(`no upload tag ${prefix}v<x.y.z>+${platform}.<n> found, so the build number cannot be compared`, 'Pass --previous <highest uploaded build number> (eas build:version:get), or --first for the first upload of the app.');
}

function expectedIdentity(root, appRel, profile, platform, config) {
  const eas = readEasJson(join(root, appRel, 'eas.json'), posix.join(appRel, 'eas.json'));
  const submit = eas ? resolveSubmitProfile(eas.data, profile).profile : null;
  const pinned = platform === 'ios' ? submit?.ios?.bundleIdentifier : submit?.android?.applicationId;
  return pinned ?? config.appId ?? null;
}

function checkRecord(ctx) {
  const { build, platform, profile } = ctx;
  const problems = [
    [build.status !== 'FINISHED', `status is ${build.status}, not FINISHED`],
    [String(build.platform).toLowerCase() !== platform, `platform is ${build.platform}, not ${platform}`],
    [build.buildProfile !== profile, `buildProfile is ${JSON.stringify(build.buildProfile ?? null)}, not "${profile}"`],
    [build.distribution !== 'STORE', `distribution is ${build.distribution}, not STORE: an internal or simulator build cannot be submitted`],
    [build.isForIosSimulator === true, 'it is a simulator build'],
    [!build.artifacts?.applicationArchiveUrl, 'it has no application archive (artifacts.applicationArchiveUrl)'],
  ];
  for (const [bad, message] of problems) {
    if (bad) ctx.problem('build-record', message, 'Submit only a finished build of the store profile: eas build --profile production, then check its record again.');
  }
}

function checkCommit(ctx) {
  const hash = String(ctx.build.gitCommitHash ?? '');
  const ok = hash.length >= 7 && (hash.startsWith(ctx.commit) || ctx.commit.startsWith(hash));
  if (!ok) ctx.problem('build-commit', `gitCommitHash is ${hash || 'missing'}, not the commit under review ${ctx.commit}`, 'Build again from the reviewed commit (cli.requireCommit keeps uncommitted files out), or review the commit the build came from.');
}

function checkIdentity(ctx) {
  const id = ctx.build.appIdentifier;
  if (typeof id !== 'string' || VARIANT_SUFFIX.test(id)) ctx.problem('build-identity', `appIdentifier is ${JSON.stringify(id ?? null)}: a testing variant (or nothing), not the store app`, 'Build the production profile; its env sets APP_VARIANT=production.');
  else if (ctx.expectedId && id !== ctx.expectedId) ctx.problem('build-identity', `appIdentifier is ${id}, but the release ships ${ctx.expectedId}`, 'Build with the production profile and pin the ids in submit.production.');
}

function checkVersion(ctx) {
  const { build, config } = ctx;
  if (build.appVersion !== config.version) ctx.problem('build-version', `appVersion is ${JSON.stringify(build.appVersion ?? null)}, but ${ctx.configRel} says ${JSON.stringify(config.version)}`, 'Build again from the commit that holds the version under review.');
  const number = /^\d+$/.test(String(build.appBuildVersion ?? '')) ? Number(build.appBuildVersion) : null;
  if (number === null) ctx.problem('build-version', `appBuildVersion ${JSON.stringify(build.appBuildVersion ?? null)} is not an integer build number`, 'Use remote versions with autoIncrement (eas.json), then build again.');
  else if (number <= ctx.previous) ctx.problem('build-version', `appBuildVersion ${number} is not above the last uploaded ${ctx.platform} build ${ctx.previous}: the store refuses it`, 'Set the remote counter (eas build:version:set) to the last uploaded number and build again with autoIncrement.');
}

function checkFingerprint(ctx) {
  const hash = ctx.build.fingerprint?.hash;
  const fix = "Run node scripts/eas/release-preflight.ts at the reviewed commit; a different hash means the worker evaluated other native inputs (an .easignore, a dependency the lockfile did not pin, or an EAS environment variable the app config reads: then run the preflight as eas env:exec production 'node scripts/eas/release-preflight.ts --profile production --platform all', references/versions-and-fingerprints.md).";
  if (typeof hash !== 'string' || hash === '') {
    ctx.problem('build-fingerprint', 'the build record has no fingerprint (EAS_SKIP_AUTO_FINGERPRINT set, or an old EAS CLI)', 'Unset EAS_SKIP_AUTO_FINGERPRINT and build with the EAS CLI the cli.version floor names.');
    return;
  }
  if (!existsSync(ctx.fingerprintPath)) {
    ctx.problem('build-fingerprint', `no preflight fingerprint at ${ctx.fingerprintRel}`, fix);
    return;
  }
  const local = readJson(ctx.fingerprintPath, ctx.fingerprintRel, fix).hash;
  if (local !== hash) ctx.problem('build-fingerprint', `the build's fingerprint ${hash} differs from the preflight's ${local}`, fix);
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  requireDir(root, 'repo root');
  if (!options.build) throw new UsageError('no build record given', 'Save it with eas build:view <build id> --json > dist/eas/build-ios.json and pass --build dist/eas/build-ios.json.');
  const appRel = posix.normalize(options['app-dir'] ?? '.');
  const configRel = findAppConfig(root, appRel);
  if (configRel === null) throw new UsageError(`no app config in ${appRel}`, 'Run from the repo root, or pass --app-dir.');
  const config = appConfigFacts(readFileSync(join(root, configRel), 'utf8'), configRel);
  const build = pickBuild(readJson(resolve(root, options.build), 'the build record', 'Save it with eas build:view <build id> --json.'), options.platform);
  const platform = options.platform ?? String(build.platform ?? '').toLowerCase();
  if (!['ios', 'android'].includes(platform)) throw new UsageError(`platform ${JSON.stringify(build.platform)} is not ios or android`, 'Pass --platform ios or android.');
  const commit = options.commit ?? git(root, ['rev-parse', 'HEAD']);
  if (!commit) throw new UsageError('no commit under review: not a git repository', 'Pass --commit <sha>.');
  const fingerprintRel = options.fingerprint ?? posix.join(appRel, 'dist', 'eas', `fingerprint-${platform}.json`);
  const report = createReporter({ name: 'check-eas-build', json: options.json });
  const recordRel = options.build;
  const profile = options.profile ?? 'production';
  const ctx = {
    build, platform, profile, commit, config, configRel, fingerprintRel,
    fingerprintPath: resolve(root, fingerprintRel),
    previous: previousBuild(root, options, platform, appRel),
    expectedId: expectedIdentity(root, appRel, profile, platform, config),
    problem: (rule, message, fix) => report.problem({ file: recordRel, line: 0, rule, message: `${platform} build ${build.id ?? '?'}: ${message}`, fix }),
  };
  checkRecord(ctx);
  checkCommit(ctx);
  checkIdentity(ctx);
  checkVersion(ctx);
  checkFingerprint(ctx);
  return report.finish({ checked: 1, unit: 'build records' });
}

await run(main);
