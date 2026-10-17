#!/usr/bin/env node
// check-eas-config.mjs: checks an Expo app's EAS Build and Submit setup offline, before anything is
// queued or uploaded: eas.json against EAS CLI's own schema, the CLI floor, remote versions, the
// store and internal profiles, the Node of every build, the app config's version fields, the submit
// profiles and their credentials, every eas build / eas submit command and the gate in front of it,
// the release preflight, and the fingerprint inputs. With --release it is a ship gate (no SKIP): the
// submit ids must be real. Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-eas-config.mjs .
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import { createReporter, matchGlob, maskComments, parseArgs, requireDir, run } from './check-lib.mjs';
import { lineOfPath, readEasJson, resolveBuildProfile, resolveSubmitProfile, schemaProblems } from './lib/eas-json.mjs';
import { appConfigFacts, compareVersions, easCommands, findAppConfig, nodePin, readPackage } from './lib/repo-facts.mjs';
import { PLACEHOLDER_RULE, placeholdersIn } from './lib/ship-placeholders.mjs';

const FACTS = JSON.parse(readFileSync(new URL('../assets/eas-facts.json', import.meta.url), 'utf8'));

const SPEC = {
  name: 'check-eas-config',
  summary: 'Checks the EAS Build and Submit setup of an Expo app offline: eas.json against the EAS CLI schema, the CLI floor, remote versions, store and internal profiles, the Node of every build, the app config version fields, submit profiles and credentials, eas build/submit commands and their gates, the release preflight and the fingerprint inputs.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: "The app folder (app.config.ts, eas.json, package.json) relative to the repo root (default '.'; when multi-package, e.g. apps/mobile)" },
    eas: { type: 'string', value: 'file', help: 'The EAS config, relative to the app folder (default: eas.json)' },
    preflight: { type: 'string', value: 'file', help: 'The release preflight, relative to the app folder (default: rn-skills.config.json "easPreflight", else scripts/eas/release-preflight.ts)' },
    release: { type: 'boolean', help: 'Ship-gate mode before a store build or submit: also fails placeholder submit ids and a missing ascAppId; never skips' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  eas-json            eas.json exists when the app uses EAS (extra.eas.projectId or an eas build/submit command)',
    '  eas-schema          every key, type, enum and pattern EAS CLI 24.10.0 checks (@expo/eas-json 24.9.0), extends chains',
    `  cli-version         cli.version is a floor ">= x.y.z" no older than ${FACTS.minCliFloor} (the CLI these rules were verified on)`,
    '  version-source      cli.appVersionSource is "remote": EAS keeps one build-number counter per app id',
    '  require-commit      cli.requireCommit is true: a build is exactly a commit (no uncommitted files uploaded)',
    '  store-profile       a "production" build profile exists; every store profile has autoIncrement true on both',
    '                      platforms, builds an AAB, no simulator, no dev client, and signs (no withoutCredentials)',
    '  internal-profile    internal-distribution profiles never build an Android app bundle (an AAB cannot be installed from a link)',
    '  build-node          every build profile pins node (exact x.y.z) equal to .nvmrc/.node-version (a partial pin such as 26',
    '                      is a prefix; an alias such as lts/* is no pin), else within package.json',
    '                      engines.node (and, without a pin file, a Node whose npm meets engines.npm); or an',
    '                      eas-build-pre-install script upgrades npm (EAS SDK 57 images ship npm 10.9)', // stack-pin-ignore
    '  config-versions     the app config has a literal x.y.z version and, with remote versions, no ios.buildNumber or',
    '                      android.versionCode (EAS ignores them)',
    '  submit-profile      submit.production pins ios.bundleIdentifier (and ios.ascAppId as digits) and android.applicationId; ids',
    '                      are the production id (no .dev/.preview); android stays on a testing track (internal, alpha, beta)',
    '                      with releaseStatus completed or draft',
    '  submit-credentials  no Apple ID login (appleId) and no literal key path in the repo: EAS-managed keys, or $VARIABLES',
    '  eas-commands        every eas build/submit names --profile (an EAS Workflows job: params.profile); no eas submit',
    '                      --latest; --auto-submit (-s, --submit) only from a store profile and only for --platform ios',
    '                      (Android submits the .aab its store-artifact gate read); every eas build without --local passes',
    '                      --freeze-credentials; EAS CLI is the global eas, never npx eas-cli; in CI --platform always',
    '                      (build jobs: params.platform) and --non-interactive on eas submit',
    '  gates-first         an outward eas build (--auto-submit, or a store build without --local) runs after npm run verify',
    '                      or the release preflight, and an eas submit after the record check check-eas-build.mjs, in the',
    '                      same script or workflow; comments, step names and quoted text are never commands or gates;',
    '                      an EAS Workflows type: build / type: submit job is gated by a job it needs (transitively)',
    '  release-preflight   the gates-first preflight (scripts/eas/release-preflight.ts) exists while eas.json has a store profile',
    '  fingerprint-config  .fingerprintignore and fingerprint.config.js never hide native inputs (package.json, the lockfile,',
    '                      the app config, plugins/, patches/, node_modules) and never skip the whole Expo config',
    '  ship-placeholder    (--release) no submit id is a template placeholder (com.example.*, __NAME__)',
    'Images (ios.image, android.image) are expo-sdk-upgrade\'s rule (check-sdk-alignment); the variant env of each profile',
    'and secrets in eas.json are app-variants-and-environment\'s (check-variants, check-env).',
    'NOT APPLICABLE when package.json has no expo dependency, or when there is no eas.json and nothing uses EAS',
    '(the app builds with the local lane: ios-release-testflight, android-release-play); never with --release.',
    'Internal-only EAS (no store-distribution profile, and a release:ios or release:android script ships the store builds',
    'on the local lane): version-source, store-profile, config-versions, submit-profile and release-preflight are the local',
    "lane's (its version-source rule refuses remote versions), so they are not judged and a note says so; --release fails.",
    'rn-skills.config.json key: "easPreflight" (repo-relative path of the release preflight).',
  ].join('\n'),
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const TESTING_TRACKS = ['internal', 'alpha', 'beta'];
const VARIANT_SUFFIX = /\.(dev|development|preview|staging)$/;

function createContext(root, options) {
  const report = createReporter({ name: 'check-eas-config', json: options.json });
  const appRel = posix.normalize(options['app-dir'] ?? '.');
  const rel = (name) => posix.join(appRel, name);
  const pkg = readPackage(root, rel('package.json'));
  const configRel = findAppConfig(root, appRel);
  const configText = configRel ? readFileSync(join(root, configRel), 'utf8') : null;
  const easRel = rel(options.eas ?? 'eas.json');
  const projectConfig = existsSync(join(root, 'rn-skills.config.json')) ? JSON.parse(readFileSync(join(root, 'rn-skills.config.json'), 'utf8')) : {};
  return {
    root, options, report, appRel, rel, pkg, configRel, easRel,
    config: configText !== null ? appConfigFacts(configText, configRel) : null,
    eas: readEasJson(join(root, easRel), easRel),
    commands: easCommands(root, appRel, pkg),
    preflightRel: options.preflight ? rel(options.preflight) : (projectConfig.easPreflight ?? rel('scripts/eas/release-preflight.ts')),
    problem(file, line, rule, message, fix) {
      report.problem({ file, line, rule, message, fix });
    },
  };
}

const hasExpo = (pkg) => Boolean(pkg?.dependencies?.expo ?? pkg?.devDependencies?.expo);

function lineIn(ctx, keys) {
  return lineOfPath(ctx.eas.text, keys);
}

function profileNames(ctx) {
  return Object.keys(isObject(ctx.eas.data.build) ? ctx.eas.data.build : {});
}

const VARIANTS = ['development', 'preview', 'production'];

/**
 * Resolved build profiles per platform; a profile whose chain is broken is reported once by
 * eas-schema. A shared base (others extend it, and its name is no variant) is never built itself, so
 * the per-profile rules judge only the profiles built from it.
 */
function resolvedProfiles(ctx) {
  const build = ctx.eas.data.build ?? {};
  const parents = new Set(Object.values(build).map((profile) => (isObject(profile) ? profile.extends : undefined)).filter((name) => typeof name === 'string'));
  const out = [];
  for (const name of profileNames(ctx).filter((item) => !(parents.has(item) && !VARIANTS.includes(item)))) {
    const ios = resolveBuildProfile(ctx.eas.data, name, 'ios');
    const android = resolveBuildProfile(ctx.eas.data, name, 'android');
    if (ios.error) continue;
    out.push({ name, ios: ios.profile, android: android.profile });
  }
  return out;
}

/** A store profile is judged by its distribution alone, so a store profile that also sets ios.simulator still fails. */
const isStore = (entry) => entry.ios.distribution === 'store';

function checkSchema(ctx) {
  for (const found of schemaProblems(ctx.eas.data)) {
    const where = found.path.map((key) => `"${key}"`).join('.');
    ctx.problem(ctx.easRel, lineIn(ctx, found.path), 'eas-schema', `${where} ${found.message} (EAS CLI stops with "eas.json is not valid.")`, 'Fix the key or value to what the eas.json reference allows (references/eas-json.md has the table).');
  }
  for (const name of profileNames(ctx)) {
    const chain = resolveBuildProfile(ctx.eas.data, name, 'ios');
    if (chain.error) ctx.problem(ctx.easRel, lineIn(ctx, ['build', name]), 'eas-schema', chain.error, 'Point "extends" at an existing profile, at most 5 deep and without a cycle.');
  }
  for (const name of Object.keys(isObject(ctx.eas.data.submit) ? ctx.eas.data.submit : {})) {
    const chain = resolveSubmitProfile(ctx.eas.data, name);
    if (chain.error) ctx.problem(ctx.easRel, lineIn(ctx, ['submit', name]), 'eas-schema', chain.error, 'Point "extends" at an existing submit profile without a cycle.');
  }
}

/**
 * The local-lane script that ships the store builds while EAS builds only internal ones, or null. Such
 * an app keeps the local lane's one build-number counter (ios-release-testflight's and
 * android-release-play's version-source rule refuses remote versions next to it).
 */
function localStoreLane(ctx, profiles) {
  if (profiles.some(isStore)) return null;
  return Object.keys(ctx.pkg?.scripts ?? {}).find((name) => /^release:(?:ios|android)$/.test(name)) ?? null;
}

function checkCli(ctx, lane) {
  const cli = isObject(ctx.eas.data.cli) ? ctx.eas.data.cli : {};
  const line = lineIn(ctx, ['cli']);
  const floor = /^>=\s*(\d+\.\d+\.\d+)$/.exec(typeof cli.version === 'string' ? cli.version.trim() : '');
  if (!floor) {
    ctx.problem(ctx.easRel, line, 'cli-version', `cli.version is ${JSON.stringify(cli.version ?? null)}, not a floor ">= x.y.z": every machine and CI may run an EAS CLI that reads this file differently`, `Set "cli": { "version": ">= ${FACTS.easCli}" }.`);
  } else if (compareVersions(floor[1], FACTS.minCliFloor) < 0) {
    ctx.problem(ctx.easRel, lineIn(ctx, ['cli', 'version']), 'cli-version', `cli.version allows EAS CLI ${floor[1]}, older than ${FACTS.minCliFloor}, the version this setup (environment, remote versions, requireCommit) was verified on`, `Raise it to ">= ${FACTS.minCliFloor}" and install that CLI globally (npm install -g --min-release-age=7 --ignore-scripts eas-cli@${FACTS.easCli}).`);
  }
  if (cli.appVersionSource !== 'remote' && lane === null) {
    ctx.problem(ctx.easRel, line, 'version-source', `cli.appVersionSource is ${JSON.stringify(cli.appVersionSource ?? null)}: with "local" (the unset default) every build must commit its own number bump, and two machines can upload the same build number`, 'Set "appVersionSource": "remote", then run eas build:version:set once per platform with the last number the stores have (references/versions-and-fingerprints.md).');
  }
  if (cli.requireCommit !== true) {
    ctx.problem(ctx.easRel, line, 'require-commit', 'cli.requireCommit is not true: EAS CLI then copies uncommitted and untracked files into the build, so the build is not the commit it reports', 'Set "requireCommit": true and build from a clean, committed tree.');
  }
}

function checkStoreProfiles(ctx, profiles) {
  if (!profiles.some((entry) => entry.name === 'production')) {
    ctx.problem(ctx.easRel, lineIn(ctx, ['build']), 'store-profile', 'eas.json has no "production" build profile: eas build and eas submit default to it', 'Add build.production (templates/eas.json): distribution store, autoIncrement true, environment production.');
  }
  for (const entry of profiles.filter(isStore)) {
    const fail = (message, fix) => ctx.problem(ctx.easRel, lineIn(ctx, ['build', entry.name]), 'store-profile', `build.${entry.name} (store distribution): ${message}`, fix);
    for (const platform of ['ios', 'android']) {
      if (entry[platform].autoIncrement !== true) fail(`autoIncrement on ${platform} is ${JSON.stringify(entry[platform].autoIncrement ?? false)}, so a store build can reuse a build number the store refuses`, 'Set "autoIncrement": true on the profile (with remote versions EAS bumps its own counter; "version" is not supported there).');
    }
    if (entry.android.buildType === 'apk') fail('android.buildType is "apk": Google Play takes new apps only as app bundles', 'Set android.buildType to "app-bundle" (or remove it).');
    if (entry.ios.developmentClient === true) fail('developmentClient is true: a dev client is a debug build and never goes to a store', 'Remove developmentClient here; only the development profile builds the dev client.');
    if (entry.ios.withoutCredentials === true) fail('withoutCredentials is true: an unsigned build cannot be submitted', 'Remove withoutCredentials; EAS-managed credentials sign store builds.');
    if (entry.ios.simulator === true) fail('ios.simulator is true: a simulator .app cannot be submitted to App Store Connect', 'Remove ios.simulator here; simulator builds get their own internal profile (development-simulator, preview-simulator).');
  }
}

function checkInternalProfiles(ctx, profiles) {
  for (const entry of profiles.filter((item) => item.android.distribution === 'internal')) {
    if (entry.android.buildType === 'app-bundle') {
      ctx.problem(ctx.easRel, lineIn(ctx, ['build', entry.name]), 'internal-profile', `build.${entry.name} is internal distribution but builds an Android app bundle: testers cannot install an AAB from the build link`, 'Remove android.buildType (internal builds default to apk) or set it to "apk".');
    }
  }
}

function enginesFloor(pkg, tool = 'node') {
  const match = /(?:^|\s)>=?\s*v?(\d+(?:\.\d+){0,2})/.exec(String(pkg?.engines?.[tool] ?? ''));
  return match ? match[1] : null;
}

/** A full pin must equal the profile's node; a partial one (26, 26.4) is a prefix of it. */
function pinMatches(node, pin) {
  const version = node.replace(/^[v=]/, '');
  return /^\d+\.\d+\.\d+$/.test(pin) ? version === pin : version.startsWith(`${pin}.`);
}

function checkNode(ctx, profiles) {
  const preInstall = String(ctx.pkg?.scripts?.['eas-build-pre-install'] ?? '');
  if (/\bnpm\s+(?:i|install)\s+(?:-g|--global)\s+npm@\d/.test(preInstall)) return;
  const found = nodePin(ctx.root, ctx.appRel);
  // An alias (lts/*, node, lts/iron) names no version, so the engines comparison decides instead.
  const pin = found && /^\d+(?:\.\d+){0,2}$/.test(found.version) ? found : null;
  const floor = enginesFloor(ctx.pkg);
  const npmFloor = enginesFloor(ctx.pkg, 'npm');
  for (const entry of profiles) {
    const node = entry.ios.node ?? entry.android.node;
    const line = lineIn(ctx, ['build', entry.name]);
    const fail = (message, fix) => ctx.problem(ctx.easRel, line, 'build-node', `build.${entry.name}: ${message}`, fix);
    if (typeof node !== 'string') {
      fail(`pins no node, so EAS uses the image's Node ${FACTS.imageNode} with npm ${FACTS.imageNpm}, which the engines field and the .npmrc policy refuse (npm ci stops with EBADENGINE)`, `Set "node": "${pin?.version ?? FACTS.projectNode}" in the profile (or in the shared base it extends).`);
    } else if (pin && !pinMatches(node, pin.version)) {
      const full = /^\d+\.\d+\.\d+$/.test(pin.version);
      fail(`node is ${node} but ${pin.rel} pins ${pin.version}: EAS would build with another Node than every developer and CI`, full ? `Set "node": "${pin.version}".` : `Set "node" to a full x.y.z within ${pin.version} (EAS refuses a partial version), and pin the same full version in ${pin.rel}.`);
    } else if (!pin && floor && compareVersions(node, floor) < 0) {
      fail(`node ${node} is below package.json engines.node (${ctx.pkg.engines.node})`, `Set "node" to the project's Node (for example ${FACTS.projectNode}).`);
    } else if (!pin && npmFloor && compareVersions(npmFloor, FACTS.projectNpm) >= 0 && compareVersions(node, FACTS.projectNode) < 0) {
      fail(`node ${node} bundles an npm below package.json engines.npm (${ctx.pkg.engines.npm}): Node ${FACTS.projectNode} is the first to bundle npm ${FACTS.projectNpm}, so npm ci stops with EBADENGINE`, `Set "node": "${FACTS.projectNode}" and add .nvmrc with the same version (expo-project-bootstrap), or upgrade npm in an eas-build-pre-install script.`);
    }
  }
}

function checkConfigVersions(ctx, lane) {
  if (ctx.config === null) {
    ctx.problem(ctx.rel('app.config.ts'), 0, 'config-versions', 'no app config (app.config.ts or app.json) next to eas.json', 'Run the check from the repo root, or pass --app-dir <the folder that holds app.config.ts>.');
    return;
  }
  const { version, versionLine, versionExpression } = ctx.config;
  if (version === null || !/^\d+\.\d+\.\d+$/.test(version)) {
    const what = version !== null ? `"${version}"` : versionExpression ? `the expression ${versionExpression}` : 'missing';
    ctx.problem(ctx.configRel, versionLine, 'config-versions', `version is ${what}: the stores need MAJOR.MINOR.PATCH, and the release checks read it from the file`, "Write version: '1.2.0' as a literal in the app config, raised before each store release.");
  }
  if (lane !== null || ctx.eas.data.cli?.appVersionSource !== 'remote') return;
  for (const [key, line] of [['ios.buildNumber', ctx.config.buildNumberLine], ['android.versionCode', ctx.config.versionCodeLine]]) {
    if (line > 0) ctx.problem(ctx.configRel, line, 'config-versions', `${key} is set, but with remote versions EAS ignores it and uses its own counter: the number in the file is never the build's`, `Delete ${key}; read the real number with eas build:version:get.`);
  }
}

function submitBlock(ctx) {
  const resolved = resolveSubmitProfile(ctx.eas.data, 'production');
  return resolved.error ? null : resolved.profile;
}

function checkSubmitIds(ctx, submit, line) {
  const fail = (message, fix) => ctx.problem(ctx.easRel, line, 'submit-profile', `submit.production: ${message}`, fix);
  const ios = isObject(submit.ios) ? submit.ios : {};
  const android = isObject(submit.android) ? submit.android : {};
  if (typeof ios.bundleIdentifier !== 'string') fail('ios pins no bundleIdentifier: a standalone eas submit evaluates the app config without the profile env, so it looks up the development id and the App Store Connect API key stored for it', 'Set ios.bundleIdentifier to the production id (and ios.ascAppId to the Apple ID number of the app record).');
  if (typeof ios.ascAppId === 'string' && !/^\d+$/.test(ios.ascAppId) && !/^__[A-Z_]+__$/.test(ios.ascAppId)) fail(`ios.ascAppId "${ios.ascAppId}" is not the numeric Apple ID of the app record`, 'Copy the Apple ID (digits) from App Store Connect > App Information.');
  if (typeof android.applicationId !== 'string') fail('android pins no applicationId: the submission would look up the id of whatever variant the shell exported', 'Set android.applicationId to the production package name.');
  const production = ctx.config?.appId ?? null;
  for (const [key, id] of [['ios.bundleIdentifier', ios.bundleIdentifier], ['android.applicationId', android.applicationId]]) {
    if (typeof id !== 'string' || /^__[A-Z_]+__$/.test(id)) continue;
    if (VARIANT_SUFFIX.test(id)) fail(`${key} "${id}" is a testing variant's id, not the store app`, 'Use the production id (the one without .dev or .preview).');
    else if (production && !/^__[A-Z_]+__$/.test(production) && id !== production) fail(`${key} "${id}" differs from the production id "${production}" in ${ctx.configRel}`, `Set ${key} to "${production}".`);
  }
  return android;
}

function checkSubmit(ctx) {
  const submit = submitBlock(ctx);
  const line = lineIn(ctx, ['submit', 'production']);
  if (submit === null) {
    ctx.problem(ctx.easRel, lineIn(ctx, ['submit']), 'submit-profile', 'eas.json has no submit.production profile: --auto-submit and eas submit fall back to prompts and to the config evaluated without a variant', 'Add submit.production with ios.ascAppId, ios.bundleIdentifier and android.applicationId (templates/eas.json).');
    return null;
  }
  const android = checkSubmitIds(ctx, submit, line);
  const track = android.track ?? 'internal';
  if (!TESTING_TRACKS.includes(track)) ctx.problem(ctx.easRel, lineIn(ctx, ['submit', 'production', 'android', 'track']), 'submit-profile', `submit.production android track is "${track}": a submission must reach testers first, never the public`, 'Use "internal"; promote to production in Play Console after testing (android-release-play owns rollouts).');
  const status = android.releaseStatus ?? 'completed';
  if (!['completed', 'draft'].includes(status)) ctx.problem(ctx.easRel, lineIn(ctx, ['submit', 'production', 'android', 'releaseStatus']), 'submit-profile', `submit.production android releaseStatus is "${status}": staged rollouts and halts are store-console decisions, not a build step`, 'Use "completed" (or "draft" while the Play app is still a draft).');
  return submit;
}

function checkSubmitCredentials(ctx) {
  for (const name of Object.keys(isObject(ctx.eas.data.submit) ? ctx.eas.data.submit : {})) {
    const profile = ctx.eas.data.submit[name] ?? {};
    const fail = (keys, message, fix) => ctx.problem(ctx.easRel, lineIn(ctx, ['submit', name, ...keys]), 'submit-credentials', `submit.${name}: ${message}`, fix);
    if (profile.ios?.appleId !== undefined) fail(['ios', 'appleId'], 'ios.appleId logs in with an Apple ID: interactive two-factor prompts, and a personal account in the release path', 'Remove appleId; set up an App Store Connect API key for EAS Submit with eas credentials (the developer does this once).');
    for (const [platform, key] of [['ios', 'ascApiKeyPath'], ['android', 'serviceAccountKeyPath']]) {
      const value = profile[platform]?.[key];
      if (typeof value === 'string' && !value.trim().startsWith('$')) fail([platform, key], `${platform}.${key} "${value}" is a key file path: the key then lives on disk next to the repo, one git add away from a leak`, `Remove ${key} (EAS uses the key stored with eas credentials), or write it as an environment variable such as "$${platform === 'ios' ? 'ASC_API_KEY_PATH' : 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH'}" that CI fills from a secret file.`);
    }
  }
}

const GLOBAL_CLI = `npm install -g --min-release-age=7 --ignore-scripts eas-cli@${FACTS.easCli}`;

function checkCommands(ctx, profiles) {
  const store = new Set(profiles.filter(isStore).map((entry) => entry.name));
  for (const command of ctx.commands) {
    const fail = (rule, message, fix) => ctx.problem(command.file, command.line, rule, `${command.script ? `script "${command.script}": ` : ''}eas ${command.sub} ${command.args}: ${message}`.replace(/\s+:/, ':'), fix);
    const { profile, autoSubmit, autoSubmitProfile, latest, nonInteractive, local, freezeCredentials } = command.flags;
    const job = command.job !== null;
    if (command.viaNpx) fail('eas-commands', 'runs EAS CLI through npx: the version floats past the cli.version floor and the release-age policy, and inside the app npx stops with ESTRICTALLOWSCRIPTS (dependency-management\'s npx-install rule)', `Install EAS CLI globally with the policy flags (${GLOBAL_CLI}) and call eas.`);
    if (profile === null) {
      if (job) fail('eas-commands', `names no params.profile, so the ${command.sub} job uses EAS's default "production"`, 'Name it in the job: params: { profile: production } (or development, preview).');
      else fail('eas-commands', 'names no --profile, so EAS silently uses "production"', 'Name the profile: --profile production (or development, preview).');
    }
    if (command.sub === 'submit' && latest) fail('eas-commands', '--latest submits whatever build finished last (another branch, a preview build)', 'Submit the file the store-artifact gate read: eas submit --path <gated .ipa or .aab> after check-eas-build passed on its record (references/build-and-submit-runbook.md).');
    if (command.sub === 'build' && autoSubmit && profile !== null && !store.has(profile)) fail('eas-commands', `--auto-submit from "${profile}", which is not a store profile`, 'Auto-submit only from production (distribution store).');
    if (command.sub === 'build' && autoSubmit && ['android', 'all'].includes(command.flags.platform)) fail('eas-commands', `--auto-submit with --platform ${command.flags.platform}: the Android bundle reaches Play before its store-artifact gate read it`, 'Build Android without --auto-submit, gate the downloaded .aab (android-release-play), then eas submit --platform android --path <that file>; keep --auto-submit, if at all, for --platform ios.');
    if (command.sub === 'build' && !job && !local && !freezeCredentials) fail('eas-commands', 'builds without --freeze-credentials: a non-interactive build may then regenerate a certificate or provisioning profile that other apps share', 'Add --freeze-credentials (templates/scripts/eas/eas-commands.ts always does); credentials changes are the developer\'s, with eas credentials.');
    if (command.ci && command.sub === 'submit' && !nonInteractive) fail('eas-commands', 'runs in CI without --non-interactive: eas submit stays interactive even with CI set (only eas build switches), so a prompt stops the job', 'Add --non-interactive.');
    if (command.ci && command.flags.platform === null && (!job || command.sub === 'build')) {
      if (job) fail('eas-commands', 'has no params.platform, which a build job requires', 'Add params: { platform: ios } (one build job per platform).');
      else fail('eas-commands', 'runs in CI without --platform, which EAS CLI requires in non-interactive mode', 'Add --platform ios, android or all.');
    }
    const outward = command.sub === 'submit' || autoSubmit || autoSubmitProfile !== null || (command.sub === 'build' && !local && (profile === null || store.has(profile)));
    if (!outward || command.before) continue;
    if (command.sub === 'submit') {
      if (job) fail('gates-first', 'submits a build whose record no check ran: no job it needs runs check-eas-build.mjs', 'Add a job between the build and the submit that saves eas build:view <build_id> --json and runs check-eas-build.mjs on it (and the store-artifact gate on the downloaded artifact), and make the submit job need it (needs, not after).');
      else fail('gates-first', 'submits a build whose record no check proved (npm run verify proves the code, not what EAS built)', 'Run node <eas-build-and-submit>/scripts/check-eas-build.mjs . --build <record> --platform <p> first in the same script or workflow, as a command, then the store-artifact gate, then eas submit --path <gated file>.');
      continue;
    }
    if (job) fail('gates-first', 'leaves the machine before any gate ran: no job it needs runs a gate', 'Add needs: [<a job whose steps run npm run verify or node scripts/eas/release-preflight.ts>] (needs, not after: after runs even when the gate failed).');
    else fail('gates-first', 'leaves the machine before any gate ran', 'Run npm run verify (or node scripts/eas/release-preflight.ts) first in the same script or workflow, as a command (a comment does not count): npm run verify && eas ...');
  }
}

function checkPreflight(ctx, profiles) {
  if (!profiles.some(isStore)) return;
  if (!existsSync(join(ctx.root, ctx.preflightRel))) {
    ctx.problem(ctx.preflightRel, 0, 'release-preflight', 'the gates-first release preflight is missing: nothing stops a store build from a dirty tree, a red verify or an unraised version', 'Copy templates/scripts/eas/ (release-preflight.ts, release-plan.ts, eas-profile.ts, eas-commands.ts and their tests).');
  }
}

const NATIVE_INPUTS = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'app.config.ts', 'app.config.js', 'app.json', 'plugins/with-app.ts', 'patches/react-native+0.86.3.patch', 'node_modules/expo/package.json'];

function checkFingerprint(ctx) {
  const ignoreRel = ctx.rel('.fingerprintignore');
  if (existsSync(join(ctx.root, ignoreRel))) {
    readFileSync(join(ctx.root, ignoreRel), 'utf8').split('\n').forEach((raw, index) => {
      const glob = raw.trim();
      if (glob === '' || glob.startsWith('#') || glob.startsWith('!')) return;
      const hidden = NATIVE_INPUTS.find((path) => matchGlob(path, glob.replace(/^\//, '')));
      if (hidden) ctx.problem(ignoreRel, index + 1, 'fingerprint-config', `"${glob}" hides ${hidden} from the fingerprint: a native change there would not change it, so a build would be skipped or an update shipped to binaries without the code`, 'Delete the line; ignore only generated or machine-specific files (ios/ and android/ are already ignored under CNG).');
    });
  }
  const configRel = ctx.rel('fingerprint.config.js');
  if (!existsSync(join(ctx.root, configRel))) return;
  const code = maskComments(readFileSync(join(ctx.root, configRel), 'utf8'));
  const index = code.search(/\bExpoConfigAll\b|\b256\b/);
  if (index >= 0) ctx.problem(configRel, code.slice(0, index).split('\n').length, 'fingerprint-config', 'sourceSkips skips the whole Expo config: a new config plugin, permission, icon or id no longer changes the fingerprint', 'Skip only the parts that change without native effect (ExpoConfigVersions, ExpoConfigRuntimeVersionIfString), never ExpoConfigAll.');
}

function checkPlaceholders(ctx, submit) {
  if (!ctx.options.release || submit === null) return;
  const ios = submit.ios ?? {};
  if (typeof ios.ascAppId !== 'string') ctx.problem(ctx.easRel, lineIn(ctx, ['submit', 'production']), 'submit-profile', 'submit.production pins no ios.ascAppId: a release submit must name the app record, not search for it', 'Copy the Apple ID (digits) of the app record from App Store Connect > App Information.');
  const values = [['ios', 'ascAppId'], ['ios', 'bundleIdentifier'], ['android', 'applicationId']];
  for (const [platform, key] of values) {
    const value = submit[platform]?.[key];
    if (typeof value !== 'string') continue;
    for (const entry of placeholdersIn(value)) {
      ctx.problem(ctx.easRel, lineIn(ctx, ['submit', 'production', platform, key]), PLACEHOLDER_RULE, `submit.production.${platform}.${key} is ${entry.name}: "${value}"`, entry.fix);
    }
  }
}

function usesEas(ctx) {
  return ctx.config?.projectId === true || ctx.commands.length > 0;
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  requireDir(root, 'repo root');
  const ctx = createContext(root, options);
  if (ctx.pkg === null) return ctx.report.finish({ checked: 0, unit: 'files' });
  if (!hasExpo(ctx.pkg)) {
    if (!options.release) return ctx.report.notApplicable(`${ctx.rel('package.json')} has no expo dependency`);
    ctx.problem(ctx.rel('package.json'), 0, 'eas-json', `${ctx.rel('package.json')} has no expo dependency: --release is the EAS ship gate of an Expo app and never passes as not applicable`, 'Run it from the repo root of the Expo app, or pass --app-dir <the folder whose package.json depends on expo>.');
    return ctx.report.finish({ checked: 1, unit: 'files' });
  }
  if (ctx.eas === null) {
    if (!usesEas(ctx) && !options.release) return ctx.report.notApplicable(`no ${ctx.easRel} and nothing uses EAS (no extra.eas.projectId, no eas build or eas submit command): the app builds with the local lane`);
    if (usesEas(ctx)) ctx.problem(ctx.easRel, 0, 'eas-json', `${ctx.easRel} is missing although the app uses EAS (${ctx.config?.projectId ? 'extra.eas.projectId' : 'an eas build or eas submit command'})`, 'Copy templates/eas.json and fill __ASC_APP_ID__ and __APP_ID__.');
    else ctx.problem(ctx.easRel, 0, 'eas-json', `${ctx.easRel} is missing: --release is the EAS ship gate, and nothing in this app uses EAS`, 'A local-lane app releases with ios-release-testflight and android-release-play (drop --release here); for EAS, copy templates/eas.json and fill __ASC_APP_ID__ and __APP_ID__.');
    return ctx.report.finish({ checked: 1, unit: 'files' });
  }
  checkSchema(ctx);
  const profiles = resolvedProfiles(ctx);
  const lane = localStoreLane(ctx, profiles);
  checkCli(ctx, lane);
  if (lane === null) checkStoreProfiles(ctx, profiles);
  else if (options.release) ctx.problem(ctx.easRel, lineIn(ctx, ['build']), 'store-profile', `eas.json has no store-distribution profile: the store builds ship on the local lane (script "${lane}"), so there is nothing for the EAS ship gate to pass`, `Release with the local lane's gate (ios-release-testflight, android-release-play) and drop --release here, or add build.production (templates/eas.json) and move the store builds to EAS.`);
  else ctx.report.note(`internal-only EAS: no store profile, and script "${lane}" ships the store builds on the local lane, whose checkers own version-source, store-profile, config-versions, submit-profile and release-preflight`);
  checkInternalProfiles(ctx, profiles);
  checkNode(ctx, profiles);
  checkConfigVersions(ctx, lane);
  const submit = lane === null ? checkSubmit(ctx) : null;
  checkSubmitCredentials(ctx);
  checkCommands(ctx, profiles);
  checkPreflight(ctx, profiles);
  checkFingerprint(ctx);
  checkPlaceholders(ctx, submit);
  return ctx.report.finish({ checked: 2 + ctx.commands.length, unit: 'files and commands' });
}

await run(main);
