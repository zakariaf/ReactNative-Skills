#!/usr/bin/env node
// check-ui-states.mjs: proves the non-happy paths of an Expo app. Source rules: one state union per
// screen (no loading/error flag pair, no query data defaulted to []), delayed loading placeholders, no
// refresh that blanks content, the feedback ladder (no Alert.alert, offline never a notice, no modal
// spinner), confirmations that name the consequence and run only on 'confirmed', and iOS
// announcements next to live regions. Contract rules: every screen in contracts/screen-states.json
// declares and builds each state it owes, with its testID, its next step and a test, and every
// confirm() is declared with why Undo cannot replace it.
// Usage: node check-ui-states.mjs [repo-root] [options]   (see --help)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, parseArgs, readWorkspaces, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { checkScreen, checkUndeclaredScreens, declaredConfirmations, readContract, validScreens } from './lib/ui-states-contract.mjs';
import { SOURCE_RULES, confirmCalls, projectFacts, sourceFile, under } from './lib/ui-states-source.mjs';
import { isTestFile } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-ui-states',
  summary: 'Checks loading, empty, filtered-empty, failed and offline states, delayed placeholders, the notice/banner/dialog ladder and confirmations.',
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'App source folder (default: from resolveLayout, src)' },
    contract: { type: 'string', value: 'file', help: 'Screen states contract (default: <contractsDir>/screen-states.json, or rn-skills.config.json "uiStates.contract")' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Source rules (app source under the src folder; tests, __mocks__ and test/ are skipped):',
    '  state-flags        a loading flag (isLoading/loading/isFetching/isPending) and an error (error, failure,',
    '                     hasError, ...) kept in two useStates of one file',
    '  empty-default      query data defaulted to [] in a file that reads TanStack Query: const { data = [] } =',
    '                     useQuery(...) (also { data: tasks = [] }), or data ?? [] / query.data || [] in a file that',
    '                     derives no state (…StateOf) or inside the …StateOf(...) call itself',
    '  bare-spinner       an <ActivityIndicator> in the features or routes folder, in a file that never uses',
    '                     DelayedPlaceholder or useDelayedVisibility (src/ui controls may show their own busy state)',
    '  refresh-blanks     if (...isFetching / isRefetching / fetchStatus === "fetching"...) return ...',
    '  native-alert       Alert.alert(...) or Alert.prompt(...)',
    "  confirm-outcome    a comparison !== 'cancelled' / 'dismissed', or a guard that returns only on one of them",
    '  confirm-vague      a confirm({ ... }) whose confirmLabel key ends in ok/okay/yes/sure or whose title key ends in',
    '                     are-you-sure/sure/warning/attention, a shared title key (common.*, shared.*, general.*), or a',
    '                     shared button key that names no verb (common.confirm/continue/done/...; common.delete is fine)',
    '  offline-notice     notify({ ... }) with a t() key that contains "offline"',
    '  busy-overlay       a <Modal> that holds an <ActivityIndicator> or <BusyIndicator>',
    '  announce-ios       a .tsx file in the features folder or <uiDir>/feedback with accessibilityLiveRegion or a',
    '                     <Toast>, and no useAnnounce()/announce() call in it or in any file of its feature folder',
    '                     (the model hook beside a pure view)',
    'Contract rules (contracts/screen-states.json):',
    '  contract-missing   no contract, although screen code (features or routes folder) calls a use…Query( hook,',
    '                     <uiDir>/feedback/ exists or code calls confirm(); query plumbing in src/api/ alone does not count',
    '  screen-undeclared  a features or routes file calls a use…Query( hook, and no contract screen names a view,',
    '                     model or test in its feature folder (a route: its own folder)',
    '  contract-invalid   unknown keys, a bad id, an unknown or repeated state, a malformed confirmation',
    '  contract-file      a view, test, model or stateType file the contract names does not exist',
    '  states-required    loading and failed always; empty with "isList"; filtered-empty with "hasFilter"; offline with',
    '                     "readsServer" or a model that imports @tanstack/react-query',
    '  state-kinds        the stateType union\'s kind literals differ from the declared states plus "ready"',
    '  state-testid       the view has no element with the literal testID "<id>.state.<state>"',
    '  state-action       the failed, empty or filtered-empty element has no action= (contract "actionProp")',
    '  loading-delayed    a view that declares loading never uses DelayedPlaceholder or useDelayedVisibility',
    '  state-tested       the screen test never names "<id>.state.<state>" for a declared state',
    '  confirm-undeclared a confirm() whose literal testID is not in "confirmations" with a "whyNotUndo" reason,',
    '                     or whose testID is not a literal',
    'rn-skills.config.json: "uiStates": { "contract": "contracts/screen-states.json" }.',
    'NOT APPLICABLE when package.json (root or a workspace) lists no react-native. Exit 2 when package.json or the',
    'source folder is missing, or the contract is not valid JSON. When multi-package: run once per app with',
    '--src-dir apps/<app>/src --contract apps/<app>/contracts/screen-states.json.',
  ].join('\n'),
};

function readPackageJson(root) {
  const path = join(root, 'package.json');
  if (!existsSync(path)) fail(`no package.json in ${root}`, 'Pass the app repo root (the folder with package.json).');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fail(`package.json in ${root} is not valid JSON`, 'Fix package.json, then rerun.');
  }
}

function dependsOn(manifest, name) {
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((key) => manifest?.[key]?.[name] !== undefined);
}

function contractPath(layout, options) {
  const configured = layout.config?.uiStates?.contract;
  if (configured !== undefined && typeof configured !== 'string') fail('"uiStates.contract" in rn-skills.config.json is not a string', 'Set it to a repo-relative file path.');
  return options.contract ?? configured ?? `${layout.contractsDir}/screen-states.json`;
}

function appSources(root, srcDir) {
  return walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['**/*.d.ts'] })
    .filter((rel) => under(rel, srcDir) && !isTestFile(rel))
    .map((rel) => sourceFile(rel, readFileSync(join(root, rel), 'utf8')));
}

/** Screen code that reads server state: a features or routes file that calls a use…Query( hook. */
function readsServerState(file, layout) {
  return file.callsQuery && (under(file.rel, layout.featuresDir) || under(file.rel, layout.routesDir));
}

/**
 * Why the app owes a contract, or null. Only screen code counts: a QueryClient, a provider and query
 * options in src/api/ are plumbing, and there is no screen to declare until one reads them.
 */
function contractReason(root, layout, files) {
  const reader = files.find((file) => readsServerState(file, layout));
  if (reader !== undefined) return `${reader.rel} reads server state`;
  if (existsSync(join(root, layout.uiDir, 'feedback'))) return `${layout.uiDir}/feedback/ exists`;
  if (files.some((file) => confirmCalls(file).length > 0)) return 'app code calls confirm()';
  return null;
}

function checkConfirmations(files, declared, contractRel, report) {
  for (const file of files) {
    for (const call of confirmCalls(file)) {
      const id = call.testID?.isKey === false ? call.testID.value : null;
      const entry = id === null ? undefined : declared.get(id);
      if (entry !== undefined && entry.reason !== '') continue;
      const message = id === null
        ? 'a confirm() without a literal testID cannot be matched to its declaration'
        : `confirm "${id}" is not declared in ${contractRel} with a "whyNotUndo" reason`;
      report.problem({ file: file.rel, line: call.line, rule: 'confirm-undeclared', message, fix: 'Prefer doing it at once with Undo (runUndoable); a real confirmation gets a literal testID and an entry { "testID", "whyNotUndo": "<what cannot be undone>" }.' });
    }
  }
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const report = createReporter({ name: SPEC.name, json: options.json });
  const pkg = readPackageJson(root);
  const isReactNative = dependsOn(pkg, 'react-native') || readWorkspaces(root).some((workspace) => dependsOn(workspace.manifest, 'react-native'));
  if (!isReactNative) return report.notApplicable('react-native is not in package.json');
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  if (!existsSync(join(root, layout.srcDir))) fail(`nothing to check: ${layout.srcDir}/ does not exist`, 'Pass the app repo root, or --src-dir <dir>.');
  const files = appSources(root, layout.srcDir);
  const project = projectFacts(files, layout);
  for (const file of files) for (const rule of SOURCE_RULES) rule(file, report, layout, project);
  const rel = contractPath(layout, options);
  const contract = readContract(root, rel);
  if (contract === null) {
    const reason = contractReason(root, layout, files);
    if (reason !== null) report.problem({ file: rel, line: 1, rule: 'contract-missing', message: `no screen states contract, but ${reason}`, fix: 'Copy templates/contracts/screen-states.json (and its schema) and declare every screen that loads, lists or filters data.' });
    else report.note(`${rel}: none yet (no screen reads server state, no ${layout.uiDir}/feedback/, no confirm())`);
    return report.finish({ checked: files.length, unit: 'source files' });
  }
  const screens = validScreens(contract, report);
  const context = { root, contract, report };
  for (const screen of screens) checkScreen(context, screen);
  checkUndeclaredScreens(context, files.filter((file) => readsServerState(file, layout)), layout);
  checkConfirmations(files, declaredConfirmations(contract, report), rel, report);
  return report.finish({ checked: files.length + screens.length, unit: 'source files and screens' });
}

run(main);
