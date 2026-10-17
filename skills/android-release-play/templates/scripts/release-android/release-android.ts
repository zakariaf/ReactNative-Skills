// scripts/release-android/release-android.ts
// CLI (local lane): npm run release:android -- build | upload | rollout | halt   (--help: usage)
// build: preflight (lane local, a clean contract releaseBranch (main by default), npm run verify
// green, JDK and SDK set, the upload key in
// place), the next versionCode (above ANDROID_VERSION_CODE and every Android upload tag) written
// into app.config.ts and committed as chore(release): build <n>, a clean Android prebuild of the
// production variant (package.json written back when the prebuild only rewrote its ios/android
// scripts), Gradle bundleRelease (Gradle reads the upload key's passwords from
// ~/.gradle/gradle.properties by itself), then the gate command. upload: only when the gate's stamp
// matches these bytes and its versionCode is above every Android upload tag, the bundle to the
// contract's testing track through the Play API (release notes in the contract
// releaseNotesLanguage, en-US by default), then the annotated tag vX.Y.Z+android.<n>. rollout / halt:
// the production track's release. A PlayStop is never retried; --changes-not-sent-for-review commits
// with changesNotSentForReview=true only when the developer chose it. Nothing is pushed. Proven by the release itself (check-store-aab, then the Play upload);
// the decisions live in the tested modules beside it.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createPlayClient, PlayStop, setTrackRelease, uploadBundle } from './play-client.ts';
import { loadServiceAccount, serviceAccountPathOf } from './play-credentials.ts';
import { isHelpRequest, parseReleaseArgs, RELEASE_ANDROID_USAGE } from './release-args.ts';
import {
  AAB_PATH,
  BUNDLE_ARGS,
  CONTRACT_PATH,
  gateCommand,
  LOG_DIR,
  onlyScriptsRewritten,
  parseReleaseContract,
  preflightProblems,
  PREBUILD_ARGS,
  rolloutStepProblems,
  STAMP_PATH,
  toolchainProblems,
  uploadProblems,
  uploadRelease,
} from './release-plan.ts';
import { haltRelease, promotionProblems, rolloutRelease } from './rollout.ts';
import { uploadKeyPathOf, uploadKeyProblems } from './upload-key.ts';
import {
  androidBuildNumbers,
  bumpVersionCode,
  nextVersionCode,
  readVersionCode,
  tagPrefixOf,
  uploadTag,
  usedVersionCodeProblems,
} from './version-code.ts';
import { variantEnv } from '../../src/config/app-variant.ts';
import { nowEpochSeconds } from '../clock/system-clock.ts';

import type { Http, PlayClient } from './play-client.ts';
import type { ReleaseCommand } from './release-args.ts';
import type { GateStamp, ReleaseContract } from './release-plan.ts';

/** The repo is not ready (exit 2): nothing was bumped, built or sent. */
class StopError extends Error {}

const APP_CONFIG = 'app.config.ts';
const PACKAGE_JSON = 'package.json';

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function refuse(problems: readonly string[], what: string): void {
  if (problems.length > 0) {
    throw new StopError(`${what}:\n  ${problems.join('\n  ')}`);
  }
}

function statOf(path: string): { isFile: boolean; mode: number } | null {
  return existsSync(path) ? { isFile: statSync(path).isFile(), mode: statSync(path).mode } : null;
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function appVersion(): string {
  const version = /\bversion: '(?<value>\d+\.\d+\.\d+)'/u.exec(readFileSync(APP_CONFIG, 'utf8'));
  if (version?.groups?.['value'] === undefined) {
    throw new StopError(`${APP_CONFIG} has no literal version: 'x.y.z'`);
  }
  return version.groups['value'];
}

function preflight(contract: ReleaseContract): void {
  const key = uploadKeyPathOf(contract.applicationId, homedir());
  const quick = {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    releaseBranch: contract.releaseBranch,
    isTreeClean: git(['status', '--porcelain']) === '',
    lane: contract.lane,
  };
  refuse(
    [
      ...preflightProblems({ ...quick, isVerifyGreen: true }),
      ...toolchainProblems(process.env),
      ...uploadKeyProblems({ path: key, repoRoot: process.cwd(), stat: statOf(key) }),
    ],
    'preflight failed, nothing was built',
  );
  console.log('release:android: npm run verify ...');
  const verify = spawnSync('npm', ['run', '-s', 'verify'], { stdio: 'inherit' });
  refuse(
    preflightProblems({ ...quick, isVerifyGreen: verify.status === 0 }),
    'preflight failed, nothing was built',
  );
}

function androidTags(): string[] {
  return git(['tag', '--list']).split('\n').filter(Boolean);
}

/** null for a single app; the app folder's name when multi-package (tags mobile/v1.4.0+android.15). */
function tagPrefix(): string | null {
  return tagPrefixOf(git(['rev-parse', '--show-prefix']));
}

/** The next number, committed before the build: a failed build never gives it back. */
function bumpAndCommit(): number {
  const source = readFileSync(APP_CONFIG, 'utf8');
  const prefix = tagPrefix();
  const versionCode = nextVersionCode({
    current: readVersionCode(source),
    tags: androidTags(),
    prefix,
  });
  writeFileSync(APP_CONFIG, bumpVersionCode(source, versionCode));
  git(['add', APP_CONFIG]);
  const subject = `chore(${prefix ?? 'release'}): build ${String(versionCode)}`;
  git(['commit', '-m', subject, '-m', 'Google Play, local lane.']);
  return versionCode;
}

function runStep(
  name: string,
  command: { readonly file: string; readonly args: readonly string[] },
): void {
  console.log(`release:android: ${name} ...`);
  mkdirSync(LOG_DIR, { recursive: true });
  const env = { ...process.env, ...variantEnv('production') };
  const result = spawnSync(command.file, command.args, {
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const log = join(LOG_DIR, `${name}.log`);
  writeFileSync(log, `${result.stdout}${result.stderr}`);
  if (result.status !== 0) {
    throw new Error(`step "${name}" failed (exit ${String(result.status)}), see ${log}`);
  }
}

/** Writes package.json back when the prebuild only rewrote its ios and android scripts. */
function keepPackageJson(before: string): void {
  if (!onlyScriptsRewritten(before, readFileSync(PACKAGE_JSON, 'utf8'))) return;
  writeFileSync(PACKAGE_JSON, before);
  console.log(
    `release:android: restored ${PACKAGE_JSON}: the prebuild had rewritten its ios/android scripts`,
  );
}

function build(contract: ReleaseContract): number {
  preflight(contract);
  const versionCode = bumpAndCommit();
  const packageJson = readFileSync(PACKAGE_JSON, 'utf8');
  try {
    runStep('prebuild', { file: 'npx', args: PREBUILD_ARGS });
  } finally {
    keepPackageJson(packageJson);
  }
  runStep('bundle', { file: join('android', 'gradlew'), args: BUNDLE_ARGS });
  console.log(
    `release:android: built ${AAB_PATH} (versionCode ${String(versionCode)}, sha256 ${sha256Of(AAB_PATH)})`,
  );
  console.log(`release:android: next, the gate: ${gateCommand(versionCode)}`);
  console.log(
    "release:android: then, with the developer's word: npm run release:android -- upload",
  );
  return 0;
}

const fetchHttp: Http = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: { ...request.headers },
    body: request.body,
  });
  return { status: response.status, text: await response.text() };
};

function playClient(contract: ReleaseContract): PlayClient {
  const account = loadServiceAccount(
    serviceAccountPathOf(contract.applicationId, homedir()),
    process.cwd(),
  );
  return createPlayClient({
    http: fetchHttp,
    account,
    packageName: contract.applicationId,
    nowSeconds: nowEpochSeconds,
  });
}

async function upload(
  contract: ReleaseContract,
  command: Extract<ReleaseCommand, { command: 'upload' }>,
): Promise<number> {
  if (!existsSync(AAB_PATH)) throw new StopError(`${AAB_PATH} not found: run the build first`);
  const stamp = existsSync(STAMP_PATH)
    ? (JSON.parse(readFileSync(STAMP_PATH, 'utf8')) as GateStamp)
    : null;
  const uploaded = { tags: androidTags(), prefix: tagPrefix() };
  const aabSha256 = sha256Of(AAB_PATH);
  refuse(
    [
      ...uploadProblems({ stamp, aabSha256, applicationId: contract.applicationId }),
      ...(stamp === null ? [] : usedVersionCodeProblems(stamp.versionCode, uploaded)),
    ],
    'nothing was uploaded',
  );
  const release = uploadRelease({ ...command, language: contract.releaseNotesLanguage });
  const versionCode = await uploadBundle(playClient(contract), {
    bytes: readFileSync(AAB_PATH),
    track: contract.uploadTrack,
    release,
    isReviewSentByHand: command.isReviewSentByHand,
  });
  const tag = uploadTag({ version: appVersion(), versionCode, prefix: tagPrefix() });
  const message = `Google Play build ${String(versionCode)} (${contract.uploadTrack})`;
  git(['tag', '-a', tag, '-m', message]);
  console.log(
    `release:android: versionCode ${String(versionCode)} is on ${contract.uploadTrack}; tagged ${tag} locally (push only with the developer's word)`,
  );
  return 0;
}

async function production(
  contract: ReleaseContract,
  command: Extract<ReleaseCommand, { versionCode: number }>,
): Promise<number> {
  const uploaded = androidBuildNumbers(androidTags(), tagPrefix());
  refuse(
    [
      ...promotionProblems({ versionCode: command.versionCode, uploadedVersionCodes: uploaded }),
      ...rolloutStepProblems(command.fraction, contract.rollout),
    ],
    'production unchanged',
  );
  const release = command.command === 'halt' ? haltRelease(command) : rolloutRelease(command);
  await setTrackRelease(playClient(contract), {
    track: 'production',
    release,
    isReviewSentByHand: command.isReviewSentByHand,
  });
  console.log(
    `release:android: production is now ${release.status} for versionCode ${String(command.versionCode)}${release.userFraction === undefined ? '' : ` at ${String(release.userFraction)}`}`,
  );
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  if (isHelpRequest(argv)) {
    console.log(RELEASE_ANDROID_USAGE);
    return 0;
  }
  const command = parseReleaseArgs(argv);
  if (!existsSync(CONTRACT_PATH))
    throw new StopError(`${CONTRACT_PATH} not found: run from the repo root`);
  const contract = parseReleaseContract(readFileSync(CONTRACT_PATH, 'utf8'));
  if (command.command === 'build') return build(contract);
  if (command.command === 'upload') return upload(contract, command);
  return production(contract, command);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stop =
    error instanceof PlayStop ? ' Not retried: send this line to the developer and wait.' : '';
  console.error(`release:android: ${message}${stop}`);
  process.exitCode = error instanceof StopError ? 2 : 1;
}
