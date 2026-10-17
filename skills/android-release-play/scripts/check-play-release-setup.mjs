#!/usr/bin/env node
// check-play-release-setup.mjs: checks the repo setup a Google Play release depends on, before any
// build: the release contract, the lane (EAS Build + Submit, or the local Gradle + Play API lane with
// its script, tooling, upload-signing plugin and Android version code), the target SDK in the app
// config, no keystore, service-account key or EAS credentials.json exposed: outside the repo or
// ignored by git, and denied to agents, the
// service-account key read in one module only, no signing password on a command line or in a file
// (code, scripts, CI, *.properties, .env*), and no Android upload that skips the store-AAB gate
// (eas build --auto-submit, eas submit --latest). --release (before a store build) also refuses
// template values and an unregistered upload key.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-play-release-setup.mjs .
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, lineOf, maskComments, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { appConfigText, contractPath, contractProblems, dependsOn, LANES, lineOfKey, readContract, readPackages } from './lib/release-facts.mjs';
import { placeholderProblem, placeholdersIn } from './lib/ship-placeholders.mjs';

const PLAY_FACTS = JSON.parse(readFileSync(new URL('../assets/play-facts.json', import.meta.url), 'utf8'));

const RELEASE_SCRIPT = 'node scripts/release-android/release-android.ts';
const RELEASE_DIR = 'scripts/release-android';
const RELEASE_FILES = ['release-android.ts', 'release-args.ts', 'release-plan.ts', 'version-code.ts', 'upload-key.ts', 'play-credentials.ts', 'play-client.ts', 'rollout.ts'];
/** The CLI imports it (dependency-management's canonical clock; this skill ships a synced copy). */
const CLOCK_FILE = 'scripts/clock/system-clock.ts';
const SIGNING_PLUGIN = './plugins/with-upload-signing.ts';
const PLUGIN_FILE = 'plugins/with-upload-signing.ts';
const VERSION_CONST = 'ANDROID_VERSION_CODE';
const GITIGNORE = ['*.jks', '*.keystore', 'credentials.json'];
const DENY = ['Read(**/*.jks)', 'Read(**/*.keystore)', 'Read(**/credentials.json)', 'Read(**/*service-account*.json)'];
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const INLINE_SECRET = [
  { pattern: /android\.injected\.signing\.(?:store|key)\.password/, what: 'a signing password passed as -Pandroid.injected.signing.*.password' },
  { pattern: /\bstorePassword\s*[=(:]?\s*['"](?!android['"])[^'"\n]+['"]/, what: 'a literal storePassword' },
  { pattern: /\bkeyPassword\s*[=(:]?\s*['"](?!android['"])[^'"\n]+['"]/, what: 'a literal keyPassword' },
  { pattern: /-(?:store|key)pass\s+(?!:env)\S/, what: 'a keytool password on the command line' },
];
/** A signing password as a properties or dotenv line: MYAPP_UPLOAD_STORE_PASSWORD=..., storePassword=..., KEY_PASSWORD: ... */
const PROPERTY_SECRET = /^[ \t]*(?:export[ \t]+)?([A-Za-z0-9_.-]*(?:store|key)[_.-]?pass(?:word)?)[ \t]*[=:][ \t]*(\S[^\r\n]*)$/gim;
const PROPERTY_FILE = /(?:^|\/)(?:[^/]+\.properties|\.env(?:\.[^/]+)?)$/;
/**
 * An eas build or submit command in a script, a CI step or a shell file (eas-cli through npx too). The
 * arguments run to the end of the line or an unquoted ; & |, so a quoted "$PROFILE" does not hide the
 * flags after it (a minified package.json with several scripts on one line is the documented limit).
 */
const EAS_COMMAND = /\b(?:npx\s+)?eas(?:-cli(?:@[\w.^~-]+)?)?\s+(build|submit)\b([^\n;&|]*)/g;

const SPEC = {
  name: 'check-play-release-setup',
  summary: 'Checks the repo setup a Google Play release depends on: the release contract, the EAS or local lane, the upload-signing plugin and build number (local), the target SDK, keys outside the repo and ignored, credentials read in one place, no inline signing passwords, no Android upload around the gate.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: "The app folder relative to the repo root (default '.'; when multi-package, e.g. apps/mobile)" },
    contract: { type: 'string', value: 'file', help: 'The release contract, repo-relative (default: rn-skills.config.json androidReleaseContract, else <app-dir>/contracts/android-release.json)' },
    release: { type: 'boolean', help: 'Before a store build: also refuse template values (com.example.*, __NAME__) and a null uploadCertificateSha256; never NOT APPLICABLE' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  contract            contracts/android-release.json exists once the app ships to Play, and has the schema\'s shape',
    '                      (lane, applicationId, uploadCertificateSha256, minTargetSdk, uploadTrack, rollout, permissions)',
    '  application-id      the contract applicationId is a string literal of the app config (the production android.package)',
    '  lane                eas: eas.json has submit.production.android whose track is the contract uploadTrack and whose',
    '                      applicationId is the contract applicationId;',
    `                      local: package.json release:android (the app's, else the root's) is "${RELEASE_SCRIPT}" and`,
    `                      <app-dir>/${RELEASE_DIR}/ holds the tooling, with <app-dir>/${CLOCK_FILE}`,
    `  signing-plugin      local: the app config lists ['${SIGNING_PLUGIN}', { applicationId }] and <app-dir>/${PLUGIN_FILE} exists`,
    `  version-source      local: the app config has exactly one \`const ${VERSION_CONST} = <n>;\` and android versionCode: ${VERSION_CONST}`,
    `  target-sdk-config   no targetSdkVersion or compileSdkVersion below ${PLAY_FACTS.targetSdkFloor} (or the contract minTargetSdk) in the app config`,
    '  secrets-outside     no *.jks or *.keystore file and no Google service-account key inside the repo (EAS\'s',
    '                      credentials.json is allowed there only because it is ignored and denied, below)',
    `  secrets-ignored     .gitignore lists ${GITIGNORE.join(', ')}; .claude/settings.json denies ${DENY.join(', ')}`,
    '  credentials-read    only <app-dir>/scripts/release-android/play-credentials.ts names the service-account file, and',
    '                      only it and upload-key.ts name a .jks path',
    '  inline-secrets      no signing password in package.json scripts, scripts/ (code and shell), plugins/, the app config,',
    '                      eas.json, CI workflows, any *.properties file (gradle.properties, keystore.properties) or .env* file',
    '                      (heuristic: a password built from pieces, a $VAR reference or the debug keystore\'s "android" passes;',
    '                      review signing code by hand, references/signing-and-keys.md)',
    '  gated-upload        no package.json script, CI workflow or shell script runs eas build --auto-submit or eas submit',
    '                      --latest for Android (--platform android or all, or no --platform): the gate never saw those bytes',
    '  ship-placeholder    (--release) the contract applicationId is no template value',
    '  upload-cert         (--release) uploadCertificateSha256 is set',
    'NOT APPLICABLE when package.json has no expo dependency, when the app config limits platforms without android, or',
    '(without --release) when nothing ships to Play yet: no contract, no eas.json submit android profile, no release:android',
    'script. rn-skills.config.json key: androidReleaseContract.',
  ].join('\n'),
};

function readJson(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return undefined;
  }
}

function submitsToPlay(eas) {
  return Boolean(eas && typeof eas === 'object' && Object.values(eas.submit ?? {}).some((profile) => profile && typeof profile === 'object' && profile.android));
}

/** A path inside the app folder, repo-relative ('.' keeps it at the root). */
function inApp(appDir, rel) {
  return posix.join(appDir, rel).replace(/^\.\//, '');
}

/** The release:android script: the app package's, else the root's (npm workspaces run either). */
function releaseScriptOf(packages, appDir) {
  const own = packages.find((item) => item.rel === inApp(appDir, 'package.json'))?.data.scripts?.['release:android'];
  if (own !== undefined) return { rel: inApp(appDir, 'package.json'), value: own };
  return { rel: 'package.json', value: packages.find((item) => item.rel === 'package.json')?.data.scripts?.['release:android'] };
}

function checkLane(ctx) {
  const { root, appDir, contract, report, packages, contractRel } = ctx;
  if (contract.lane === 'eas') {
    const easRel = inApp(appDir, 'eas.json');
    const eas = readJson(root, easRel);
    const android = eas?.submit?.production?.android;
    if (!android) {
      report.problem({ file: easRel, rule: 'lane', message: 'the contract lane is eas, but eas.json has no submit.production.android', fix: 'Add the production submit profile (eas-build-and-submit owns eas.json), or set the contract lane to local.' });
      return;
    }
    if (android.track !== contract.uploadTrack) report.problem({ file: easRel, rule: 'lane', message: `submit.production.android.track is ${JSON.stringify(android.track ?? null)}, the contract uploadTrack is ${contract.uploadTrack}`, fix: `Use one testing track in both: uploads go to ${contract.uploadTrack}, production comes only by promotion with a staged rollout.` });
    if (android.applicationId !== contract.applicationId) report.problem({ file: easRel, rule: 'lane', message: `submit.production.android.applicationId is ${JSON.stringify(android.applicationId ?? null)}, the contract applicationId is ${contract.applicationId}`, fix: `Pin "applicationId": "${contract.applicationId}" there: EAS Submit then picks the Play app and the stored service-account key of the production package, never the id of whatever variant the shell exported.` });
    return;
  }
  const script = releaseScriptOf(packages, appDir);
  if (script.value !== RELEASE_SCRIPT) report.problem({ file: script.rel, rule: 'lane', message: `the contract lane is local, but scripts["release:android"] is ${JSON.stringify(script.value ?? null)}`, fix: `Set it to exactly "${RELEASE_SCRIPT}" (it runs from the app folder).` });
  for (const name of RELEASE_FILES) {
    const rel = inApp(appDir, `${RELEASE_DIR}/${name}`);
    if (!existsSync(join(root, rel))) report.problem({ file: rel, rule: 'lane', message: 'is missing (local lane tooling)', fix: `Copy templates/${RELEASE_DIR}/ with its tests into the app folder (${contractRel} says lane local).` });
  }
  const clock = inApp(appDir, CLOCK_FILE);
  if (!existsSync(join(root, clock))) report.problem({ file: clock, rule: 'lane', message: 'is missing (release-android.ts imports it for the token time)', fix: 'Copy templates/scripts/clock/system-clock.ts with its test (dependency-management\'s canonical file); without it release:android fails with a module-not-found error.' });
}

function checkAppConfig(ctx) {
  const { contract, report, config } = ctx;
  if (config === null) {
    report.problem({ file: posix.join(ctx.appDir, 'app.config.ts'), rule: 'application-id', message: 'no app config (app.config.ts) to compare the contract with', fix: 'Expo apps keep one app.config.ts (expo-prebuild-and-config-plugins).' });
    return;
  }
  const { rel, masked } = config;
  const quoted = new RegExp(`(['"\`])${contract.applicationId.replaceAll('.', '\\.')}\\1`);
  if (!quoted.test(masked)) report.problem({ file: rel, rule: 'application-id', message: `the contract applicationId ${contract.applicationId} is not a string literal of the app config`, fix: 'The contract names the production android.package exactly as app.config.ts writes it; Play binds the app to that id for good.' });
  const floor = Math.max(PLAY_FACTS.targetSdkFloor, Number.isInteger(contract.minTargetSdk) ? contract.minTargetSdk : 0);
  for (const match of masked.matchAll(/\b(targetSdkVersion|compileSdkVersion)\s*:\s*(\d+)/g)) {
    if (Number(match[2]) < floor) report.problem({ file: rel, line: lineOf(masked, match.index), rule: 'target-sdk-config', message: `${match[1]} is ${match[2]}, below ${floor}`, fix: `Google Play refuses updates that target less than API ${PLAY_FACTS.targetSdkFloor}; remove the override (Expo SDK 57 sets 36).` });
  }
  if (contract.lane !== 'local') return;
  const plugin = masked.indexOf(`'${SIGNING_PLUGIN}'`);
  if (plugin < 0 || !/applicationId/.test(masked.slice(plugin, plugin + 200))) report.problem({ file: rel, rule: 'signing-plugin', message: `the local lane needs ['${SIGNING_PLUGIN}', { applicationId }] in the plugins list`, fix: 'Without it the release build signs with the debug key, and the store-AAB gate refuses the bundle.' });
  const pluginFile = inApp(ctx.appDir, PLUGIN_FILE);
  if (!existsSync(join(ctx.root, pluginFile))) report.problem({ file: pluginFile, rule: 'signing-plugin', message: 'is missing', fix: 'Copy templates/plugins/with-upload-signing.ts with its test, next to the app config (it resolves ./plugins/ from the app folder).' });
  const numbers = masked.match(new RegExp(`\\bconst ${VERSION_CONST} = \\d+;`, 'g')) ?? [];
  const legacy = /\bconst BUILD_NUMBER = \d+;/.test(masked) ? ' A shared `const BUILD_NUMBER` moves once to per-platform counters (references/release-pipeline.md, Version codes and tags).' : '';
  if (numbers.length !== 1) report.problem({ file: rel, rule: 'version-source', message: `has ${numbers.length} \`const ${VERSION_CONST} = <n>;\` lines, expected 1`, fix: `The local lane keeps one literal Android version code that release:android bumps; iOS keeps its own counter.${legacy}` });
  if (!new RegExp(`\\bversionCode\\s*:\\s*${VERSION_CONST}\\b`).test(masked)) report.problem({ file: rel, rule: 'version-source', message: `android.versionCode is not ${VERSION_CONST}`, fix: `Write android: { versionCode: ${VERSION_CONST}, ... } so the bumped number reaches the bundle.` });
}

function isServiceAccountKey(root, rel) {
  if (/service-account.*\.json$/i.test(posix.basename(rel))) return true;
  if (!rel.endsWith('.json') || statSync(join(root, rel)).size > 64 * 1024) return false;
  const text = readFileSync(join(root, rel), 'utf8');
  return /"type"\s*:\s*"service_account"/.test(text) && /"private_key"/.test(text);
}

function checkSecretFiles(ctx) {
  const { root, report } = ctx;
  for (const rel of walkRepo(root, { include: ['*.jks', '*.keystore', '*.json'] })) {
    if (/\.(jks|keystore)$/.test(rel)) report.problem({ file: rel, rule: 'secrets-outside', message: 'a keystore inside the repo', fix: 'Move it to ~/.android-keys/ (chmod 600) without opening it; if it was ever committed, treat the key as leaked (references/signing-and-keys.md, If a secret leaks).' });
    else if (isServiceAccountKey(root, rel)) report.problem({ file: rel, rule: 'secrets-outside', message: 'a Google service-account key inside the repo', fix: 'Move it to ~/.android-keys/<applicationId>-play-service-account.json (chmod 600), or upload it to EAS; a key that was committed is deleted in Google Cloud and replaced.' });
  }
  const ignored = new Set((existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf8') : '').split('\n').map((line) => line.trim()));
  for (const entry of GITIGNORE) {
    if (!ignored.has(entry)) report.problem({ file: '.gitignore', rule: 'secrets-ignored', message: `does not ignore ${entry}`, fix: `Add the line ${entry}: a keystore must never reach git.` });
  }
  const settings = readJson(root, '.claude/settings.json');
  const deny = settings?.permissions?.deny ?? [];
  for (const rule of DENY) {
    if (!deny.includes(rule)) report.problem({ file: '.claude/settings.json', rule: 'secrets-ignored', message: `permissions.deny lacks ${rule}`, fix: 'Merge the deny rule into .claude/settings.json (quality-gates owns the file; the developer approves the edit). Never opening the files is the real guard; the rule is defence in depth.' });
  }
}

/** A signing password written into a properties or dotenv file (the debug keystore's "android" and $VAR references aside). */
function checkPropertySecrets(rel, text, report) {
  for (const match of text.matchAll(PROPERTY_SECRET)) {
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    // Empty, the debug keystore's "android", a $VAR reference, and documentation placeholders
    // (<your password>, __UPLOAD_STORE_PASSWORD__) are not passwords.
    if (value === '' || value === 'android' || value.startsWith('$') || /^<[^>]*>$|^__[A-Z0-9_]+__$/.test(value)) continue;
    report.problem({ file: rel, line: lineOf(text, match.index), rule: 'inline-secrets', message: `a signing password written into ${posix.basename(rel)} (${match[1]})`, fix: 'Delete the line: the upload key passwords live only in ~/.gradle/gradle.properties (outside the repo; Gradle reads it by itself) or the CI secret store. If the file was ever committed or shared, treat the password and the key as leaked (references/signing-and-keys.md, If a secret leaks).' });
  }
}

/** eas build --auto-submit and eas submit --latest for Android: an upload the store-AAB gate never saw. */
function checkGatedUpload(rel, raw, report) {
  const text = raw.replace(/\\(\r?\n)/g, (joint) => ' '.repeat(joint.length));
  for (const match of text.matchAll(EAS_COMMAND)) {
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    if (/^\s*#/.test(text.slice(lineStart, match.index))) continue;
    const [, sub, args] = match;
    const platform = /(?:--platform|-p)(?:=|\s+)['"]?(\w+)/.exec(args)?.[1] ?? null;
    if (platform !== null && platform !== 'android' && platform !== 'all') continue;
    const forAndroid = platform === null ? 'with no --platform (EAS asks, and all includes Android)' : `for --platform ${platform}`;
    const at = { file: rel, line: lineOf(text, match.index), rule: 'gated-upload' };
    if (sub === 'build' && /--auto-submit(?:-with-profile)?\b|--submit\b|(?:^|\s)-s(?=\s|$|["'])/.test(args)) report.problem({ ...at, message: `eas build --auto-submit ${forAndroid}: the bundle goes to Google Play before the store-AAB gate reads it`, fix: 'Build Android without --auto-submit, download the artifact, gate it with check-store-aab.mjs --stamp, then eas submit --platform android --path <that file> with the developer\'s word. Keep --auto-submit for --platform ios only (references/release-pipeline.md, The EAS lane).' });
    if (sub === 'submit' && /--latest\b/.test(args)) report.problem({ ...at, message: `eas submit --latest ${forAndroid}: submits whatever build finished last, not the gated bytes`, fix: 'Run check-eas-build on the record and check-store-aab on the downloaded bundle, then submit that file: eas submit --platform android --profile production --path <bundle> (references/release-pipeline.md, The EAS lane).' });
  }
}

function checkCode(ctx) {
  const { root, appDir, report } = ctx;
  const credentialModules = ['play-credentials.ts', 'upload-key.ts'].map((name) => inApp(appDir, `${RELEASE_DIR}/${name}`));
  const appGlobs = ['scripts/**', 'src/**', 'plugins/**', 'app.config.*', 'package.json', 'eas.json'];
  const include = [...new Set([...appGlobs, ...appGlobs.map((glob) => inApp(appDir, glob)), '.github/workflows/**', '*.properties', '.env*'])];
  const scanned = walkRepo(root, { include });
  for (const rel of scanned) {
    if (PROPERTY_FILE.test(rel)) {
      checkPropertySecrets(rel, readFileSync(join(root, rel), 'utf8'), report);
      continue;
    }
    const isCode = CODE.test(rel) && !TEST.test(rel);
    const isConfig = /(^|\/)(package|eas)\.json$|^\.github\/workflows\/.+\.ya?ml$|\.(?:sh|bash)$/.test(rel);
    if (!isCode && !isConfig) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    if (isConfig && !rel.endsWith('eas.json')) checkGatedUpload(rel, text, report);
    const code = isCode ? maskComments(text) : text;
    for (const { pattern, what } of INLINE_SECRET) {
      const match = pattern.exec(code);
      if (match) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'inline-secrets', message: what, fix: 'Gradle reads the upload key properties from ~/.gradle/gradle.properties and keytool reads passwords with -storepass:env; a password in a file or a process list leaks.' });
    }
    if (!isCode || credentialModules.includes(rel)) continue;
    const named = /service-account|\.android-keys|['"`][^'"`\n]*\.jks['"`]/.exec(code);
    if (named) report.problem({ file: rel, line: lineOf(code, named.index), rule: 'credentials-read', message: `names a signing secret (${named[0].slice(0, 40)})`, fix: 'Only play-credentials.ts reads the service-account key (into memory) and only upload-key.ts knows the keystore path; take what you need from them.' });
  }
}

function checkRelease(ctx) {
  const { contract, contractRel, contractText, report } = ctx;
  for (const entry of placeholdersIn(contract.applicationId ?? '')) report.problem(placeholderProblem({ entry, value: contract.applicationId, where: 'the contract applicationId', file: contractRel, line: lineOfKey(contractText, 'applicationId') }));
  if (contract.uploadCertificateSha256 === null) report.problem({ file: contractRel, line: lineOfKey(contractText, 'uploadCertificateSha256'), rule: 'upload-cert', message: 'uploadCertificateSha256 is null', fix: 'Write the upload key certificate SHA-256 (eas credentials -p android, or Play Console App integrity after the first upload; check-store-aab prints the one it saw). The gate then refuses any other key.' });
}

function notApplicableReason(root, ctx) {
  const rootPackage = ctx.packages.find((item) => item.rel === 'package.json')?.data;
  if (ctx.appDir === '.' && rootPackage?.workspaces !== undefined && !dependsOn(ctx.packages, 'expo')) fail('package.json declares workspaces and no expo dependency: the app lives in a workspace folder', 'Pass --app-dir <the app folder>, for example --app-dir apps/mobile (references/release-pipeline.md, When multi-package).');
  if (!dependsOn(ctx.packages, 'expo')) return 'expo is not a dependency in package.json';
  const platforms = /\bplatforms\s*:\s*\[([^\]]*)\]/.exec(ctx.config?.masked ?? '');
  if (platforms && !/['"]android['"]/.test(platforms[1])) return 'the app config limits platforms and android is not one of them';
  const ships = ctx.contractFile !== null || submitsToPlay(readJson(root, posix.join(ctx.appDir, 'eas.json'))) || ctx.packages.some(({ data }) => data.scripts?.['release:android']);
  return ships || ctx.options.release ? null : 'nothing in the repo ships to Google Play yet: no contracts/android-release.json, no eas.json submit profile with android, no release:android script';
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const appDir = options['app-dir'] ?? '.';
  const report = createReporter({ name: 'check-play-release-setup', json: options.json });
  const layout = resolveLayout(root);
  const contractRel = contractPath(root, layout, options.contract, appDir);
  const packages = readPackages(root, appDir);
  if (packages.length === 0) return report.finish({ checked: 0, unit: 'package.json files' });
  const ctx = { root, appDir, report, options, packages, contractRel, config: appConfigText(root, appDir), contractFile: readContract(root, contractRel) };
  const reason = notApplicableReason(root, ctx);
  if (reason !== null) return report.notApplicable(reason);
  if (ctx.contractFile === null) {
    report.problem({ file: contractRel, rule: 'contract', message: 'there is no release contract', fix: 'Copy templates/contracts/android-release.json (and its schema) and fill it in.' });
    return report.finish({ checked: 1, unit: 'release setup' });
  }
  const contract = ctx.contractFile.data;
  for (const problem of contractProblems(contract, PLAY_FACTS)) report.problem({ file: contractRel, line: lineOfKey(ctx.contractFile.text, problem.path || 'lane'), rule: 'contract', message: `${problem.path} ${problem.message}`.trim(), fix: problem.fix });
  const full = { ...ctx, contract, contractText: ctx.contractFile.text };
  if (typeof contract.applicationId === 'string') checkAppConfig(full);
  if (LANES.includes(contract.lane)) checkLane(full);
  checkSecretFiles(full);
  checkCode(full);
  if (options.release) checkRelease(full);
  return report.finish({ checked: 1, unit: 'release setup' });
});
