#!/usr/bin/env node
// check-release-setup.mjs: checks the repo setup the local iOS release lane (npm run release:ios)
// depends on before it is trusted with the team's App Store Connect key: the release files, the
// ExportOptions files, the contract, one build number in app.config.ts, the team id, no placeholder
// value, the npm scripts the release runs, API-key signing, the key never read or printed outside
// scripts/asc/asc-credentials.ts, no key material in the repo, the .gitignore and agent deny rules,
// no global Xcode switch, and no unfinished-work marker.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-release-setup.mjs .
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, isBinary, lineOf, maskComments, parseArgs, requireDir, resolveLayout, run, UsageError, walk, walkRepo } from './check-lib.mjs';
import { readPlist } from './lib/plist.mjs';
import { contractDefaults, DEFAULT_AD_IDS_FILE, readJsonFile, readReleaseContract } from './lib/release-contract.mjs';
import { bundleIdProblem, placeholderProblem, placeholdersInText } from './lib/ship-placeholders.mjs';

const SPEC = {
  name: 'check-release-setup',
  summary: 'Checks the repo setup the local iOS release lane (npm run release:ios) depends on: release files, ExportOptions, the contract, the build number, the team id, placeholders, npm scripts, API-key signing, key and token hygiene, .gitignore and agent deny rules.',
  usage: '[repo-root] [options]',
  options: { json: { type: 'boolean', help: 'Also print the problems as JSON' } },
  positionals: { min: 0, max: 1 },
  details: [
    'NOT APPLICABLE when the repo has no local lane (no release:ios script and no scripts/release/): EAS Build and',
    'Submit is the default lane (eas-build-and-submit); check-store-artifact still gates every .ipa.',
    'Rules:',
    '  release-files       scripts/release/*.ts and scripts/asc/*.ts of this skill\'s templates, the Xcode pin',
    '                      (scripts/ios/toolchain.ts) and src/config/app-variant.ts exist',
    '  export-options      scripts/release/export-options-{preview,production}.plist: method app-store-connect, destination',
    '                      export, signingStyle automatic, manageAppVersionAndBuildNumber false, uploadSymbols true,',
    '                      testFlightInternalTestingOnly true (preview) / false (production)',
    '  release-contract    contracts/ios-release.json exists, every key is valid, appId is a real bundle id, preflight runs verify',
    '  version-source      <appDir>/app.config.ts has exactly one `const IOS_BUILD_NUMBER = <int>;` line used for',
    '                      ios.buildNumber, no second literal build number, one literal X.Y.Z version, and eas.json does not',
    '                      count build numbers remotely (appVersionSource "remote") next to this lane',
    '  team-id             app.config.ts sets ios.appleTeamId (from APPLE_TEAM_ID): prebuild writes DEVELOPMENT_TEAM from it',
    '  ship-placeholder    no placeholder value (com.example.*, example.com links, template AdMob ids, __TOKENS__) in',
    '                      app.config.ts or the ad ids file (contract adIdsFile, default src/config/admob-ids.ts)',
    '  npm-script          package.json release:ios is exactly "node scripts/release/release-ios.ts"',
    '  release-prereqs     every contract preflight and postPrebuild npm script exists in package.json',
    '  api-key-signing     the archive and export pass -allowProvisioningUpdates and the three -authenticationKey* flags; no',
    '                      .p12 handling or security import anywhere in scripts/',
    '  upload-wait         the upload passes --wait and processing.ts reads processingState (done only at VALID)',
    '  key-read            only scripts/asc/asc-credentials.ts reads AuthKey_*.p8 (fs call, exec arguments or a shell command;',
    '                      the key named by a path variable, AuthKey_/ApiKey_/.p8, ASC_KEY_PATH or API_PRIVATE_KEYS_DIR)',
    '  token-printed       no console output of a token, JWT, private key, Bearer value, Authorization header or request',
    '                      headers in scripts/ (a text heuristic: references/contract-and-checks.md says what it misses)',
    '  key-material        no private key text and no .p8/.p12/.mobileprovision/AuthKey_*/ApiKey_* file in the repo (installed',
    '                      skills, node_modules and generated folders are not scanned)',
    '  wall-clock          scripts/clock/system-clock.ts exports nowEpochSeconds (the token is signed with the current time)',
    '  gitignore-secrets   .gitignore ignores *.p8, AuthKey_*, ApiKey_*, *.p12, *.mobileprovision, *.xcarchive, *.ipa',
    '  claude-deny         .claude/settings.json denies Read of ~/.appstoreconnect/**, **/*.p8, **/AuthKey_*, **/*.p12, **/*.mobileprovision',
    '  no-xcode-select     scripts never run xcode-select --switch/-s or sudo',
    '  unfinished-marker   none of the contract unfinishedMarkers files exists',
  ].join('\n'),
};

const RELEASE_FILES = ['release-ios', 'release-options', 'release-config', 'release-steps', 'release-failures', 'release-preflight', 'release-build', 'release-upload', 'store-gate', 'artifact-facts', 'test-only-sentinels', 'processing', 'processing-wait', 'what-to-test', 'build-number', 'bump-build-number'];
const ASC_FILES = ['asc-jwt', 'asc-credentials', 'asc-client', 'find-app', 'print-app-record', 'beta-notes'];
const EXPORT_BASE = { method: 'app-store-connect', destination: 'export', signingStyle: 'automatic', manageAppVersionAndBuildNumber: false, uploadSymbols: true };
const SIGNING_FLAGS = ['-allowProvisioningUpdates', '-authenticationKeyPath', '-authenticationKeyID', '-authenticationKeyIssuerID'];
const SECRET_LINES = ['*.p8', 'AuthKey_*', 'ApiKey_*', '*.p12', '*.mobileprovision', '*.xcarchive', '*.ipa'];
const DENY_RULES = ['Read(~/.appstoreconnect/**)', 'Read(**/*.p8)', 'Read(**/AuthKey_*)', 'Read(**/*.p12)', 'Read(**/*.mobileprovision)'];
// Built from parts so this checker's own source never contains the text it hunts for.
const PRIVATE_KEY_TEXT = new RegExp(['-----BEGIN ', '(?:EC |RSA |OPENSSH )?', 'PRIVATE KEY-----'].join(''));
const SECRET_FILE = /(^|\/)(AuthKey_[^/]*|ApiKey_[^/]*|[^/]+\.p8|[^/]+\.p12|[^/]+\.mobileprovision)$/;
const BUILD_NUMBER_LINE = /^const IOS_BUILD_NUMBER = (\d+);$/gm;
const VERSION_LITERAL = /(?:\bversion\s*:\s*|\bconst\s+APP_VERSION\s*=\s*)(['"])(\d+\.\d+\.\d+)\1/g;
const TOOLING = ['*.ts', '*.mts', '*.mjs', '*.js', '*.cjs', '*.sh'];

const read = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);

function checkReleaseFiles(ctx) {
  const wanted = [
    ...RELEASE_FILES.map((name) => [posix.join(ctx.scripts, 'release', `${name}.ts`), `templates/scripts/release/${name}.ts`]),
    ...ASC_FILES.map((name) => [posix.join(ctx.scripts, 'asc', `${name}.ts`), `templates/scripts/asc/${name}.ts`]),
    [posix.join(ctx.scripts, 'ios', 'toolchain.ts'), 'templates/scripts/ios/toolchain.ts (canonical, owned by ios-simulator-build)'],
    [posix.join(ctx.layout.configDir, 'app-variant.ts'), 'templates/src/config/app-variant.ts (canonical, owned by app-variants-and-environment)'],
  ];
  for (const [rel, template] of wanted) {
    if (!existsSync(join(ctx.root, rel))) ctx.problem(rel, 0, 'release-files', 'is missing', `Copy this skill's ${template} to ${rel} (with its test when it has one), then rerun.`);
  }
}

function checkExportOptions(ctx) {
  for (const variant of ['preview', 'production']) {
    const rel = posix.join(ctx.scripts, 'release', `export-options-${variant}.plist`);
    if (!existsSync(join(ctx.root, rel))) {
      ctx.problem(rel, 0, 'export-options', 'file is missing', `Copy this skill's templates/scripts/release/export-options-${variant}.plist to ${rel}.`);
      continue;
    }
    const plist = readPlist(join(ctx.root, rel));
    const want = { ...EXPORT_BASE, testFlightInternalTestingOnly: variant === 'preview' };
    for (const [key, value] of Object.entries(want)) {
      if (plist[key] !== value) ctx.problem(rel, 0, 'export-options', `${key} is ${JSON.stringify(plist[key] ?? null)}, expected ${JSON.stringify(value)}`, key === 'testFlightInternalTestingOnly' ? 'Preview builds are internal-only so they can never reach external testers or the App Store; production builds are not.' : 'Use the template values: method app-store is deprecated, destination export keeps altool in charge of the upload, and manageAppVersionAndBuildNumber defaults to YES (Xcode would rewrite the build number).');
    }
  }
}

function checkContract(ctx) {
  const contract = ctx.contractInfo;
  if (!contract.exists) {
    ctx.problem(contract.rel, 0, 'release-contract', 'is missing', "Copy this skill's templates/contracts/ios-release.json (and its schema) and set appId to the production bundle id.");
    return;
  }
  for (const found of contract.problems) ctx.problem(contract.rel, found.line, 'release-contract', found.message, found.fix);
  const id = contract.data.appId;
  const problem = typeof id === 'string' ? bundleIdProblem(id, { platform: 'ios' }) : null;
  if (problem !== null) ctx.problem(contract.rel, 0, 'release-contract', `appId ${problem}`, 'Set appId to the reverse-DNS id registered for the app in App Store Connect; it can never change after the first upload.');
}

function checkVersionSource(ctx, appConfigRel, source) {
  const builds = [...source.matchAll(BUILD_NUMBER_LINE)];
  const fix = 'Keep one line `const IOS_BUILD_NUMBER = <int>;` at the top level of app.config.ts and use it as ios.buildNumber: String(IOS_BUILD_NUMBER); release:ios bumps that line and nothing else (examples/app-config-version.ts).';
  if (builds.length !== 1) ctx.problem(appConfigRel, builds[1] ? lineOf(source, builds[1].index) : 0, 'version-source', `has ${builds.length} "const IOS_BUILD_NUMBER = <int>;" lines, expected exactly 1`, fix);
  else if (Number(builds[0][1]) < 1) ctx.problem(appConfigRel, lineOf(source, builds[0].index), 'version-source', 'IOS_BUILD_NUMBER is below 1', 'Build numbers start at 1 and only go up.');
  else if (source.split('IOS_BUILD_NUMBER').length - 1 < 2) ctx.problem(appConfigRel, lineOf(source, builds[0].index), 'version-source', 'IOS_BUILD_NUMBER is declared but never used, so ios.buildNumber does not come from it', fix);
  const literal = /\bbuildNumber\s*:\s*['"`\d]/.exec(source);
  if (literal) ctx.problem(appConfigRel, lineOf(source, literal.index), 'version-source', 'ios.buildNumber is a literal: a second build number next to IOS_BUILD_NUMBER', fix);
  const versions = [...source.matchAll(VERSION_LITERAL)];
  if (versions.length !== 1) ctx.problem(appConfigRel, 0, 'version-source', `has ${versions.length} literal X.Y.Z versions (version: '...' or const APP_VERSION = '...'), expected exactly 1`, 'The version lives in one place in app.config.ts as MAJOR.MINOR.PATCH (CFBundleShortVersionString and Android versionName).');
  const eas = readJsonFile(ctx.root, 'eas.json');
  if (eas?.cli?.appVersionSource === 'remote') ctx.problem('eas.json', 0, 'version-source', 'cli.appVersionSource is "remote": EAS counts iOS build numbers on its servers while this lane bumps IOS_BUILD_NUMBER, so the two collide (ITMS-90189)', 'One lane per app record: either ship iOS through EAS only (remote versions, eas-build-and-submit) and remove release:ios, scripts/release/ and IOS_BUILD_NUMBER, or keep the local lane only and drop the remote versioning from eas.json (then EAS makes no store builds for this app).');
}

function checkAppConfig(ctx) {
  const rel = posix.join(ctx.appDir, 'app.config.ts');
  const text = read(ctx.root, rel);
  if (text === null) {
    ctx.problem(rel, 0, 'version-source', 'app.config.ts is missing', 'The app config is app.config.ts (expo-project-bootstrap); the release reads and bumps the build number there.');
    return;
  }
  const source = maskComments(text);
  checkVersionSource(ctx, rel, source);
  if (!/\bappleTeamId\b/.test(source)) ctx.problem(rel, 0, 'team-id', 'sets no ios.appleTeamId, so the prebuilt project has no DEVELOPMENT_TEAM and the signed archive fails ("requires a development team")', "Set ios: { appleTeamId: process.env['APPLE_TEAM_ID'], ... } (the team id is not a secret; exporting it once in the shell profile keeps one value for every tool).");
  checkPlaceholders(ctx, rel, source, { skipSampleIds: true });
}

function checkPlaceholders(ctx, rel, source, { skipSampleIds }) {
  for (const found of placeholdersInText(source)) {
    if (found.value === '__DEV__') continue;
    if (skipSampleIds && found.entry.id.startsWith('google-sample')) continue; // testing variants use Google's samples on purpose
    ctx.report.problem(placeholderProblem({ entry: found.entry, value: found.value, where: `${rel} holds a value that`, file: rel, line: lineOf(source, found.index) }));
  }
}

function checkAdIds(ctx) {
  const rel = ctx.contract.adIdsFile ?? DEFAULT_AD_IDS_FILE;
  const text = read(ctx.root, rel);
  if (text === null) {
    if (ctx.contract.adIdsFile) ctx.problem(rel, 0, 'ship-placeholder', 'the contract adIdsFile does not exist', 'Point adIdsFile at the file that holds the app\'s own AdMob ids, or remove the key.');
    return;
  }
  checkPlaceholders(ctx, rel, maskComments(text), { skipSampleIds: false });
}

function checkScriptsAndSigning(ctx) {
  const scripts = ctx.pkg?.scripts ?? {};
  const want = `node ${posix.join(ctx.scripts, 'release', 'release-ios.ts')}`;
  if (scripts['release:ios'] !== want) ctx.problem('package.json', 0, 'npm-script', `scripts["release:ios"] is ${JSON.stringify(scripts['release:ios'] ?? null)}`, `Set it to exactly "${want}".`);
  for (const name of [...new Set([...ctx.contract.preflight, ...ctx.contract.postPrebuild])]) {
    if (typeof scripts[name] !== 'string' || scripts[name].trim() === '') ctx.problem('package.json', 0, 'release-prereqs', `scripts["${name}"] is missing, and release:ios runs it (contracts/ios-release.json ${ctx.contract.preflight.includes(name) ? 'preflight' : 'postPrebuild'})`, 'Set up verify with quality-gates and audit:privacy / audit:network with privacy-and-store-declarations before the first release; never drop a step to get past it.');
  }
  const optionsRel = posix.join(ctx.scripts, 'release', 'release-options.ts');
  const options = read(ctx.root, optionsRel);
  if (options !== null) {
    const missing = SIGNING_FLAGS.filter((flag) => !options.includes(`'${flag}'`));
    if (missing.length > 0) ctx.problem(optionsRel, 0, 'api-key-signing', `the archive/export arguments lack ${missing.join(', ')}`, "Sign only with the team API key (automatic signing, cloud-managed distribution certificate); copy release-options.ts from this skill's templates/scripts/release/.");
    if (!options.includes("'--wait'")) ctx.problem(optionsRel, 0, 'upload-wait', 'the altool upload does not pass --wait', 'Pass --wait (it returns once Apple is PROCESSING), then poll processing until VALID.');
  }
  const processingRel = posix.join(ctx.scripts, 'release', 'processing.ts');
  const processing = read(ctx.root, processingRel);
  if (processing !== null && !processing.includes('processingState')) ctx.problem(processingRel, 0, 'upload-wait', 'nothing reads the build processingState', "An upload is done only at VALID; copy processing.ts and processing-wait.ts from this skill's templates/scripts/release/.");
  const clockRel = posix.join(ctx.scripts, 'clock', 'system-clock.ts');
  if (!/export\s+function\s+nowEpochSeconds\b/.test(read(ctx.root, clockRel) ?? '')) ctx.problem(clockRel, 0, 'wall-clock', 'nowEpochSeconds() is not exported', "Copy this skill's templates/scripts/clock/system-clock.ts (canonical, owned by dependency-management): the token is signed with the current time, and only this file reads the clock.");
}

// A read (fs call, exec argument list, shell command) whose argument names the key file. The fs call
// and the exec list are read to their matching ) or ], so nested calls such as join(homedir(), ...)
// or process.env['HOME'] inside the arguments do not end the span early.
const KEY_NAME = String.raw`(?:ascKeyPath|ascKeyFile|[kK]eyFile|[kK]eyPath|ASC_KEY_PATH|API_PRIVATE_KEYS_DIR|AuthKey_|ApiKey_|\.p8\b)`;
const KEY_NAME_RE = new RegExp(KEY_NAME);
const FS_READ = /\b(?:readFileSync|readFile|createReadStream|copyFileSync|cpSync|copyFile)\s*\(/g;
const EXEC_LIST = /['"](?:cat|cp|mv|base64|openssl|xxd|head|tail|less|pbcopy|security)['"]\s*,\s*\[/g;
const SHELL_READ = new RegExp(String.raw`\b(?:cat|cp|mv|base64|openssl|xxd|head|tail|less|pbcopy)\s[^\n;|&]*?(?:AuthKey_|ApiKey_|ASC_KEY_PATH|API_PRIVATE_KEYS_DIR|\.p8\b|\$\{\s*(?:ascKeyPath|ascKeyFile|[kK]eyFile|[kK]eyPath))`);

/** The text from the opening bracket at `open` to its matching closer (at most 2,000 characters). */
function bracketSpan(source, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  const end = Math.min(source.length, open + 2000);
  for (let i = open; i < end; i += 1) {
    const char = source[i];
    if (pairs[char]) stack.push(pairs[char]);
    else if (char === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open, end);
}

/** The index of the first key read in masked source, or -1. */
function keyReadIndex(source) {
  const hits = [];
  for (const pattern of [FS_READ, EXEC_LIST]) {
    for (const match of source.matchAll(pattern)) {
      if (KEY_NAME_RE.test(bracketSpan(source, match.index + match[0].length - 1))) {
        hits.push(match.index);
        break;
      }
    }
  }
  const shell = SHELL_READ.exec(source);
  if (shell) hits.push(shell.index);
  return hits.length === 0 ? -1 : Math.min(...hits);
}

const TOOLING_BANS = [
  [/\.p12\b|security['"]?\s*,\s*\[?\s*['"]import['"]|security\s+import\b/, 'api-key-signing', 'handles a .p12 or imports a certificate', 'Never export or import signing files; automatic signing with the API key creates what is needed.'],
  [/xcode-select['"]?\s*,?\s*\[?\s*['"]?\s*(?:-s|--switch)\b|xcode-select\s+(?:-s|--switch)\b/, 'no-xcode-select', 'switches the global Xcode with xcode-select', 'Select Xcode per process with DEVELOPER_DIR (selectXcode() in scripts/ios/toolchain.ts).'],
  [/['"`]sudo['"`]|['"`]\s*sudo\s|(?:&&|;|\|)\s*sudo\s|\bexec(?:File)?(?:Sync)?\(\s*['"`]sudo\b/, 'no-xcode-select', 'runs sudo', 'Tooling never needs sudo; the Xcode licence and the keychain are human steps.'],
  [/console\.(?:log|info|warn|error|debug)\([^;]*\b(?:token|jwt|privateKeyPem|authorization|bearer|headers)\b/i, 'token-printed', 'prints a token, JWT, private key, Bearer value or request headers', 'Never log credentials or request headers; error messages carry the API error codes only.'],
];

function checkTooling(ctx) {
  const dir = join(ctx.root, ctx.scripts);
  if (!existsSync(dir)) return;
  const credentials = posix.join(ctx.scripts, 'asc', 'asc-credentials.ts');
  for (const rel of walk(dir, { include: TOOLING })) {
    const full = posix.join(ctx.scripts, rel);
    const source = maskComments(readFileSync(join(dir, rel), 'utf8'));
    for (const [pattern, rule, message, fix] of TOOLING_BANS) {
      const match = pattern.exec(source);
      if (match) ctx.problem(full, lineOf(source, match.index), rule, message, fix);
    }
    const keyRead = keyReadIndex(source);
    if (keyRead >= 0 && full !== credentials) ctx.problem(full, lineOf(source, keyRead), 'key-read', 'reads the App Store Connect key file', `Only ${credentials} reads the key, into memory; other code gets ASC_KEY_ID, ASC_ISSUER_ID and APPLE_TEAM_ID, xcodebuild gets the path, and altool finds the key itself.`);
  }
}

function checkSecrets(ctx) {
  for (const rel of walkRepo(ctx.root)) {
    if (SECRET_FILE.test(rel)) {
      ctx.problem(rel, 0, 'key-material', 'a key or signing file is inside the repo', 'Move it out (keys live in ~/.appstoreconnect/private_keys, mode 600) and, if it was ever committed or shared, ask the developer to revoke the key.');
      continue;
    }
    const buffer = readFileSync(join(ctx.root, rel));
    if (isBinary(buffer)) continue;
    const text = buffer.toString('utf8');
    const match = PRIVATE_KEY_TEXT.exec(text);
    if (match) ctx.problem(rel, lineOf(text, match.index), 'key-material', 'contains private key text', 'Delete it (and from history if committed) and ask the developer to revoke and replace the key.');
  }
  const lines = new Set((read(ctx.root, '.gitignore') ?? '').split('\n').map((line) => line.trim()));
  for (const entry of SECRET_LINES) {
    if (!lines.has(entry)) ctx.problem('.gitignore', 0, 'gitignore-secrets', `does not ignore ${entry}`, `Add the line ${entry} (the canonical .gitignore has it).`);
  }
  let deny = [];
  try {
    deny = JSON.parse(read(ctx.root, '.claude/settings.json') ?? '{}').permissions?.deny ?? [];
  } catch {
    deny = [];
  }
  for (const rule of DENY_RULES) {
    if (!deny.includes(rule)) ctx.problem('.claude/settings.json', 0, 'claude-deny', `permissions.deny lacks ${rule}`, 'Merge the deny rule into .claude/settings.json (the developer approves the edit; other agents: the same read denials in their own permission file). It is defence in depth: never opening the key is the real guard.');
  }
}

function checkMarkers(ctx) {
  for (const marker of ctx.contract.unfinishedMarkers) {
    if (existsSync(join(ctx.root, marker))) ctx.problem(marker, 0, 'unfinished-marker', 'marks unfinished work (contracts/ios-release.json unfinishedMarkers)', 'Finish the work it lists and delete the marker before a release; testers and users would open a stand-in.');
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: 'check-release-setup', json: options.json });
  const pkg = readJsonFile(root, 'package.json');
  if (pkg === null) throw new UsageError('nothing to check: no package.json in the repo root', 'Run it from the app repo root (or pass the root).');
  const layout = resolveLayout(root);
  const hasLane = typeof pkg.scripts?.['release:ios'] === 'string' || existsSync(join(root, layout.scriptsDir, 'release'));
  if (!hasLane) return report.notApplicable(`the repo has no local iOS release lane (no release:ios script, no ${layout.scriptsDir}/release/): EAS Build and Submit is the default lane (eas-build-and-submit); check-store-artifact still gates every .ipa`);
  const contractInfo = readReleaseContract(root, layout);
  const contract = contractDefaults(contractInfo.data);
  const ctx = { root, layout, pkg, report, contractInfo, contract, scripts: layout.scriptsDir, appDir: contract.appDir, problem: (file, line, rule, message, fix) => report.problem({ file, line, rule, message, fix }) };
  checkReleaseFiles(ctx);
  checkExportOptions(ctx);
  checkContract(ctx);
  checkAppConfig(ctx);
  checkAdIds(ctx);
  checkScriptsAndSigning(ctx);
  checkTooling(ctx);
  checkSecrets(ctx);
  checkMarkers(ctx);
  return report.finish({ checked: 1, unit: 'repo' });
});
