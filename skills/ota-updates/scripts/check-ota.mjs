#!/usr/bin/env node
// check-ota.mjs: checks an Expo app's over-the-air updates offline: the app config of every
// shipping variant (evaluated, not parsed), the fingerprint config, the channel each eas.json build
// profile bakes into its binaries, the UpdatesPort adapter, and every eas update / update:* /
// channel:* command in package.json scripts, shell scripts, CI workflows and Node scripts.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-ota.mjs .
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError, createReporter, maskComments, parseArgs, readProjectConfig, requireDir, resolveLayout, run } from './check-lib.mjs';
import { findAppConfig, keyLine, loadVariantConfigs } from './lib/app-config.mjs';
import { buildTargets, readEasJson, storeChannels } from './lib/eas-profiles.mjs';
import { checkAdapter, checkFingerprintConfig } from './lib/ota-code-rules.mjs';
import { isLiteral, updateCommands } from './lib/update-commands.mjs';

/** A channel or environment given as $VAR or ${{ expr }}: present, but its value is known only at run time. */
const isVariable = (value) => typeof value === 'string' && value !== '' && !isLiteral(value);

const FACTS = JSON.parse(readFileSync(new URL('../assets/ota-facts.json', import.meta.url), 'utf8'));

const SPEC = {
  name: 'check-ota',
  summary: 'Checks over-the-air updates offline: runtime version from the fingerprint, the update URL, launch and recovery settings, the fingerprint config, one channel per shipping variant, the UpdatesPort adapter, and every eas update command (target, environment, staged rollout, gates first, no cross-channel republish, no automated rollback).',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: "The app folder (app config, eas.json, package.json) relative to the repo root (default '.'; when multi-package, e.g. apps/mobile)" },
    variants: { type: 'string', value: 'list', help: 'Comma-separated APP_VARIANT values to evaluate (default: development,preview,production)' },
    'dev-variant': { type: 'string', value: 'name', help: 'The variant that ships no update channel (default: development)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (references/checker-rules.md has each one with its fix):',
    '  updates-config          expo-updates is a dependency and every OTA variant sets updates.url; or updates.enabled is false',
    '  updates-off-publish     an eas update command while updates are off or expo-updates is not installed',
    "  runtime-policy          runtimeVersion is { policy: 'fingerprint' }, with no platform override that differs",
    '  updates-url             updates.url is https://u.expo.dev/<extra.eas.projectId>',
    '  launch-nonblocking      fallbackToCacheTimeout 0 (or unset), useEmbeddedUpdate not false',
    '  error-recovery          checkAutomatically ON_LOAD (or unset); no disableAntiBrickingMeasures or useNativeDebug',
    '  fingerprint-scripts     fingerprint.config.js loads, keeps install/build lifecycle scripts and drops the rest',
    '  build-channel           every build profile but the dev client builds an evaluated variant (env.APP_VARIANT, else its EAS',
    '                          environment) and bakes channel = variant = environment; every OTA variant has a build profile',
    '  updates-adapter         an adapter (<services>/<concern>/*-adapter.ts) imports expo-updates, and no other source file does',
    '  adapter-enabled-guard   an adapter that checks, fetches or reloads reads Updates.isEnabled first and maps ERR_NOT_AVAILABLE_IN_DEV_CLIENT to disabled',
    '  emergency-launch        the adapter reads Updates.isEmergencyLaunch (a broken update gets reported)',
    '  update-target           eas update names --channel (or --branch) and --message; never --auto',
    '  update-environment      eas update names --environment, equal to the channel (the same expression when it is one); EAS Workflows update jobs too',
    '                          (a literal --branch named like a channel counts as that channel here and in staged-rollout)',
    `  staged-rollout          an update to a store channel starts with --rollout-percentage 1-${FACTS.maxFirstRolloutPercent}; an expression channel needs one too`,
    '  gates-first             eas update runs after npm run verify or scripts/ota/update-preflight.ts in the same file',
    '  cross-channel-republish no eas update:republish --destination-channel / --destination-branch',
    '  rollback-manual         no rollback, rollout revert or channel pause/rollout/edit command in a CI workflow',
    '  update-preflight        scripts/ota/update-preflight.ts exists once eas.json exists',
    'NOT APPLICABLE when package.json has no expo dependency, when expo-updates is not installed and nothing',
    'configures or publishes updates, or when updates.enabled is false in every shipping variant and nothing publishes.',
    'SKIP eas.json [build-channel] when eas.json does not exist yet (eas-build-and-submit creates it) and the app',
    'config sets no expo-channel-name request header.',
    'rn-skills.config.json key: "otaPreflight" (repo-relative path of the update preflight).',
  ].join('\n'),
};

const lineOfKey = (text, key) => {
  const index = text.indexOf(`"${key}"`);
  return index < 0 ? 1 : text.slice(0, index).split('\n').length;
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const UPDATE_URL = new RegExp(`^${FACTS.updateHost.replaceAll('.', '\\.')}/([0-9a-f-]{36})$`);
/** Why each checkAutomatically value other than ON_LOAD is refused (docs, "Error recovery"). */
const CHECK_REASONS = {
  NEVER: 'error recovery stops asking the server for a fix, so a broken update stays until the person reinstalls',
  ON_ERROR_RECOVERY: 'launches ask the server only after a crash at launch, so a fix for a bug that does not crash at launch arrives only through the JS checks',
  WIFI_ONLY: 'launches on cellular never ask the server, so a fix waits until the phone is on Wi-Fi',
};
const ROLLBACK_SUBS = new Set(['update:rollback', 'update:roll-back-to-embedded', 'update:revert-update-rollout', 'channel:pause', 'channel:rollout', 'channel:edit']);

function createContext(root, options) {
  const appRel = posix.normalize(options['app-dir'] ?? '.');
  const rel = (name) => posix.join(appRel, name);
  const pkgPath = join(root, rel('package.json'));
  if (!existsSync(pkgPath)) throw new UsageError(`nothing to check: no ${rel('package.json')}`, 'Run from the app repo root (or pass --app-dir).');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const layout = resolveLayout(root);
  const variants = (options.variants ?? 'development,preview,production').split(',').map((name) => name.trim()).filter(Boolean);
  const devVariant = options['dev-variant'] ?? 'development';
  return {
    root, appRel, rel, pkg, layout, variants, devVariant,
    report: createReporter({ name: 'check-ota', json: options.json }),
    config: readProjectConfig(root) ?? {},
  };
}

function problemOnce(ctx, seen, entry) {
  const key = `${entry.rule}|${entry.file}|${entry.message}`;
  if (seen.has(key)) return;
  seen.add(key);
  ctx.report.problem(entry);
}

function checkRuntimePolicy(ctx, configRel, text, seen, { variant, config }) {
  const at = (key) => ({ file: configRel, line: keyLine(text, key) });
  const policy = config.runtimeVersion;
  if (!isObject(policy) || policy.policy !== 'fingerprint' || Object.keys(policy).length !== 1) {
    problemOnce(ctx, seen, { ...at('runtimeVersion'), rule: 'runtime-policy', message: `runtimeVersion is ${JSON.stringify(policy ?? null)} in ${variant}: a hand-set string or an app-version policy lets an update reach a binary that lacks its native code`, fix: "Spread updatesConfig(EAS_PROJECT_ID) from src/config/updates-config.ts: runtimeVersion { policy: 'fingerprint' }." });
  }
  for (const platform of ['ios', 'android']) {
    const override = config[platform]?.runtimeVersion;
    if (override !== undefined && JSON.stringify(override) !== JSON.stringify(policy)) {
      problemOnce(ctx, seen, { ...at('runtimeVersion'), rule: 'runtime-policy', message: `${platform}.runtimeVersion overrides the app's runtime version in ${variant}`, fix: `Delete ${platform}.runtimeVersion: one fingerprint policy for both platforms.` });
    }
  }
}

function checkUrl(ctx, configRel, text, seen, { variant, config }) {
  const url = config.updates.url;
  const projectId = config.extra?.eas?.projectId;
  const match = UPDATE_URL.exec(String(url));
  if (!match) {
    problemOnce(ctx, seen, { file: configRel, line: keyLine(text, 'url'), rule: 'updates-url', message: `updates.url ${JSON.stringify(url)} is not ${FACTS.updateHost}/<project id> (${variant})`, fix: 'Build it with easUpdateUrl(EAS_PROJECT_ID) from src/config/updates-config.ts.' });
  } else if (match[1] !== projectId) {
    problemOnce(ctx, seen, { file: configRel, line: keyLine(text, 'url'), rule: 'updates-url', message: `updates.url names project ${match[1]} but extra.eas.projectId is ${JSON.stringify(projectId ?? null)} (${variant}): builds would ask another project for updates`, fix: 'Use one EAS_PROJECT_ID constant for extra.eas.projectId and updatesConfig().' });
  }
}

function checkLaunchAndRecovery(ctx, configRel, text, seen, { variant, config }) {
  const updates = config.updates;
  const add = (rule, key, message, fix) => problemOnce(ctx, seen, { file: configRel, line: keyLine(text, key), rule, message: `${message} (${variant})`, fix });
  if ((updates.fallbackToCacheTimeout ?? 0) !== 0) add('launch-nonblocking', 'fallbackToCacheTimeout', `updates.fallbackToCacheTimeout is ${updates.fallbackToCacheTimeout}: every cold start waits on the network, up to that long, on a slow connection`, 'Set it to 0: a download applies at the next cold start.');
  if (updates.useEmbeddedUpdate === false) add('launch-nonblocking', 'useEmbeddedUpdate', 'updates.useEmbeddedUpdate is false: the first launch needs the network and offline installs never start', 'Delete useEmbeddedUpdate (the default true).');
  const check = updates.checkAutomatically ?? 'ON_LOAD';
  if (check !== 'ON_LOAD') add('error-recovery', 'checkAutomatically', `updates.checkAutomatically is ${check}: ${CHECK_REASONS[check] ?? 'not a value expo-updates knows (ON_LOAD, ON_ERROR_RECOVERY, WIFI_ONLY, NEVER)'}`, "Set it to 'ON_LOAD' (the default).");
  if (updates.disableAntiBrickingMeasures === true) add('error-recovery', 'disableAntiBrickingMeasures', 'updates.disableAntiBrickingMeasures is true: a runtime URL or header override can leave the app unable to reach any update', 'Delete it; never ship it.');
  if (updates.useNativeDebug === true) add('error-recovery', 'useNativeDebug', 'updates.useNativeDebug is committed: debug builds stop loading JS from the dev server', 'Delete it; set it only locally while debugging the updater.');
}

function checkConfigs(ctx, state) {
  const { configRel, text, otaVariants, configs } = state;
  const seen = new Set();
  for (const variant of otaVariants) {
    const config = configs.get(variant);
    if (typeof config.updates?.url !== 'string') {
      problemOnce(ctx, seen, { file: configRel, line: keyLine(text, 'updates'), rule: 'updates-config', message: `expo-updates is installed and updates are on in ${variant}, but updates.url is not set: Updates.isEnabled is false and no update ever arrives`, fix: 'Spread updatesConfig(EAS_PROJECT_ID) into the config, or set updates: { enabled: false } until OTA is wanted.' });
      continue;
    }
    checkRuntimePolicy(ctx, configRel, text, seen, { variant, config });
    checkUrl(ctx, configRel, text, seen, { variant, config });
    checkLaunchAndRecovery(ctx, configRel, text, seen, { variant, config });
  }
}

function checkChannels(ctx, { eas, otaVariants, configs, configRel, text }) {
  if (!eas) {
    const headers = otaVariants.map((variant) => configs.get(variant).updates?.requestHeaders?.['expo-channel-name']);
    if (headers.every((value) => value === undefined)) {
      ctx.report.skip({ file: ctx.rel('eas.json'), rule: 'build-channel', message: 'not yet created (eas-build-and-submit creates it)' });
      return [];
    }
    otaVariants.forEach((variant, index) => {
      if (headers[index] !== variant) ctx.report.problem({ file: configRel, line: keyLine(text, 'expo-channel-name'), rule: 'build-channel', message: `the ${variant} build asks channel ${JSON.stringify(headers[index] ?? null)}`, fix: `Set updates.requestHeaders['expo-channel-name'] to '${variant}' in that variant.` });
    });
    return [];
  }
  const targets = buildTargets(eas).filter((target) => !target.abstract);
  const owners = new Map();
  const built = new Set();
  const SOURCE = { APP_VARIANT: 'APP_VARIANT', environment: 'environment', default: "EAS Build's default environment" };
  for (const target of targets) {
    if (target.devClient) continue;
    const at = { file: eas.rel, line: target.line, rule: 'build-channel' };
    const builds = `build profile ${target.profile} (${SOURCE[target.variantSource]} ${target.variant})`;
    if (!ctx.variants.includes(target.variant)) {
      ctx.report.problem({ ...at, message: `${builds} builds a variant that is not one of ${ctx.variants.join(', ')}: no evaluated config matches its binaries`, fix: `Set "environment" (and env.APP_VARIANT) to one of ${ctx.variants.join(', ')}, or pass --variants with the app's variant names.` });
      continue;
    }
    if (!otaVariants.includes(target.variant)) continue;
    built.add(target.variant);
    if (target.channel !== target.variant) {
      const what = target.channel === null ? 'bakes no channel into its binaries: they will never receive an update' : `bakes channel ${JSON.stringify(target.channel)} into its binaries: its updates go elsewhere or nowhere`;
      ctx.report.problem({ ...at, message: `${builds} ${what}`, fix: `Set "channel": "${target.variant}" and "environment": "${target.variant}" on the profile; the channel is fixed in the binary at build time.` });
    } else if (target.environment !== target.channel) {
      ctx.report.problem({ ...at, message: `build profile ${target.profile} builds channel ${target.channel} with environment ${target.environment}${target.variantSource === 'default' ? " (EAS Build's default for its distribution)" : ''}: an eas update for the channel evaluates another config and runtime`, fix: `Set "environment": "${target.channel}".` });
    }
    const owner = owners.get(target.channel);
    if (target.channel !== null && owner && owner !== target.variant) ctx.report.problem({ ...at, message: `channel ${target.channel} is baked into ${owner} and ${target.variant} builds`, fix: 'One channel per variant: each update embeds one variant\'s config.' });
    if (target.channel !== null) owners.set(target.channel, target.variant);
  }
  for (const variant of otaVariants) {
    if (built.has(variant)) continue;
    ctx.report.problem({ file: eas.rel, line: lineOfKey(eas.text, 'build'), rule: 'build-channel', message: `no build profile builds the ${variant} variant, so no binary carries channel ${variant} and its updates reach no phone`, fix: `Add a build profile with "channel": "${variant}" and "environment": "${variant}", or leave ${variant} out of --variants.` });
  }
  return targets;
}

/**
 * The channel an update reaches: --channel, or a literal --branch that is a channel's name (each
 * channel is linked to the branch of the same name until someone relinks it, so --branch production
 * reaches the production phones). An expression --branch (pr-${{ ... }} previews) is not a channel.
 */
function targetOf(flags, channels) {
  if (flags.present.has('--channel')) return { channel: flags['--channel'], label: `channel ${flags['--channel']}` };
  const branch = flags['--branch'];
  if (isLiteral(branch) && channels.has(branch)) return { channel: branch, label: `branch ${branch} (linked to channel ${branch})` };
  return { channel: undefined, label: '' };
}

function checkCommand(ctx, command, { stores, channels }) {
  const { flags } = command;
  const at = { file: command.file, line: command.line };
  const { channel, label } = targetOf(flags, channels);
  if (flags.present.has('--auto') || (!flags.present.has('--channel') && !flags.present.has('--branch'))) {
    ctx.report.problem({ ...at, rule: 'update-target', message: 'eas update without --channel (or --branch): --auto publishes to a branch named after the git branch', fix: 'Name the target: eas update --channel <variant> --environment <variant> --message "<text>".' });
  }
  if (!command.job && !isLiteral(flags['--message']) && !flags.present.has('--message')) {
    ctx.report.problem({ ...at, rule: 'update-target', message: 'eas update without --message', fix: 'Add --message "<what the update fixes>": it is the audit trail of every rollback decision.' });
  }
  const environment = flags['--environment'];
  if (!flags.present.has('--environment') || environment === '') {
    ctx.report.problem({ ...at, rule: 'update-environment', message: command.job ? 'EAS Workflows update job without environment: it defaults to production' : 'eas update without --environment: the config evaluates without the channel\'s variables, so the runtime and extra differ from its builds', fix: 'Add the environment named like the channel (--environment production / environment: production).' });
  } else if (isLiteral(channel) && isLiteral(environment) && channel !== environment) {
    ctx.report.problem({ ...at, rule: 'update-environment', message: `${label} published with environment ${environment}: its runtime version and embedded config are another variant's`, fix: `Use --environment ${channel}.` });
  } else if (isVariable(channel) && environment !== channel) {
    ctx.report.problem({ ...at, rule: 'update-environment', message: `channel ${channel} published with environment ${environment}: when the channel is an expression the environment must be the same expression, or one choice publishes with another variant's config`, fix: 'Name the channel literally per job (--channel production --environment production), or pass the identical expression to both flags.' });
  }
  if (isVariable(channel) && stores.size > 0 && !flags.present.has('--rollout-percentage')) {
    ctx.report.problem({ ...at, rule: 'staged-rollout', message: `eas update --channel ${channel} with no --rollout-percentage: the expression can name store channel ${[...stores].join(', ')}, which then gets the update on every phone at once`, fix: 'Name the channel literally per job: a preview job without a rollout and a production job with --rollout-percentage 10 (examples/ota-update-workflow.yml).' });
  }
  if (isLiteral(channel) && stores.has(channel)) {
    const rollout = Number(flags['--rollout-percentage']);
    if (!flags.present.has('--rollout-percentage') || !(rollout >= 1 && rollout <= FACTS.maxFirstRolloutPercent)) {
      ctx.report.problem({ ...at, rule: 'staged-rollout', message: `an update to store channel ${channel}${flags.present.has('--channel') ? '' : ` through branch ${channel}`} without a first rollout step of 1-${FACTS.maxFirstRolloutPercent}%: a broken update reaches every phone at its next launch`, fix: `Add --rollout-percentage 10, watch eas update:insights, then raise it with eas update:edit.` });
    }
  }
  if (!command.gated && command.job) {
    ctx.report.problem({ ...at, rule: 'gates-first', message: 'EAS Workflows update job that needs no gate job: nothing proves the code or that a build with this runtime exists', fix: 'Add needs: on a job that runs npm run verify or node scripts/ota/update-preflight.ts, or follow Expo\'s pattern: needs a type: fingerprint job and a type: get-build job, with if: reading the get-build job\'s outputs.build_id (references/channels-branches-and-publishing.md section 9).' });
  } else if (!command.gated) {
    ctx.report.problem({ ...at, rule: 'gates-first', message: 'eas update runs without npm run verify or the update preflight before it in this file', fix: 'Run node scripts/ota/update-preflight.ts (or npm run verify) first in the same script or job.' });
  }
}

function checkCommands(ctx, commands, targetSets) {
  for (const command of commands) {
    const at = { file: command.file, line: command.line };
    if (command.sub === 'update') checkCommand(ctx, command, targetSets);
    if (command.sub === 'update:republish' && (command.flags.present.has('--destination-channel') || command.flags.present.has('--destination-branch'))) {
      ctx.report.problem({ ...at, rule: 'cross-channel-republish', message: 'eas update:republish to another channel or branch: the bundle carries the source variant\'s config and runtime', fix: 'Publish the same commit to each channel with its own environment (the update preflight).' });
    }
    if (command.ci && ROLLBACK_SUBS.has(command.sub)) {
      ctx.report.problem({ ...at, rule: 'rollback-manual', message: `eas ${command.sub} in a CI workflow: rolling back or pausing a channel is a person's decision`, fix: 'Run it by hand after reading references/rollouts-rollbacks-and-incidents.md (a migration may forbid it).' });
    }
  }
}

async function main(argv) {
  const { options, positionals } = parseArgs(argv, SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const ctx = createContext(root, options);
  const deps = { ...ctx.pkg.dependencies, ...ctx.pkg.devDependencies };
  if (!('expo' in deps)) return ctx.report.notApplicable('package.json has no expo dependency');
  const configRel = findAppConfig(root, ctx.appRel);
  if (!configRel) throw new UsageError('nothing to check: no app config (app.config.ts or app.json)', 'Run from the app root (or pass --app-dir).');
  const text = maskComments(readFileSync(join(root, configRel), 'utf8'));
  const configs = await loadVariantConfigs(root, configRel, ctx.variants);
  const shipping = ctx.variants.filter((variant) => variant !== ctx.devVariant);
  const otaVariants = shipping.filter((variant) => configs.get(variant).updates?.enabled !== false);
  const commands = updateCommands(root, { appRel: ctx.appRel, scriptsDir: ctx.layout.scriptsDir, pkg: ctx.pkg });
  const publishes = commands.filter((command) => command.sub === 'update');
  const installed = 'expo-updates' in (ctx.pkg.dependencies ?? {});
  const inDevOnly = !installed && 'expo-updates' in (ctx.pkg.devDependencies ?? {});
  const wantsOta = otaVariants.some((variant) => typeof configs.get(variant).updates?.url === 'string');
  if ((!installed && !inDevOnly) || otaVariants.length === 0) {
    const reason = otaVariants.length === 0 ? 'updates.enabled is false in every shipping variant' : 'expo-updates is not installed';
    for (const command of publishes) ctx.report.problem({ file: command.file, line: command.line, rule: 'updates-off-publish', message: `eas update runs, but ${reason}: no binary can load it`, fix: 'Delete the command, or turn OTA on (references/channels-branches-and-publishing.md).' });
    if (!installed && !inDevOnly && wantsOta) ctx.report.problem({ file: configRel, line: keyLine(text, 'updates'), rule: 'updates-config', message: 'updates.url is set but expo-updates is not a dependency: the setting does nothing', fix: 'npx expo install expo-updates, or delete the updates config.' });
    if (publishes.length === 0 && !wantsOta) return ctx.report.notApplicable(otaVariants.length === 0 ? `${reason} of ${configRel}` : 'expo-updates is not in package.json dependencies');
    return ctx.report.finish({ checked: commands.length + 1, unit: 'commands and configs' });
  }
  if (!wantsOta) {
    ctx.report.problem({ file: configRel, line: keyLine(text, 'updates'), rule: 'updates-config', message: `expo-updates is installed and updates are on in ${otaVariants.join(', ')}, but no variant sets updates.url: Updates.isEnabled is false and no update ever arrives`, fix: 'Decide: spread updatesConfig(EAS_PROJECT_ID) into the config (this skill), or set updates: { enabled: false } until OTA is wanted.' });
    return ctx.report.finish({ checked: otaVariants.length, unit: 'variants' });
  }
  if (inDevOnly) ctx.report.problem({ file: ctx.rel('package.json'), line: 1, rule: 'updates-config', message: 'expo-updates is a devDependency: EAS Build ignores channels and the native module may be left out', fix: 'Move expo-updates to dependencies (npx expo install expo-updates).' });
  const eas = readEasJson(root, ctx.rel('eas.json'));
  checkConfigs(ctx, { configRel, text, otaVariants, configs });
  checkFingerprintConfig(ctx);
  const targets = checkChannels(ctx, { eas, otaVariants, configs, configRel, text });
  checkAdapter(ctx);
  const stores = eas ? storeChannels(targets) : new Set(shipping.filter((variant) => variant === 'production'));
  const channels = new Set([...otaVariants, ...targets.map((target) => target.channel).filter(Boolean)]);
  checkCommands(ctx, commands, { stores, channels });
  const preflight = ctx.config.otaPreflight ?? posix.join(ctx.layout.scriptsDir, 'ota', 'update-preflight.ts');
  if (eas && !existsSync(join(root, ctx.appRel, preflight))) {
    ctx.report.problem({ file: posix.join(ctx.appRel, preflight), line: 0, rule: 'update-preflight', message: 'no update preflight: nothing proves a runtime version is live on its channel before an update goes out', fix: 'Copy templates/scripts/ota/update-preflight.ts and update-plan.ts (with its test).' });
  }
  return ctx.report.finish({ checked: otaVariants.length + targets.length + commands.length, unit: 'variants, profiles and commands' });
}

run(() => main(process.argv.slice(2)));
