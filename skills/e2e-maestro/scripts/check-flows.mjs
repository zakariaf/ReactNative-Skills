#!/usr/bin/env node
// check-flows.mjs: checks every Maestro flow of an Expo app without a device: where flows, sub-flows,
// the screenshot matrix and hand-run flows live, their names, headers and tags, id-only selectors that
// exist in the app's testID contracts (and that Maestro can reach), debug-link queries against the
// link's contract, launch with cleared state, quarantine rules, no AI or upload commands, no env
// blocks shadowing the runner's -e variables, and Maestro command lines that name their device.
// With --syntax it also runs Maestro's own check-syntax on each file.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-flows.mjs [repo-root] [--syntax] [--today YYYY-MM-DD]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, notYetCreated, parseArgs, requireDir, run, walk } from './check-lib.mjs';
import { BASE_TAGS, contractRel, debugLinks, e2eApps, isAdopted, knownTestIds, lookupTestId, manualFolders, patternMatchesKnown, readContract } from './lib/e2e-repo.mjs';
import { commandOf, parseFlow } from './lib/maestro-yaml.mjs';
import { checkHeader, checkQuarantine, checkRunCommands, checkSelectors, checkOpenAlertGuard, checkAiCommands, checkPlatformGuard, hasIdStep, runFlowTargets, visitMaps } from './lib/flow-rules.mjs';

const SPEC = {
  name: 'check-flows',
  summary: 'Checks the Maestro flows, sub-flows, the screenshot matrix and hand-run flows of the app against the e2e-maestro rules (no device needed).',
  usage: '[repo-root] [options]',
  options: {
    today: { type: 'string', value: 'YYYY-MM-DD', help: 'The day quarantine ages are measured from (default: today)' },
    syntax: { type: 'boolean', help: "Also run Maestro's check-syntax on every file (about 3 s per file; needs the pinned install)" },
    maestro: { type: 'string', value: 'path', help: 'The Maestro binary for --syntax, relative to the repo root (default: contracts/e2e.json maestroBin, else tools/maestro/bin/maestro)' },
    'e2e-dir': { type: 'string', value: 'dir', help: 'The flows folder (default: rn-skills.config.json e2eDir, else .maestro)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Files (in each app\'s e2e folder, .maestro by default): flows/<area>/<nn>-<name>.yaml (what the runner runs),',
    'subflows/<name>.yaml (only through runFlow), screenshots/*.yaml (the matrix), config.yaml, and the folders of',
    'hand-run flows declared in contracts/e2e.json manualFolders or contracts/naming.json extraE2eFolders.',
    'Facts: contracts/e2e.json (extraTestIDs, manualFolders, tags), contracts/screens.json (testIDs, parent, a11yHidden,',
    'component parts), contracts/debug-links.json (the debug link\'s parameters, debug-menu-and-test-hooks).',
    '',
    'Rules:',
    '  e2e-contract         contracts/e2e.json is missing or invalid (productionAppIds, network, manualFolders)',
    '  flow-location        a YAML file outside flows/<area>/, subflows/, screenshots/ or a declared manual folder',
    '                       (Maestro would never run it, or would run a sub-flow on its own)',
    '  flow-name            a flow not named <nn>-<kebab-name>.yaml, or an area folder that is not kebab-case',
    '  flow-parse           not a flow Maestro can read (no --- document, no list of steps)',
    '  flow-header          appId is not ${APP_ID}, or a flow lacks name: or tags:',
    '  flow-tags            an unknown tag; a flow in flows/a11y/ without a11y (or a11y elsewhere: the runner runs',
    '                       flows/a11y/ only); a manual flow without its folder\'s tag; the matrix without screenshots',
    '  env-shadows-cli      an env: block sets APP_ID, APP_SCHEME, LANG or THEME (Maestro 2.10: env: beats -e)',
    '  ai-command           assertWithAI, assertNoDefectsWithAI or extractTextWithAI (uploads screenshots)',
    '  text-selector        a selector by visible text, not id (OS-owned UI only, under a "# system-ui: <why>" comment)',
    '  retry-app-assertion  retry: around app steps (OS-owned UI only, under a "# system-ui: <why>" comment)',
    '  open-alert-guard     a guard or tap on any "Open" text: Maestro\'s text match ignores case, so it also matches',
    '                       an in-app OPEN button; guard on iOS\'s alert title \'Open in .*\\?\' and tap below it, optional',
    '  first-step-launch    a flow or the matrix does not start with launchApp and clearState: true',
    '  raw-open-link        openLink outside subflows/: state is set through subflows/debug-setup.yaml',
    '  debug-query          a debug-setup QUERY with a parameter or value contracts/debug-links.json does not list',
    '  debug-open           a debug-setup QUERY that opens no screen (no open=) while the link has an open parameter:',
    '                       waiting for the screen the flow started on passes with a lost link',
    '  debug-lang-alone     a debug-setup QUERY sets lang= together with other parameters while that language can flip',
    '                       the layout direction (a right-to-left locale, or ${...} when contracts/e2e.json largeText or',
    '                       screenshots lists one): the app restarts and nothing after lang= runs; send it through',
    '                       subflows/set-language.yaml first',
    '  large-text-lang      a flow of flows/a11y/ never sets the language (no set-language.yaml, no ${LANG}) while',
    '                       contracts/e2e.json largeText lists locales: every per-locale pass runs in the device language',
    '  testid-format        an id that is not <scope>.<element> in kebab segments, or an id pattern that does not compile',
    '  unknown-testid       an id (or a pattern, or an id a sub-flow builds from passed values) that no contract lists',
    '  unreachable-testid   an id the contract marks crop-only (a part inside an accessible element, or hidden from',
    '                       screen readers): Maestro never lists it; select its accessible element instead',
    '  no-testid-step       a flow without a single id: step proves nothing about the app',
    '  runflow-missing      runFlow points at a file that does not exist',
    '  subflow-in-flows     a file under flows/ is used as a sub-flow (it also runs on its own and fails)',
    '  smoke-quarantine     a smoke flow is quarantined (a failing smoke flow blocks the release)',
    '  quarantine-note      quarantined without "# quarantine YYYY-MM-DD: <reason>", or for more than 7 days',
    '  manual-folder        a flow of a startsOutside folder calls launchApp (it grants every permission, so the',
    '                       system prompt under test never shows), or its first setup link lacks a requiredParams entry',
    '  platform-guard       an Android-only step (back, pressKey: back, setAirplaneMode, toggleAirplaneMode) outside a',
    '                       runFlow guarded by when: { platform: Android }, or guarded by another platform: iOS skips',
    '                       it silently, so the flow passes there without the step',
    '  run-command-device   a Maestro command line in a comment does not name --device and --driver-host-port first',
    '  maestro-syntax       (--syntax) maestro check-syntax rejects the file',
    '  flows-missing        E2E is set up (contracts/e2e.json or an e2e script) but no flow exists',
    'SKIP lines: unknown-testid/unreachable-testid until contracts/screens.json exists (screen-contracts creates',
    'it); debug-query until contracts/debug-links.json exists (debug-menu-and-test-hooks creates it).',
    'NOT APPLICABLE: no app has an e2e folder, contracts/e2e.json or an e2e npm script yet.',
  ].join('\n'),
};

const CLI_VARS = new Set(['APP_ID', 'APP_SCHEME', 'LANG', 'THEME']);
const TESTID = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;
const FLOW_NAME = /^\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.ya?ml$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Maestro matches id: as a regular expression; an id with these characters is a pattern. */
const PATTERN_CHARS = /[()|*+?\\[\]^$]/;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const DEBUG_SETUP = /(^|\/)debug-setup\.ya?ml$/;
/** Languages written right to left (the language subtag of a locale). */
const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'ks', 'ps', 'sd', 'ug', 'ur', 'yi']);
const isRtlLocale = (locale) => RTL_LANGUAGES.has(String(locale).toLowerCase().split(/[-_]/)[0]);

/** Where a file of the e2e folder belongs. */
function classify(local, manual) {
  const parts = local.split('/');
  if (parts.length === 1) return /^config\.ya?ml$/.test(parts[0]) ? { kind: 'config' } : { kind: 'misplaced' };
  if (parts[0] === 'flows' && parts.length === 3) return { kind: 'flow', area: parts[1], name: parts[2] };
  if (parts[0] === 'subflows' && parts.length === 2) return { kind: 'subflow' };
  if (parts[0] === 'screenshots' && parts.length === 2) return { kind: 'screenshots' };
  if (manual.has(parts[0]) && parts.length === 2) return { kind: 'manual', folder: parts[0], name: parts[1], ...manual.get(parts[0]) };
  return { kind: 'misplaced' };
}

/** A value with every ${NAME} replaced from env, or null when a name is unknown here. */
function substitute(value, env) {
  if (value === null || value === undefined || typeof value === 'object') return null;
  let isComplete = true;
  const text = String(value).replace(VARIABLE, (whole, name) => {
    if (Object.hasOwn(env, name)) return env[name];
    isComplete = false;
    return whole;
  });
  return isComplete ? text : null;
}

function queryPairs(query) {
  return String(query).split('&').filter((pair) => pair.trim() !== '' && !pair.includes('${')).map((pair) => {
    const at = pair.indexOf('=');
    return at === -1 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)];
  });
}

/** lang= with other parameters, when that language can flip the layout direction (the app restarts). */
function checkLangAlone(ctx, line, query) {
  const pairs = String(query).split('&').filter((pair) => pair.trim() !== '');
  const lang = pairs.find((pair) => pair.startsWith('lang='));
  if (lang === undefined || pairs.length === 1) return;
  const value = lang.slice('lang='.length);
  const isFlip = value.includes('${') ? ctx.hasRtlLocale : isRtlLocale(value);
  if (isFlip) ctx.report.problem({ file: ctx.rel, line, rule: 'debug-lang-alone', message: `the debug link sets ${lang} together with ${pairs.length - 1} other parameter(s): a language that flips the layout direction restarts the app and nothing after lang= runs`, fix: 'Set the language first with runFlow: ../subflows/set-language.yaml (alone, as the launch link: it returns on the debug menu once the restart is over), then send the other parameters with open=<screen> through debug-setup.yaml.' });
}

function checkQuery(ctx, line, query) {
  const problem = (rule, message, fix) => ctx.report.problem({ file: ctx.rel, line, rule, message, fix });
  checkLangAlone(ctx, line, query);
  if (ctx.links.params === null) return;
  const seen = new Set();
  for (const [name, value] of queryPairs(query)) {
    const spec = ctx.links.params[name];
    const fix = `Use only the parameters and values of ${ctx.links.rel} (debug-menu-and-test-hooks adds a parameter to the registry and the contract together).`;
    if (seen.has(name)) problem('debug-query', `the parameter "${name}" is repeated (the app refuses the whole link)`, 'Send each parameter once.');
    seen.add(name);
    if (!spec) problem('debug-query', `unknown debug parameter "${name}"`, fix);
    else if (Array.isArray(spec.values) && !spec.values.includes(value)) problem('debug-query', `${name}=${value} is not one of ${spec.values.join(', ')}`, fix);
    else if (spec.kind === 'date' && !/^(\d{4}-\d{2}-\d{2}|real)$/.test(value)) problem('debug-query', `${name}=${value} is not a YYYY-MM-DD day or real`, fix);
  }
  if (ctx.links.params.open && !queryPairs(query).some(([name]) => name === 'open') && !String(query).includes('open=${')) {
    problem('debug-open', `the debug link "${String(query).slice(0, 60)}" opens no screen`, 'End the link on the screen to show (open=<screen>) and wait for that screen\'s testID: waiting for the screen the flow is already on passes even when the app never got the link.');
  }
}

/** One id, WAIT_FOR or ROOT value; `via` prefixes the message when a sub-flow built the id. */
function checkIdValue(ctx, line, id, via = '') {
  if (id.includes('${')) return;
  const problem = (rule, message, fix) => ctx.report.problem({ file: ctx.rel, line, rule, message: `${via}${message}`, fix });
  if (PATTERN_CHARS.test(id)) {
    let pattern = null;
    try {
      pattern = new RegExp(`^(?:${id})$`);
    } catch {
      problem('testid-format', `id pattern "${id}" is not a valid regular expression`, 'Fix the pattern (Maestro matches id: as a regular expression over the whole testID), or select one testID.');
      return;
    }
    if (ctx.known !== null && !patternMatchesKnown(ctx.known, pattern)) problem('unknown-testid', `id pattern "${id}" matches no testID of the contracts`, `Match real testIDs (${ctx.known.rel}, contracts/e2e.json extraTestIDs).`);
    return;
  }
  if (!TESTID.test(id)) {
    problem('testid-format', `id "${id}" is not <scope>.<element> in kebab-case`, 'Use the screen\'s testID: <screen>.<element>[.<key>], every segment [a-z0-9]+(-[a-z0-9]+)* (naming-conventions).');
    return;
  }
  if (ctx.known === null) return;
  const found = lookupTestId(ctx.known, id);
  if (!found.known) problem('unknown-testid', `id "${id}" is not in the testID contracts`, `Use an id of ${ctx.known.rel} (list-screen prints a screen's ids); a test-only id goes into contracts/e2e.json extraTestIDs with why, in the same change as the code that renders it.`);
  else if (found.unreachable) problem('unreachable-testid', `id "${id}" is crop-only (${found.unreachable.why}), so Maestro never finds it`, `Select ${found.unreachable.use ? `"${found.unreachable.use}"` : 'its accessible ancestor'} instead and match its label with text:.`);
}

function checkIds(ctx, parsed) {
  visitMaps(parsed.steps, (key, value, parentKey, owner) => {
    if ((key === 'id' || key === 'WAIT_FOR' || key === 'ROOT') && typeof value === 'string') checkIdValue(ctx, owner.lines?.[key] ?? 0, value);
  });
}

/** Follows runFlow with literal env values into sub-flows and checks the ids and queries they build. */
function checkPassedValues(ctx, fileRel, env, depth, origin) {
  if (depth > 4 || Object.keys(env).length === 0) return;
  const parsed = ctx.parse(fileRel);
  if (parsed === null) return;
  const passed = Object.entries(origin.env).map(([key, value]) => `${key}=${value}`).join(', ');
  visitMaps(parsed.steps, (key, value) => {
    if (!['id', 'WAIT_FOR', 'ROOT'].includes(key) || typeof value !== 'string' || !value.includes('${')) return;
    const id = substitute(value, env);
    if (id === null || origin.checked.has(id)) return;
    origin.checked.add(id);
    checkIdValue(ctx, origin.line, id, `runFlow ${origin.file} with ${passed} makes ${posix.basename(fileRel)} use: `);
  });
  for (const target of runFlowTargets(parsed)) {
    if (target.file.includes('${')) continue;
    const next = posix.normalize(posix.join(posix.dirname(fileRel), target.file));
    if (!existsSync(join(ctx.root, next))) continue;
    const childEnv = { ...env };
    for (const [key, value] of Object.entries(target.env ?? {})) {
      const resolved = substitute(value, env);
      if (resolved === null) delete childEnv[key];
      else {
        childEnv[key] = resolved;
        if (key === 'QUERY' && String(value).includes('${') && DEBUG_SETUP.test(next)) checkQuery(ctx, origin.line, resolved);
      }
    }
    checkPassedValues(ctx, next, childEnv, depth + 1, origin);
  }
}

function checkSteps(ctx, info, parsed) {
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
  if (info.kind === 'flow' || info.kind === 'screenshots') {
    const first = commandOf(steps[0]);
    if (first.name !== 'launchApp' || first.arg?.clearState !== true) ctx.report.problem({ file: ctx.rel, line: steps.lines?.[0] ?? 1, rule: 'first-step-launch', message: `starts with ${first.name || 'nothing'} instead of launchApp with clearState: true`, fix: 'Begin with - launchApp: { clearState: true } so every run starts from the same state.' });
  }
  if (info.kind !== 'subflow') {
    visitMaps(steps, (key, value, parentKey, owner) => {
      if (key === 'openLink') ctx.report.problem({ file: ctx.rel, line: owner.lines?.[key] ?? 0, rule: 'raw-open-link', message: 'opens a link directly', fix: 'Set state through runFlow: { file: <...>/subflows/debug-setup.yaml, env: { QUERY, WAIT_FOR } } (it waits for the app, accepts iOS\'s alert and proves the link arrived).' });
    });
  }
  for (const target of runFlowTargets(parsed)) {
    if (DEBUG_SETUP.test(target.file) && typeof target.env?.QUERY === 'string') checkQuery(ctx, target.line, target.env.QUERY);
  }
  if (info.kind === 'flow' && info.area === 'a11y' && ctx.largeTextLocales.length > 0 && !ctx.text.includes('set-language') && !ctx.text.includes('${LANG}')) ctx.report.problem({ file: ctx.rel, line: 1, rule: 'large-text-lang', message: `never sets the language, so the large-text passes for ${ctx.largeTextLocales.join(' and ')} all run in the device language`, fix: 'Run the set-language sub-flow (subflows/set-language.yaml, two folders up from the flow) right after launchApp: the runner passes -e LANG=<locale> for each largeText locale.' });
  if ((info.kind === 'flow' || info.kind === 'manual') && !hasIdStep(parsed)) ctx.report.problem({ file: ctx.rel, line: 1, rule: 'no-testid-step', message: 'has no id: step, so it proves nothing about the app', fix: 'Wait for and assert the app\'s testIDs (extendedWaitUntil / assertVisible with id:).' });
  if (info.kind === 'manual') checkManual(ctx, info, parsed, steps);
}

/** A hand-run flow of a declared folder: started outside Maestro when the folder says so, with its required setup. */
function checkManual(ctx, info, parsed, steps) {
  const launches = [];
  steps.forEach((step, index) => {
    if (commandOf(step).name === 'launchApp') launches.push(steps.lines?.[index] ?? 0);
  });
  visitMaps(steps, (key, value, parentKey, owner) => {
    if (key === 'commands' && Array.isArray(value)) value.forEach((step, index) => commandOf(step).name === 'launchApp' && launches.push(value.lines?.[index] ?? owner.lines?.[key] ?? 0));
  });
  if (info.startsOutside) for (const line of launches) ctx.report.problem({ file: ctx.rel, line, rule: 'manual-folder', message: `calls launchApp, but ${info.folder}/ flows start outside Maestro: launchApp grants every permission, so the system prompt under test never shows`, fix: 'Start a fresh install with xcrun simctl launch <udid> <app id> (iOS) or adb -s <serial> shell monkey -p <app id> 1 (Android) before the flow, and relaunch the same way between flows.' });
  if (info.requiredParams.length === 0) return;
  const first = runFlowTargets(parsed).find((target) => DEBUG_SETUP.test(target.file) && typeof target.env?.QUERY === 'string');
  const names = new Set(first ? queryPairs(first.env.QUERY).map(([name]) => name) : []);
  const missing = info.requiredParams.filter((name) => !names.has(name));
  if (missing.length > 0) ctx.report.problem({ file: ctx.rel, line: first?.line ?? 1, rule: 'manual-folder', message: `the first setup link of a ${info.folder}/ flow does not set ${missing.join(', ')}`, fix: `Set ${missing.join(', ')} in the flow's first debug-setup QUERY (contracts/e2e.json manualFolders requiredParams): without it the result depends on the machine.` });
}

function checkSyntax(root, rels, maestro, report) {
  const bin = join(root, maestro);
  if (!existsSync(bin)) fail(`--syntax needs Maestro at ${maestro}`, 'Run bash scripts/e2e/install-maestro.sh first (or pass --maestro <path>).');
  const javaHome = process.env.JAVA_HOME ?? '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  const env = { ...process.env, JAVA_HOME: javaHome, MAESTRO_CLI_NO_ANALYTICS: 'true', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true', MAESTRO_DISABLE_UPDATE_CHECK: 'true' };
  for (const rel of rels) {
    const result = spawnSync(bin, ['check-syntax', join(root, rel)], { encoding: 'utf8', env, timeout: 120000 });
    if (result.status !== 0) report.problem({ file: rel, line: 1, rule: 'maestro-syntax', message: `maestro check-syntax: ${`${result.stdout}${result.stderr}`.trim().split('\n').pop()}`, fix: 'Fix the command or property name (Maestro 2.10 commands only).' });
  }
}

/** Checks one file of an app; returns the sub-flows it uses. */
function checkFile(ctx, info, today) {
  const text = readFileSync(join(ctx.root, ctx.rel), 'utf8');
  checkAiCommands(ctx.rel, text, ctx.report);
  const parsed = ctx.parse(ctx.rel);
  if (parsed === null || (info.kind !== 'subflow' && parsed.header === null)) {
    const error = parseFlow(text).error;
    ctx.report.problem({ file: ctx.rel, line: 1, rule: 'flow-parse', message: error ? `cannot be read: ${error}` : 'has no header, --- line and list of steps', fix: 'Write appId/name/tags, a line ---, then the steps as a YAML list.' });
    return;
  }
  ctx.text = text;
  const tags = checkHeader(ctx, info, parsed, { cliVars: CLI_VARS }) ?? [];
  checkQuarantine(ctx.rel, tags, parsed, today, ctx.report);
  checkSteps(ctx, info, parsed);
  checkSelectors(ctx.rel, parsed, ctx.report);
  checkOpenAlertGuard(ctx.rel, parsed, ctx.report);
  checkPlatformGuard(ctx.rel, parsed, commandOf, ctx.report);
  checkRunCommands(ctx.rel, parsed.comments, ctx.report);
  if (ctx.idsReady) checkIds(ctx, parsed);
  for (const target of runFlowTargets(parsed)) {
    if (target.file.includes('${')) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(ctx.rel), target.file));
    if (!existsSync(join(ctx.root, resolved))) {
      ctx.report.problem({ file: ctx.rel, line: target.line, rule: 'runflow-missing', message: `runFlow ${target.file} does not exist (${resolved})`, fix: `Fix the relative path: a flow in ${ctx.e2eDir}/flows/<area>/ reaches the sub-flows two folders up, in ${ctx.e2eDir}/subflows/.` });
      continue;
    }
    if (!ctx.usedAsSubflow.has(resolved)) ctx.usedAsSubflow.set(resolved, { from: ctx.rel, line: target.line });
    if (info.kind === 'subflow' || !ctx.idsReady) continue;
    const env = {};
    for (const [key, value] of Object.entries(target.env ?? {})) {
      const literal = substitute(value, {});
      if (literal !== null) env[key] = literal;
    }
    const checked = new Set(['WAIT_FOR', 'id'].map((key) => env[key]).filter((value) => value !== undefined));
    checkPassedValues(ctx, resolved, env, 1, { line: target.line, file: target.file, env, checked });
  }
}

function checkApp(root, app, options, report) {
  const e2eDir = app.layout.e2eDir;
  const contract = readContract(root, app);
  for (const message of contract.problems) report.problem({ file: contract.rel, line: 1, rule: 'e2e-contract', message: `${contract.rel} ${message}`, fix: "Copy this skill's templates/contracts/e2e.json (and its schema) and fill productionAppIds and network." });
  const manual = manualFolders(root, app, contract.data);
  const tagSet = new Set([...BASE_TAGS, ...(Array.isArray(contract.data?.tags) ? contract.data.tags : []), ...manual.keys()]);
  const rels = existsSync(join(root, e2eDir)) ? walk(join(root, e2eDir), { include: ['*.yaml', '*.yml'], pruneDirsContaining: ['SKILL.md'] }).map((local) => ({ local, rel: posix.join(e2eDir, local) })) : [];
  const flows = rels.filter(({ local }) => local.startsWith('flows/'));
  if (flows.length === 0) report.problem({ file: posix.join(e2eDir, 'flows'), line: 0, rule: 'flows-missing', message: 'E2E is set up but no flow exists', fix: `Copy this skill's flow templates to ${e2eDir}/flows/<area>/ (smoke/01-first-launch.yaml, journeys/02-...) with the sub-flows, fill their testIDs, then rerun.` });
  const known = knownTestIds(root, app, contract.data);
  const idsReady = known !== null;
  if (!idsReady && rels.length > 0) for (const rule of ['unknown-testid', 'unreachable-testid']) report.skip({ file: contractRel(app, 'screens.json'), rule, message: notYetCreated(root, { file: contractRel(app, 'screens.json'), owner: 'screen-contracts' }) ?? 'is not valid JSON' });
  const links = debugLinks(root, app);
  const usesSetup = rels.some(({ rel }) => /debug-setup\.ya?ml/.test(readFileSync(join(root, rel), 'utf8')));
  if (links.params === null && usesSetup) report.skip({ file: links.rel, rule: 'debug-query', message: notYetCreated(root, { file: links.rel, owner: 'debug-menu-and-test-hooks' }) ?? 'has no params' });
  const cache = new Map();
  const parse = (fileRel) => {
    if (!cache.has(fileRel)) {
      const path = join(root, fileRel);
      const flow = existsSync(path) ? parseFlow(readFileSync(path, 'utf8')) : { error: 'missing' };
      cache.set(fileRel, flow.error || !Array.isArray(flow.steps) ? null : flow);
    }
    return cache.get(fileRel);
  };
  const usedAsSubflow = new Map();
  const locales = [contract.data?.largeText?.locales, contract.data?.screenshots?.locales].flatMap((list) => (Array.isArray(list) ? list : []));
  const hasRtlLocale = locales.some(isRtlLocale);
  const largeTextLocales = Array.isArray(contract.data?.largeText?.locales) ? contract.data.largeText.locales : [];
  for (const { local, rel } of rels) {
    const info = classify(local, manual);
    const ctx = { root, rel, e2eDir, known, idsReady, links, report, parse, usedAsSubflow, tags: tagSet, hasRtlLocale, largeTextLocales };
    if (info.kind === 'config') continue;
    if (info.kind === 'misplaced') {
      report.problem({ file: rel, line: 1, rule: 'flow-location', message: `is not in ${e2eDir}/flows/<area>/, subflows/, screenshots/ or a declared manual folder`, fix: `Move it: journeys to ${e2eDir}/flows/<area>/<nn>-<name>.yaml, shared steps to ${e2eDir}/subflows/, the matrix to ${e2eDir}/screenshots/; a folder of hand-run flows goes into contracts/e2e.json manualFolders (and contracts/naming.json extraE2eFolders).` });
      continue;
    }
    if (info.kind === 'flow' && !KEBAB.test(info.area)) report.problem({ file: rel, line: 1, rule: 'flow-name', message: `the area folder "${info.area}" is not kebab-case`, fix: 'Name area folders smoke, journeys, offline, rtl, a11y, ...' });
    if ((info.kind === 'flow' || info.kind === 'manual') && !FLOW_NAME.test(info.name)) report.problem({ file: rel, line: 1, rule: 'flow-name', message: `"${info.name}" is not <nn>-<kebab-name>.yaml`, fix: 'Rename it, for example 02-complete-task-survives-kill.yaml (two digits, then kebab-case).' });
    checkFile(ctx, info, options.today);
  }
  for (const [target, { from, line }] of usedAsSubflow) {
    if (target.startsWith(`${e2eDir}/flows/`)) report.problem({ file: from, line, rule: 'subflow-in-flows', message: `uses ${target} as a sub-flow, but it sits under flows/`, fix: `Move shared steps to ${e2eDir}/subflows/ (files under flows/ also run on their own).` });
  }
  return rels;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${positionals[0] ?? '.'} has no package.json`, 'Run from the repo root or pass the repo root.');
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail(`--today ${today} is not YYYY-MM-DD`, 'Pass a day like 2026-10-14.');
  const report = createReporter({ name: SPEC.name, json: options.json });
  const apps = e2eApps(root, { e2eDir: options['e2e-dir'] }).filter((app) => isAdopted(root, app));
  if (apps.length === 0) return report.notApplicable('the app has no Maestro E2E yet: no .maestro/ folder, no contracts/e2e.json and no e2e npm script (e2e-maestro\'s workflow creates them)');
  let checked = 0;
  const all = [];
  for (const app of apps) {
    const rels = checkApp(root, app, { today }, report);
    checked += rels.length;
    all.push(...rels.map(({ rel }) => rel));
  }
  if (options.syntax) {
    const contract = readContract(root, apps[0]).data;
    checkSyntax(root, all, options.maestro ?? contract?.maestroBin ?? 'tools/maestro/bin/maestro', report);
  }
  return report.finish({ checked: Math.max(checked, 1), unit: 'flow files' });
});
