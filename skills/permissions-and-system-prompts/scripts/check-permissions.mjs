#!/usr/bin/env node
// check-permissions.mjs: proves how an Expo app asks for OS permissions: every permission the code
// reads or requests is in contracts/permissions.json, only service adapters call the OS (mapping
// canAskAgain and limited access), asks happen from a person's action (never in an effect, at
// module scope or in the startup files), blocked permissions lead to the Settings app, the shown
// state is re-read on return to the foreground, iOS purpose strings and Android permissions reach
// the build, the copy keys exist, and each permission's asking model has a test for refusals.
// Usage: node check-permissions.mjs [repo-root] [options]   (see --help)

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, fail, maskComments, notYetCreated, parseArgs, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { braceDepthAt, effectSpans, jsonLineOf, loadApiTable, localImportTexts, permissionUses } from './lib/permission-scan.mjs';
import { findClosing, isTestFile, makeLineOf, maskCode } from './lib/source-scan.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const SPEC = {
  name: 'check-permissions',
  summary: 'Checks how an Expo app asks for OS permissions: inventory, adapters, asking from an action, blocked handling, purpose strings, Android permissions, copy and tests.',
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'App source folder (default: from resolveLayout, src)' },
    contract: { type: 'string', value: 'file', help: 'The permissions contract (default: rn-skills.config.json "permissionsContract", else contracts/permissions.json)' },
    'native-config': { type: 'string', value: 'file', help: 'The production native snapshot (default: contracts/native-config.json when it exists)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (tests, __mocks__ and test/ are skipped; App Tracking Transparency is admob-ads-and-consent\'s and not checked here):',
    '  contract                  contracts/permissions.json exists once code reads or requests a permission, parses, and',
    '                            each entry is well formed (known kind, feature, askedFrom under the source folder,',
    '                            platforms, purposeKey for an iOS kind, shouldExplainFirst, explain and settings keys,',
    '                            the optional unavailable keys complete,',
    '                            location before location-background, no kind twice)',
    '  undeclared-permission     code reads or requests a kind the contract does not list',
    '  contract-unused           the contract lists a kind no code reads or requests',
    '  request-boundary          an OS permission function (expo-* get/request*Permissions*, PermissionsAndroid) is used',
    '                            outside a service adapter (<services>/**/*-adapter.ts)',
    '  system-hook               a module\'s permission hook (useCameraPermissions, usePermissions, ...): it asks with no',
    '                            explanation, no blocked handling and no foreground re-read',
    '  ask-from-action           a request (an OS request function, .requestPermission(), .requestAccess()) inside an',
    '                            effect callback, at module scope, or in the startup files (<routes>/_layout.tsx,',
    '                            <features>/root-navigator/**)',
    '  can-ask-again             a file that maps an Expo permission answer never reads canAskAgain (itself or through a',
    '                            local import): denied and blocked look the same; PermissionsAndroid needs NEVER_ASK_AGAIN',
    '  photos-limited            a photo-library read or request whose file never reads accessPrivileges: limited access',
    '                            becomes granted or denied',
    '  picker-no-permission      expo-image-picker\'s media-library permission: launchImageLibraryAsync needs none',
    '  location-foreground-first background location requested in a file that never reads or requests foreground location',
    '  open-settings             the contract lists permissions but no code calls Linking.openSettings()',
    '  recheck-on-active         a hook file reads .permission() but never re-reads on the foreground (AppState,',
    '                            useIsAppActive, useSyncExternalStore over the permission status mirror)',
    '  purpose-string            an iOS kind\'s NS*UsageDescription is missing from the native snapshot, app.config.ts',
    '                            sets its plugin option to false (checked even with a snapshot), or, without a',
    '                            snapshot, app.config.ts never sets it',
    '  android-blocked           an Android kind\'s permission is removed in the snapshot (tools:node=remove), or',
    '                            app.config.ts lists it in android.blockedPermissions or blocks it with an',
    '                            expo-image-picker option set to false (both checked even with a snapshot)',
    '  copy-keys                 a contract copy key (purposeKey, explain.*, settings.*, unavailable.*) is missing from the',
    '                            source catalog',
    '  asked-from                askedFrom does not exist, does not ask, passes another shouldExplainFirst than the',
    '                            contract, or has no sibling test naming both a block and a refusal (blocked, denied|declined)',
    'rn-skills.config.json: "permissionsContract": "<repo-relative file>". SKIP: app.config.ts not yet created',
    '(expo-project-bootstrap), the source catalog not yet created (i18n-strings-and-catalogs).',
    'NOT APPLICABLE when package.json lists no react-native, or no permission module (the modules of',
    'assets/permission-apis.json), no PermissionsAndroid use and no contract. Exit 2 when package.json or the source',
    'folder is missing. When multi-package: run once per app with --src-dir apps/<app>/src.',
  ].join('\n'),
};

const ASK_CALL = /\.\s*(requestPermission|requestAccess)\s*\(/g;

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const report = createReporter({ name: SPEC.name, json: options.json });
  const pkg = readJson(join(root, 'package.json'));
  if (pkg === undefined) fail(`no package.json in ${root}`, 'Pass the app repo root (the folder with package.json).');
  if (pkg === null) fail(`package.json in ${root} is not valid JSON`, 'Fix package.json, then rerun.');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['react-native']) return report.notApplicable('react-native is not in package.json');
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  if (!existsSync(join(root, layout.srcDir))) fail(`nothing to check: ${layout.srcDir}/ does not exist`, 'Pass the app repo root, or --src-dir <dir>.');
  const table = loadApiTable(SKILL_DIR);
  const ctx = { root, layout, table, report, readFile: (rel) => readText(join(root, rel)) };
  ctx.files = readSources(root, layout.srcDir);
  ctx.contractRel = options.contract ?? layout.config?.permissionsContract ?? `${layout.contractsDir}/permissions.json`;
  const hasModule = Object.keys(table.modules).some((name) => deps[name]);
  const usesAndroid = ctx.files.some((file) => /\bPermissionsAndroid\b/.test(file.masked));
  if (!hasModule && !usesAndroid && !existsSync(join(root, ctx.contractRel))) {
    return report.notApplicable('no permission module (expo-image-picker, expo-camera, expo-location, ...) is in package.json and no code uses PermissionsAndroid');
  }
  for (const file of ctx.files) file.uses = permissionUses(file, table);
  ctx.uses = ctx.files.flatMap((file) => file.uses.map((use) => ({ ...use, rel: file.rel })));
  checkCode(ctx);
  const contract = readContract(ctx);
  if (contract !== null) checkContract(ctx, contract, options);
  return report.finish({ checked: ctx.files.length, unit: 'source files' });
}

// ------------------------------------------------------------------------------------------------
// Sources

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function readJson(path) {
  const text = readText(path);
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readSources(root, srcDir) {
  return walkRepo(root, { include: [`${srcDir}/**/*.ts`, `${srcDir}/**/*.tsx`, `${srcDir}/**/*.js`, `${srcDir}/**/*.jsx`] })
    .filter((rel) => !rel.endsWith('.d.ts') && !isTestFile(rel))
    .map((rel) => {
      const source = readFileSync(join(root, rel), 'utf8');
      return { rel, source, masked: maskCode(source), commentless: maskComments(source), lineOf: makeLineOf(source) };
    });
}

// ------------------------------------------------------------------------------------------------
// Code rules

function isAdapter(rel, layout) {
  return rel.startsWith(`${layout.servicesDir}/`) && /-adapter(\.(ios|android|native|web))?\.[jt]sx?$/.test(rel);
}

function checkCode(ctx) {
  for (const file of ctx.files) {
    checkBoundary(ctx, file);
    checkAskPlaces(ctx, file);
    checkMapping(ctx, file);
    checkLocationOrder(ctx, file);
    checkRecheck(ctx, file);
  }
}

function checkBoundary(ctx, file) {
  for (const use of file.uses) {
    if (use.op === 'hook') {
      ctx.report.problem({ file: file.rel, line: use.line, rule: 'system-hook', message: `${use.fn} from ${use.module} asks with no explanation, no blocked handling and no re-read on the foreground`, fix: 'Ask through usePermissionGate (src/hooks/use-permission-gate.ts) over the PermissionsPort.' });
    } else if (!isAdapter(file.rel, ctx.layout)) {
      ctx.report.problem({ file: file.rel, line: use.line, rule: 'request-boundary', message: `${use.fn} from ${use.module} is used outside a service adapter, so this code sees the OS answer, not the app's states`, fix: `Move it into ${ctx.layout.servicesDir}/permissions/<kind>-permission-adapter.ts (createExpoPermissionAccess) and use the PermissionsPort here.` });
    }
    if (use.module === 'expo-image-picker' && use.kind === 'photos') {
      ctx.report.problem({ file: file.rel, line: use.line, rule: 'picker-no-permission', message: `${use.fn}: launchImageLibraryAsync opens the system photo picker, which needs no permission (expo-image-picker 57), so this asks for the whole library for nothing`, fix: 'Drop the photo-library permission and call launchImageLibraryAsync directly; read the library with expo-media-library only when the feature truly browses it.' });
    }
  }
}

function askIndexes(file) {
  const found = [];
  for (const match of file.masked.matchAll(ASK_CALL)) found.push({ index: match.index, what: `.${match[1]}()` });
  for (const use of file.uses) if (use.op === 'request') found.push({ index: use.index, what: `${use.fn}()` });
  return found.sort((a, b) => a.index - b.index);
}

function isStartupFile(rel, layout) {
  return rel === `${layout.routesDir}/_layout.tsx` || rel.startsWith(`${layout.featuresDir}/root-navigator/`);
}

function checkAskPlaces(ctx, file) {
  const asks = askIndexes(file);
  if (asks.length === 0) return;
  const spans = effectSpans(file.masked);
  const startup = isStartupFile(file.rel, ctx.layout);
  for (const ask of asks) {
    const line = file.lineOf(ask.index);
    const effect = spans.find(([open, close]) => ask.index > open && ask.index < close);
    let where = null;
    if (startup) where = 'in a startup file, so it asks at launch before the person wants the feature';
    else if (effect) where = `inside ${effect[2]}(), so it asks without a press`;
    else if (braceDepthAt(file.masked, ask.index) === 0) where = 'at module scope, so it asks when the module loads';
    if (where) ctx.report.problem({ file: file.rel, line, rule: 'ask-from-action', message: `${ask.what} ${where}`, fix: 'Ask from the press handler of the control that needs the permission (gate.requestAccess(onAllowed) in the feature model).' });
  }
}

function checkMapping(ctx, file) {
  const answers = file.uses.filter((use) => use.op !== 'hook');
  if (answers.length === 0) return;
  const lazyImports = () => (file.imported ??= localImportTexts(file, { root: ctx.root, aliases: ctx.layout.aliases, readFile: ctx.readFile }));
  const mentions = (re) => re.test(file.masked) || lazyImports().some((text) => re.test(maskCode(text)));
  const expo = answers.find((use) => use.module !== 'react-native');
  if (expo && !mentions(/\bcanAskAgain\b/)) {
    ctx.report.problem({ file: file.rel, line: expo.line, rule: 'can-ask-again', message: `${expo.fn} answers are mapped without canAskAgain, so a refusal the OS will ask about again and one only Settings can undo look the same`, fix: 'Map the answer with toPermissionState (src/services/permissions/expo-permission-access.ts): granted, undetermined, then canAskAgain ? denied : blocked.' });
  }
  const android = answers.find((use) => use.module === 'react-native');
  if (android && !/\b(NEVER_ASK_AGAIN|never_ask_again)\b/.test(file.commentless)) {
    ctx.report.problem({ file: file.rel, line: android.line, rule: 'can-ask-again', message: `${android.fn} results are read without NEVER_ASK_AGAIN, so a blocked permission looks like a fresh refusal`, fix: "Map PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ('never_ask_again') to 'blocked', DENIED to 'denied'." });
  }
  const photos = answers.find((use) => use.kind === 'photos' && use.module !== 'react-native');
  if (photos && !mentions(/\baccessPrivileges\b/)) {
    ctx.report.problem({ file: file.rel, line: photos.line, rule: 'photos-limited', message: `${photos.fn} answers are mapped without accessPrivileges, so iOS "Select Photos" and Android 14 partial access become full access or a refusal`, fix: "Map accessPrivileges === 'limited' to 'limited' (toPermissionState does) and let the feature work with the chosen photos." });
  }
}

function checkLocationOrder(ctx, file) {
  const background = file.uses.find((use) => use.kind === 'location-background' && use.op === 'request');
  if (!background || file.uses.some((use) => use.kind === 'location')) return;
  ctx.report.problem({ file: file.rel, line: background.line, rule: 'location-foreground-first', message: 'background location is requested without reading or requesting foreground location first: Android 11+ ignores a combined request and iOS grants Always only after When In Use', fix: 'Ask foreground location from its own action first; ask background location later, separately, only once foreground is granted.' });
}

function checkRecheck(ctx, file) {
  if (!/^use-[\w-]+\.[jt]sx?$/.test(basename(file.rel))) return;
  const read = /\.\s*permission\s*\(/.exec(file.masked);
  if (!read) return;
  if (/\b(useIsAppActive|AppState|useSyncExternalStore|createPermissionStatusMirror|usePermissionGate)\b/.test(file.masked)) return;
  ctx.report.problem({ file: file.rel, line: file.lineOf(read.index), rule: 'recheck-on-active', message: 'this hook reads the permission once and never again, so a change made in Settings stays invisible until a restart', fix: 'Read it through usePermissionGate or createPermissionStatusMirror, which re-read on every return to the foreground.' });
}

// ------------------------------------------------------------------------------------------------
// The contract

function readContract(ctx) {
  const { root, contractRel, report } = ctx;
  const text = readText(join(root, contractRel));
  if (text === null) {
    const first = ctx.uses.find((use) => use.kind !== 'unknown') ?? ctx.uses[0];
    if (first) report.problem({ file: first.rel, line: first.line, rule: 'contract', message: `${first.fn} reads or requests a permission, but ${contractRel} does not exist`, fix: `Copy templates/contracts/permissions.json to ${contractRel} and list each permission the app asks for.` });
    return null;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    report.problem({ file: contractRel, line: 1, rule: 'contract', message: `not valid JSON (${error.message})`, fix: 'Fix the JSON; templates/permissions.schema.json describes it.' });
    return null;
  }
  if (!Array.isArray(data?.permissions)) {
    report.problem({ file: contractRel, line: 1, rule: 'contract', message: '"permissions" is not a list', fix: 'Write { "permissions": [ ... ] }.' });
    return null;
  }
  return { text, entries: data.permissions };
}

const COPY_GROUPS = { explain: ['title', 'body', 'continue', 'dismiss'], settings: ['title', 'body', 'open', 'dismiss'] };
const OPTIONAL_COPY_GROUPS = { unavailable: ['title', 'body', 'dismiss'] };

function entryProblems(ctx, entry, seen) {
  const { table, layout } = ctx;
  const problems = [];
  const kind = table.kinds[entry?.kind];
  if (entry?.kind === 'tracking') return ['App Tracking Transparency is asked through the ConsentPort (admob-ads-and-consent): leave it out of this contract'];
  if (!kind) return [`unknown kind ${JSON.stringify(entry?.kind)} (known: ${Object.keys(table.kinds).join(', ')})`];
  if (seen.has(entry.kind)) problems.push(`kind ${entry.kind} is listed twice`);
  if (typeof entry.feature !== 'string' || entry.feature.trim().length < 10) problems.push('"feature" must say what the person gets (10 characters or more)');
  if (typeof entry.askedFrom !== 'string' || !entry.askedFrom.startsWith(`${layout.srcDir}/`)) problems.push(`"askedFrom" must be a file under ${layout.srcDir}/`);
  const platforms = Array.isArray(entry.platforms) ? entry.platforms : [];
  if (platforms.length === 0 || platforms.some((p) => p !== 'ios' && p !== 'android')) problems.push('"platforms" must list ios and/or android');
  if (platforms.includes('ios') && kind.ios.length > 0 && typeof entry.purposeKey !== 'string') problems.push(`"purposeKey" names the catalog key of ${kind.ios.join(', ')}`);
  if (typeof entry.shouldExplainFirst !== 'boolean') problems.push('"shouldExplainFirst" must be true or false');
  for (const [group, keys] of Object.entries(COPY_GROUPS)) {
    if (keys.some((key) => typeof entry[group]?.[key] !== 'string')) problems.push(`"${group}" needs the catalog keys ${keys.join(', ')}`);
  }
  for (const [group, keys] of Object.entries(OPTIONAL_COPY_GROUPS)) {
    if (entry[group] !== undefined && keys.some((key) => typeof entry[group]?.[key] !== 'string')) problems.push(`"${group}" (optional) needs the catalog keys ${keys.join(', ')}`);
  }
  if (kind.requires && !ctx.contractKinds.has(kind.requires)) problems.push(`${entry.kind} needs a ${kind.requires} entry: background access is asked only after foreground access`);
  return problems;
}

function checkContract(ctx, contract, options) {
  const { report, contractRel } = ctx;
  ctx.contractKinds = new Set(contract.entries.map((entry) => entry?.kind));
  const seen = new Set();
  const valid = [];
  let from = 0;
  for (const entry of contract.entries) {
    const line = jsonLineOf(contract.text, entry?.kind ?? '', from);
    from = Math.max(from, contract.text.indexOf(JSON.stringify(entry?.kind ?? ''), from) + 1);
    const problems = entryProblems(ctx, entry, seen);
    for (const message of problems) report.problem({ file: contractRel, line, rule: 'contract', message: `${entry?.kind ?? 'entry'}: ${message}`, fix: 'Follow templates/contracts/permissions.schema.json.' });
    seen.add(entry?.kind);
    if (problems.length === 0) valid.push({ ...entry, line });
  }
  checkInventory(ctx, valid);
  if (valid.length > 0 && !ctx.files.some((file) => /\bLinking\s*\.\s*openSettings\b|\bopenSettings\s*\(/.test(file.masked) && /['"](react-native|expo-linking)['"]/.test(file.commentless))) {
    report.problem({ file: contractRel, line: 1, rule: 'open-settings', message: 'the app asks for permissions but no code opens the Settings app, so a blocked permission is a dead end', fix: 'Copy templates/src/services/permissions/system-settings-adapter.ts (Linking.openSettings()) and offer it from the settings sheet.' });
  }
  checkNativeConfig(ctx, valid, options);
  checkCopy(ctx, valid, contract.text);
  for (const entry of valid) checkAskedFrom(ctx, entry);
}

function checkInventory(ctx, entries) {
  const listed = new Set(entries.map((entry) => entry.kind));
  const used = new Set();
  for (const use of ctx.uses) {
    if (use.kind === 'unknown') continue;
    used.add(use.kind);
    if (!ctx.contractKinds.has(use.kind)) {
      ctx.report.problem({ file: use.rel, line: use.line, rule: 'undeclared-permission', message: `${use.fn} reads or requests ${use.kind}, which ${ctx.contractRel} does not list`, fix: `Add a ${use.kind} entry (feature, askedFrom, copy keys), or remove the code.` });
    }
  }
  for (const entry of entries) {
    if (!used.has(entry.kind)) ctx.report.problem({ file: ctx.contractRel, line: entry.line, rule: 'contract-unused', message: `${entry.kind} is listed but no code reads or requests it`, fix: 'Remove the entry, or add the adapter that asks for it.' });
  }
}

// ------------------------------------------------------------------------------------------------
// Native config: the production snapshot when present, else app.config.ts text

function checkNativeConfig(ctx, entries, options) {
  const { root, layout, report } = ctx;
  const snapshotRel = options['native-config'] ?? `${layout.contractsDir}/native-config.json`;
  const snapshot = readJson(join(root, snapshotRel));
  if (snapshot === null) fail(`${snapshotRel} is not valid JSON`, 'Regenerate it (expo-prebuild-and-config-plugins check-native-snapshot.mjs --write).');
  const configRel = ['app.config.ts', 'app.config.js'].find((name) => existsSync(join(root, name)));
  if (snapshot !== undefined) {
    checkSnapshot(ctx, entries, snapshot, snapshotRel);
    // The snapshot can be stale: a `false` or a block in app.config.ts is never right for an asked kind.
    if (configRel) checkConfigText(ctx, entries, configRel, { full: false });
    return undefined;
  }
  if (!configRel) {
    if (entries.length === 0) return undefined;
    const reason = notYetCreated(root, { file: 'app.config.ts', owner: 'expo-project-bootstrap' });
    report.skip({ file: 'app.config.ts', rule: 'purpose-string', message: reason });
    return undefined;
  }
  return checkConfigText(ctx, entries, configRel, { full: true });
}

function checkSnapshot(ctx, entries, snapshot, snapshotRel) {
  const plist = snapshot?.ios?.infoPlist ?? {};
  const removed = (snapshot?.android?.permissions ?? []).filter((p) => typeof p === 'string' && p.includes('tools:node=remove')).map((p) => p.split(' ')[0]);
  for (const entry of entries) {
    const kind = ctx.table.kinds[entry.kind];
    if (entry.platforms.includes('ios')) {
      for (const key of kind.ios) {
        if (typeof plist[key] !== 'string' || plist[key].trim() === '') ctx.report.problem({ file: snapshotRel, line: 1, rule: 'purpose-string', message: `${entry.kind}: ${key} is not in the production Info.plist, so iOS terminates the app at the request`, fix: `Set the plugin option (${kind.options.join(' / ') || 'ios.infoPlist'}) from the catalog key ${entry.purposeKey ?? ''} with sourceText(), then regenerate the snapshot.` });
      }
    }
    if (entry.platforms.includes('android')) {
      for (const permission of kind.android.filter((p) => removed.includes(p))) {
        ctx.report.problem({ file: snapshotRel, line: 1, rule: 'android-blocked', message: `${entry.kind}: ${permission} is removed from the manifest (tools:node=remove), so every request is refused without a dialog`, fix: 'Take it out of android.blockedPermissions (or the plugin option set to false), then regenerate the snapshot.' });
      }
    }
  }
}

function pluginBlock(masked, pkg) {
  const at = masked.search(new RegExp(`\\[\\s*(['"\`])${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`));
  if (at === -1) return null;
  const close = findClosing(masked, at);
  return close === -1 ? null : { start: at, text: masked.slice(at, close) };
}

/** full: also require each asked kind's option or key to be set (only when there is no snapshot). */
function checkConfigText(ctx, entries, configRel, { full }) {
  const source = readFileSync(join(ctx.root, configRel), 'utf8');
  const text = maskComments(source);
  const lineOf = makeLineOf(source);
  const usage = /\busageDescriptions\s*:\s*\{/.exec(text);
  const usageSpan = usage ? [usage.index, findClosing(text, usage.index + usage[0].length - 1)] : [-1, -1];
  const picker = pluginBlock(text, 'expo-image-picker');
  const blockedList = /\bblockedPermissions\s*:\s*\[([^\]]*)\]/.exec(text);
  for (const entry of entries) {
    const kind = ctx.table.kinds[entry.kind];
    if (entry.platforms.includes('ios')) checkPurposeText(ctx, { entry, kind, text, lineOf, configRel, usageSpan, full });
    if (!entry.platforms.includes('android')) continue;
    for (const permission of kind.android) {
      const short = permission.replace('android.permission.', '');
      if (blockedList && new RegExp(`['"](android\\.permission\\.)?${short}['"]`).test(blockedList[1])) {
        ctx.report.problem({ file: configRel, line: lineOf(blockedList.index), rule: 'android-blocked', message: `${entry.kind}: ${permission} is in android.blockedPermissions, so every request is refused without a dialog`, fix: 'Remove it from blockedPermissions, or stop asking for the permission.' });
      }
      for (const [option, blocked] of Object.entries(ctx.table.imagePickerBlocks)) {
        const off = picker && new RegExp(`\\b${option}\\s*:\\s*false\\b`).exec(picker.text);
        if (blocked === permission && off) ctx.report.problem({ file: configRel, line: lineOf(picker.start + off.index), rule: 'android-blocked', message: `${entry.kind}: expo-image-picker's ${option}: false also blocks ${permission} on Android`, fix: `Give ${option} the purpose text (sourceText) instead of false.` });
      }
    }
  }
}

function checkPurposeText(ctx, { entry, kind, text, lineOf, configRel, usageSpan, full }) {
  for (const option of kind.options) {
    const off = new RegExp(`\\b${option}\\s*:\\s*false\\b`).exec(text);
    if (off) {
      ctx.report.problem({ file: configRel, line: lineOf(off.index), rule: 'purpose-string', message: `${entry.kind}: ${option}: false deletes ${kind.ios.join(', ')}, so iOS terminates the app at the request`, fix: `Pass sourceText(projectRoot, '${entry.purposeKey}') instead of false.` });
      return;
    }
  }
  if (!full) return;
  const setByOption = kind.options.some((option) => new RegExp(`\\b${option}\\s*:`).test(text));
  for (const key of kind.ios) {
    const direct = [...text.matchAll(new RegExp(`\\b${key}\\s*:`, 'g'))].some((m) => m.index < usageSpan[0] || m.index > usageSpan[1]);
    if (!setByOption && !direct) ctx.report.problem({ file: configRel, line: 1, rule: 'purpose-string', message: `${entry.kind}: nothing in ${configRel} sets ${key}, so the build has no purpose string (or a plugin's vague English default)`, fix: `Set the plugin option (${kind.options.join(' / ') || `ios.infoPlist.${key}`}) to sourceText(projectRoot, '${entry.purposeKey}').` });
  }
}

// ------------------------------------------------------------------------------------------------
// Copy and the asking model

function sourceLanguage(ctx) {
  const languages = ctx.readFile(`${ctx.layout.i18nDir}/languages.ts`);
  return /\bSOURCE_LANGUAGE\s*=\s*['"]([\w-]+)['"]/.exec(languages ?? '')?.[1] ?? 'en';
}

function checkCopy(ctx, entries, contractText) {
  if (entries.length === 0) return;
  const catalogRel = `${ctx.layout.i18nDir}/catalogs/${sourceLanguage(ctx)}.json`;
  const catalog = readJson(join(ctx.root, catalogRel));
  if (catalog === undefined) {
    ctx.report.skip({ file: catalogRel, rule: 'copy-keys', message: notYetCreated(ctx.root, { file: catalogRel, owner: 'i18n-strings-and-catalogs' }) });
    return;
  }
  if (catalog === null) fail(`${catalogRel} is not valid JSON`, 'Fix the catalog (i18n-strings-and-catalogs), then rerun.');
  for (const entry of entries) {
    const keys = [entry.purposeKey, ...Object.values(entry.explain), ...Object.values(entry.settings), ...Object.values(entry.unavailable ?? {})].filter((key) => typeof key === 'string');
    for (const key of new Set(keys)) {
      if (typeof catalog[key] !== 'string') ctx.report.problem({ file: ctx.contractRel, line: jsonLineOf(contractText, key), rule: 'copy-keys', message: `${entry.kind}: ${key} is not in ${catalogRel}`, fix: 'Add the key to every catalog (i18n-strings-and-catalogs), in plain sentences.' });
    }
  }
}

function checkAskedFrom(ctx, entry) {
  const { report, contractRel } = ctx;
  const problem = (message, fix) => report.problem({ file: contractRel, line: jsonLineOf(ctx.contractTextCache ??= readText(join(ctx.root, contractRel)), entry.askedFrom), rule: 'asked-from', message: `${entry.kind}: ${message}`, fix });
  const source = ctx.readFile(entry.askedFrom);
  if (source === null) return problem(`askedFrom ${entry.askedFrom} does not exist`, 'Point askedFrom at the model hook that asks from the press.');
  const masked = maskCode(source);
  const asks = /\busePermissionGate\s*\(|\.\s*(requestAccess|requestPermission)\s*\(/.test(masked) || /request\w*Permissions?\w*\s*\(/.test(masked);
  if (!asks) problem(`${entry.askedFrom} does not ask (no usePermissionGate, requestAccess or requestPermission)`, 'Ask from this model, or point askedFrom at the file that does.');
  const explain = /\bshouldExplainFirst\s*:\s*(true|false)\b/.exec(masked);
  if (explain && (explain[1] === 'true') !== entry.shouldExplainFirst) problem(`${entry.askedFrom} passes shouldExplainFirst: ${explain[1]}, the contract says ${entry.shouldExplainFirst}`, 'Make the model and the contract agree.');
  const testRel = ['.test.ts', '.test.tsx'].map((ext) => entry.askedFrom.replace(/\.[jt]sx?$/, ext)).find((rel) => ctx.readFile(rel) !== null);
  const test = testRel ? ctx.readFile(testRel) : null;
  if (test === null || !/\bblocked\b/.test(test) || !/\b(denied|declined)\b/.test(test)) {
    problem(`${testRel ?? entry.askedFrom.replace(/\.[jt]sx?$/, '.test.ts')} ${test === null ? 'does not exist' : 'never covers both a refusal (denied or declined) and a block (blocked)'}`, 'Test the model through createFakePermissionAccess: granted, declined, blocked and unavailable on iOS and Android.');
  }
  return undefined;
}

await run(main);
