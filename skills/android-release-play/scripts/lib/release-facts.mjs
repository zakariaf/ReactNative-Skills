// release-facts.mjs: what both checkers read from the app repo (a helper, not an entry point): the
// release contract, the app config's literal facts, dependencies, upload tags and the test-only
// sentinels.
//
//   CONTRACT_DEFAULT                   'contracts/android-release.json'
//   contractPath(root, layout, given, appDir)  --contract, else rn-skills.config.json androidReleaseContract, else
//                                      <appDir>/contracts/android-release.json (the app folder's, where the CLI reads it)
//   readContract(root, rel)            { data, text } or null when the file is missing; UsageError when not JSON
//   contractProblems(data, facts)      [{ path, message, fix }]: shape problems of the contract (facts: assets/play-facts.json)
//   findAppConfig(appDir)              'app.config.ts' (or .js/.mjs/.cjs) relative to appDir, or null
//   appConfigText(root, appDir)        { rel, text, masked } or null
//   literalVersion(masked)             the literal version: 'x.y.z' of the app config (or its const APP_VERSION), or null
//   dependsOn(root, appDir, name)      the package is a dependency of the root or the app package
//   androidUploadNumbers(tags, prefix) [{ tag, number }] of vX.Y.Z+<n> and vX.Y.Z+android.<n>
//   readTags(root, listFile)           tag names (git tag --list), or the lines of listFile
//   testOnlySentinels(root, layout, config, given)   every known sentinel string
//   testOnlyGate(root, layout)         { rel, line } of the test-only gate, or null
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { fail, lineOf, maskComments, walkRepo } from '../check-lib.mjs';

export const CONTRACT_DEFAULT = 'contracts/android-release.json';
export const LANES = ['eas', 'local'];
export const UPLOAD_TRACKS = ['internal', 'alpha', 'beta'];
export const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function contractPath(root, layout, given, appDir = '.') {
  if (given) return given;
  const configured = layout.config?.androidReleaseContract;
  if (typeof configured === 'string' && configured !== '') return configured;
  return posix.join(appDir, layout.contractsDir, 'android-release.json').replace(/^\.\//, '');
}

export function readContract(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, 'utf8');
  try {
    return { data: JSON.parse(text), text };
  } catch (error) {
    fail(`${rel} is not JSON (${error.message})`, 'Fix the contract; templates/contracts/android-release.json is the starting point.');
  }
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Shape problems of contracts/android-release.json (the schema's rules, checked without a validator). */
export function contractProblems(data, facts) {
  const problems = [];
  const add = (path, message, fix) => problems.push({ path, message, fix });
  if (!isObject(data)) return [{ path: '', message: 'is not a JSON object', fix: 'Start from templates/contracts/android-release.json.' }];
  if (!LANES.includes(data.lane)) add('lane', `is ${JSON.stringify(data.lane ?? null)}, expected "eas" or "local"`, 'eas: EAS Build signs and EAS Submit uploads; local: Gradle signs with the upload key and scripts/release-android uploads.');
  if (typeof data.applicationId !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(data.applicationId)) add('applicationId', `is ${JSON.stringify(data.applicationId ?? null)}, not an Android package`, 'Write the production android.package of app.config.ts (the id Play knows the app by; it can never change).');
  if (data.uploadCertificateSha256 !== null && (typeof data.uploadCertificateSha256 !== 'string' || !FINGERPRINT.test(data.uploadCertificateSha256))) add('uploadCertificateSha256', 'is not null or a SHA-256 fingerprint (32 upper-case hex pairs separated by colons)', 'Copy the upload key certificate SHA-256 from Play Console (Test and release, App integrity) or eas credentials; null until the first upload.');
  if (!Number.isInteger(data.minTargetSdk) || data.minTargetSdk < facts.targetSdkFloor) add('minTargetSdk', `is ${JSON.stringify(data.minTargetSdk ?? null)}, below Google Play's floor ${facts.targetSdkFloor}`, `Use ${facts.targetSdkFloor} or higher (${facts.targetSdkSource.split(':')[0]}).`);
  if (!UPLOAD_TRACKS.includes(data.uploadTrack)) add('uploadTrack', `is ${JSON.stringify(data.uploadTrack ?? null)}, expected internal, alpha or beta`, 'Uploads go to a testing track; production is reached by promotion with a staged rollout, never by an upload.');
  const steps = data.rollout;
  const isAscending = Array.isArray(steps) && steps.every((step, index) => typeof step === 'number' && step > 0 && step <= 1 && (index === 0 || step > steps[index - 1]));
  if (!isAscending || steps.length < 2 || steps[0] > 0.2 || steps.at(-1) !== 1) add('rollout', `is ${JSON.stringify(steps ?? null)}`, 'List rising fractions of users that start at 0.2 or less and end at 1, for example [0.05, 0.2, 0.5, 1].');
  if (data.releaseBranch !== undefined && (typeof data.releaseBranch !== 'string' || !/^(?!-)[A-Za-z0-9._/-]+$/.test(data.releaseBranch))) add('releaseBranch', `is ${JSON.stringify(data.releaseBranch)}, not a branch name`, 'Name the branch local-lane releases come from (default "main"), or remove the key.');
  if (data.releaseNotesLanguage !== undefined && (typeof data.releaseNotesLanguage !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(data.releaseNotesLanguage))) add('releaseNotesLanguage', `is ${JSON.stringify(data.releaseNotesLanguage)}, not a Play language code`, 'Use the language code of the app\'s default store listing as Play Console names it (en-US, de-DE, es-419), or remove the key (default "en-US").');
  if (!isObject(data.permissions)) add('permissions', 'is not an object of permission name -> { reason }', 'List every permission the release bundle holds with why the app needs it.');
  else {
    for (const [name, entry] of Object.entries(data.permissions)) {
      if (!isObject(entry) || typeof entry.reason !== 'string' || entry.reason.trim().length < 10) add(`permissions.${name}`, 'has no reason (10 characters or more)', 'Say which feature or library needs it; the reviewer and the Data safety form both ask.');
      if (isObject(entry) && entry.playDeclaration !== undefined && (typeof entry.playDeclaration !== 'string' || entry.playDeclaration.trim() === '')) add(`permissions.${name}.playDeclaration`, 'is empty', 'Name the Play Console declaration that was filled in, or remove the key.');
    }
  }
  return problems;
}

/** The line of a JSON key in the contract text, for problem lines. */
export function lineOfKey(text, key) {
  const at = text.indexOf(`"${key.split('.').at(-1)}"`);
  return at < 0 ? 1 : lineOf(text, at);
}

const CONFIG_NAMES = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs'];

export function findAppConfig(root, appDir) {
  return CONFIG_NAMES.map((name) => posix.join(appDir, name).replace(/^\.\//, '')).find((rel) => existsSync(join(root, rel))) ?? null;
}

export function appConfigText(root, appDir) {
  const rel = findAppConfig(root, appDir);
  if (rel === null) return null;
  const text = readFileSync(join(root, rel), 'utf8');
  return { rel, text, masked: maskComments(text) };
}

export function literalVersion(masked) {
  const literal = /\bversion\s*:\s*(['"])(\d+\.\d+\.\d+)\1/.exec(masked)?.[2];
  if (literal) return literal;
  // `version: APP_VERSION` with `const APP_VERSION = 'x.y.z';` (the local iOS lane's shape) is the same literal.
  if (!/\bversion\s*:\s*APP_VERSION\b/.test(masked)) return null;
  return /\bconst\s+APP_VERSION\s*=\s*(['"])(\d+\.\d+\.\d+)\1/.exec(masked)?.[2] ?? null;
}

function packageJson(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    fail(`${rel} is not JSON`, 'Fix package.json.');
  }
}

export function readPackages(root, appDir) {
  const rels = [...new Set(['package.json', posix.join(appDir, 'package.json').replace(/^\.\//, '')])];
  return rels.map((rel) => ({ rel, data: packageJson(root, rel) })).filter((item) => item.data !== null);
}

export function dependsOn(packages, name) {
  return packages.some(({ data }) => Boolean(data.dependencies?.[name] ?? data.devDependencies?.[name]));
}

/** Android upload tags: the per-platform form vX.Y.Z+android.<n> (both lanes) and the shared vX.Y.Z+<n> an app may already have. */
export function androidUploadNumbers(tags, prefix) {
  const head = prefix ? `${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/` : '';
  const pattern = new RegExp(`^${head}v\\d+\\.\\d+\\.\\d+\\+(?:android\\.)?(\\d+)$`);
  return tags.map((tag) => ({ tag, number: Number(pattern.exec(tag)?.[1] ?? Number.NaN) })).filter((item) => Number.isInteger(item.number));
}

export function readTags(root, listFile) {
  if (listFile) {
    if (!existsSync(listFile)) fail(`--tags-list ${listFile} does not exist`, 'Pass a file with one tag per line (git tag --list > tags.txt).');
    return readFileSync(listFile, 'utf8').split('\n').map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
  }
  try {
    return execFileSync('git', ['-C', root, 'tag', '--list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    fail(`cannot read the git tags of ${root}`, 'Run from the repo root of a git repository, or pass --tags-list <file> with the upload tags.');
  }
}

const SOURCE = /\.[cm]?[jt]sx?$/;
const NOT_APP_CODE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:^|\/)__tests__\/|\.d\.ts$/;
const SENTINEL_CONST = /\bexport\s+const\s+([A-Z0-9_]*SENTINEL[A-Z0-9_]*)\s*(?::\s*[\w.<>|[\] ]+)?=\s*(['"])([^'"\n]{6,})\2/g;
const GATE_LITERAL = /process\.env\.EXPO_PUBLIC_APP_VARIANT\s*[!=]==?\s*(['"])(?:development|preview|production)\1/;

function appSources(root, layout) {
  if (!existsSync(join(root, layout.srcDir))) return [];
  return walkRepo(root, { include: [`${layout.srcDir}/**`] }).filter((rel) => SOURCE.test(rel) && !NOT_APP_CODE.test(rel));
}

/** --sentinel values, else rn-skills.config.json testOnlySentinels plus every exported *SENTINEL* string under src/. */
export function testOnlySentinels(root, layout, given) {
  if (given.length > 0) return [...new Set(given)];
  const found = new Set();
  const configured = layout.config?.testOnlySentinels;
  if (Array.isArray(configured)) configured.filter((value) => typeof value === 'string' && value !== '').forEach((value) => found.add(value));
  for (const rel of appSources(root, layout)) {
    for (const match of readFileSync(join(root, rel), 'utf8').matchAll(SENTINEL_CONST)) found.add(match[3]);
  }
  return [...found].sort();
}

/** The test-only gate (debug-menu-and-test-hooks): a test-only.ts under src, or a require() behind the literal variant check. */
export function testOnlyGate(root, layout) {
  const sources = appSources(root, layout);
  const named = sources.find((rel) => /(?:^|\/)test-only\.[cm]?[jt]sx?$/.test(rel));
  if (named) return { rel: named, line: 1 };
  for (const rel of sources) {
    const text = readFileSync(join(root, rel), 'utf8');
    const match = GATE_LITERAL.exec(text);
    if (match && /\brequire\s*\(/.test(text)) return { rel, line: lineOf(text, match.index) };
  }
  return null;
}
