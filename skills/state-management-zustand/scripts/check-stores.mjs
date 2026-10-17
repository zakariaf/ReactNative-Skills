#!/usr/bin/env node
// check-stores.mjs: checks an Expo app's Zustand client state against the store rules: factories
// created once, persist before publish with checked writes, every change through a pure reducer,
// synchronous stores, selectors with useShallow, one persistence path, the server-state split and
// cross-store writes through updateAndPublish. Static: it reads source text and runs nothing.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-stores.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, lineOf, maskComments, parseArgs, readWorkspaces, requireDir, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { isTestFile, maskCode } from './lib/source-scan.mjs';
import {
  checkActionNames, checkAsync, checkCreatedOnce, checkCrossStoreWrites, checkPersistenceBypass, checkPurity, checkQueryCopies,
  checkSecondPersistence, checkSelectors, checkServerState, checkSetOutside, checkSingletons, checkStorePattern, checkTests,
  collectBuilders, domainFactories, storeHookShapes,
} from './lib/store-rules.mjs';

const SPEC = {
  name: 'check-stores',
  summary: "Checks an Expo app's Zustand stores (src/stores by default, and every store and selector call in src/) against the store rules of the state-management-zustand skill.",
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'The app source folder (default: from resolveLayout, src)' },
    'stores-dir': { type: 'string', value: 'dir', help: 'The stores folder (default: from resolveLayout, src/stores)' },
    contract: { type: 'string', value: 'file', help: 'The stores contract (default: rn-skills.config.json "storesContract", else <contractsDir>/stores.json)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  contract                    contracts/stores.json missing while two or more stores persist, or malformed',
    '  missing-file                <storesDir>/update-and-publish.ts missing while the contract lists crossStoreWrites',
    "  store-singleton             create from 'zustand', or a store (createStore, a create<X>Store factory) made at",
    '                              module level outside the contract\'s osMirrorStores',
    '  store-created-twice         a domain factory (export function or export const arrow create<X>Store) or',
    '                              createStores called in more than one file, or in feature, UI or shared-hook code;',
    '                              a per-session factory (its file declares a hook taking the store first, like',
    '                              useUndoableSessionStore(store, selector)) is left out, whatever its name',
    '  store-persist-order         a store method publishes (set) before it persists, or never persists (no',
    '                              "// memory-only: <why>" marker in the file)',
    "  store-unchecked-write       a write's result is dropped or never tested before set()",
    '  store-logic-outside-reducer set() publishes a value no reducer produced (a failure-only object is allowed)',
    '  store-async                 async, await or .then( in a store file or store initializer',
    '  store-set-outside           .setState( on a store from a file that creates no store',
    '  reducer-impure              a reducer or selectors file imports runtime code or reads time or randomness',
    '  reducer-untested            a *-reducer.ts or a persisting store without its sibling .test.ts(x)',
    '  action-name                 an action-union member that is not kebab-case or names an event (task-added,',
    '                              theme-changed, on-save, load-failed; a listed verb first passes: set-completed,',
    '                              toggle-pinned, copy-selected)',
    '  selector-missing            a store hook called without a selector, or with one that returns the whole state',
    '                              ((s) => s, s => s, (s) => { return s; }, also inside useShallow). A hook takes',
    '                              (store, selector) when its declaration in src/ has a store first parameter',
    '                              (useUndoableSessionStore), or, declared elsewhere, when it is a …Session…Store',
    '                              given two arguments or a non-selector one; otherwise (selector):',
    '                              useSessionStore(selectIsSignedIn) is a domain hook',
    '  selector-new-object         a selector that builds a new object or array without useShallow',
    '  shallow-v4                  an equality argument, zustand/traditional or createWithEqualityFn',
    "  second-persistence          zustand's persist middleware imported anywhere in src/, or AsyncStorage or MMKV imported",
    '                              in a store (a file under the stores folder or holding a createStore initializer);',
    "                              contracts/persistence.json legacyImports are allowed. Engines outside the stores (a",
    "                              key-value adapter, MMKV when keyValueStore names it) are persistence-and-migrations' rule",
    '  store-bypasses-persistence  a store file imports SQLite, secure storage, files, an adapter, the SqlDriver or the slot store',
    '  server-state-in-store       a store file imports TanStack Query, the API layer or an HTTP client, or calls fetch',
    '                              (a store file: under the stores folder, or any file holding a createStore initializer)',
    '  query-data-copied           an effect copies query data into a store',
    '  cross-store-write           a contract crossStoreWrites call outside updateAndPublish(stores, write) (inline, or a',
    '                              const write the same file passes to it); the data folder and tests are left out',
    '',
    'NOT APPLICABLE when zustand is not in package.json (root or workspaces).',
    'Limits (heuristic, by design): a store\'s persistence is recognised as a call through the parameters of the',
    'innermost function around createStore (a function declaration, an arrow or function expression, a method),',
    'including names it destructures or reads off them before createStore (const { tasks } = deps); ports reached',
    'any other way (a module import, a closure two functions up) are not seen (clock, errorLog, logger and similar',
    'ports never count). A domain factory is an exported create<X>Store as a function declaration or an exported',
    'const arrow (export const createXStore = (deps) => ...); a factory renamed on import is not seen. Builder selectors are recognised by their body and a',
    'non-primitive return type: exported select… functions of *-selectors.ts files, and functions declared at the top',
    'level of the calling file; a builder imported from elsewhere, renamed, or held in a variable inside a function is',
    'not seen. query-data-copied follows query.data and a { data: alias } destructured from useQuery, not other',
    'variables. Cross-store writes are recognised by name.',
    'Reads from rn-skills.config.json (optional): the layout keys and "storesContract".',
    'Example: node check-stores.mjs .',
  ].join('\n'),
};

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${what} ${path} is not valid JSON: ${error.message}`, 'Fix the JSON syntax.');
  }
}

function dependencies(root) {
  const manifests = [readJson(join(root, 'package.json'), 'package.json'), ...readWorkspaces(root).map((entry) => entry.manifest ?? {})];
  return new Set(manifests.flatMap((manifest) => ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((key) => Object.keys(manifest?.[key] ?? {}))));
}

function readContract(root, rel, defaults, report) {
  if (!existsSync(join(root, rel))) return { ...defaults, exists: false };
  const contract = readJson(join(root, rel), 'stores contract');
  const bad = (message) => report.problem({ file: rel, line: 1, rule: 'contract', message, fix: 'Follow stores.schema.json (shipped next to the template): { "crossStoreWrites": [names], "osMirrorStores": [repo paths] }.' });
  const lists = {};
  for (const key of ['crossStoreWrites', 'osMirrorStores']) {
    const value = contract[key];
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      bad(`${key} must be a list of strings`);
      lists[key] = defaults[key];
    } else lists[key] = value;
  }
  for (const key of Object.keys(contract)) if (!['$schema', 'crossStoreWrites', 'osMirrorStores'].includes(key)) bad(`unknown key "${key}"`);
  return { ...lists, exists: true };
}

function legacyImports(root, layout) {
  const path = join(root, layout.contractsDir, 'persistence.json');
  if (!existsSync(path)) return new Set();
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')).legacyImports;
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root, { srcDir: options['src-dir'], storesDir: options['stores-dir'] });
  const report = createReporter({ name: 'check-stores', json: options.json });
  if (!existsSync(join(root, 'package.json'))) throw new UsageError('package.json not found', 'Run from the app repo root, or pass it as the first argument.');
  if (!dependencies(root).has('zustand')) return report.notApplicable('zustand is not in package.json (no client stores to check)');
  const srcDirs = layout.mode === 'monorepo' && options['src-dir'] === undefined
    ? layout.workspaces.map((entry) => entry.layout.srcDir).filter((dir) => existsSync(join(root, dir)))
    : [layout.srcDir];
  if (srcDirs.length === 0) requireDir(join(root, layout.srcDir), `app source folder (${layout.srcDir})`);
  for (const dir of srcDirs) requireDir(join(root, dir), `app source folder (${dir})`);
  const files = walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['**/*.d.ts'] })
    .filter((rel) => srcDirs.some((dir) => rel.startsWith(`${dir}/`)))
    .map((rel) => {
      const raw = readFileSync(join(root, rel), 'utf8');
      return { rel, raw, code: maskComments(raw), bare: maskCode(raw), isTest: isTestFile(rel) || /(^|\/)(testing|__tests__)\//.test(rel) };
    });
  const contractRel = options.contract ?? layout.config.storesContract ?? `${layout.contractsDir}/stores.json`;
  const contract = readContract(root, contractRel, { crossStoreWrites: [], osMirrorStores: [`${layout.uiDir}/a11y/system-a11y-store.ts`] }, report);
  const codeOf = new Map(files.map((file) => [file.rel, file.code]));
  const hookShapes = storeHookShapes(files);
  const ctx = {
    root,
    layout,
    files,
    contract,
    storesDir: layout.storesDir,
    osMirrors: new Set(contract.osMirrorStores),
    legacyImports: legacyImports(root, layout),
    hookShapes,
    factories: domainFactories(files, hookShapes),
    builders: collectBuilders(files),
    problem: (rel, index, rule, message, fix) => report.problem({ file: rel, line: index === 0 ? 1 : lineOf(codeOf.get(rel) ?? '', index), rule, message, fix }),
  };
  const persistingFiles = new Set();
  for (const file of files) {
    checkSecondPersistence(ctx, file);
    checkPersistenceBypass(ctx, file);
    checkServerState(ctx, file);
    checkPurity(ctx, file);
    checkSingletons(ctx, file);
    if (checkStorePattern(ctx, file).length > 0) persistingFiles.add(file.rel);
    checkAsync(ctx, file);
    checkSetOutside(ctx, file);
    checkActionNames(ctx, file);
    checkSelectors(ctx, file);
    checkQueryCopies(ctx, file);
    checkCrossStoreWrites(ctx, file);
  }
  checkCreatedOnce(ctx);
  checkTests(ctx, persistingFiles);
  const domainPersisting = [...persistingFiles].filter((rel) => [...ctx.factories.values()].includes(rel));
  if (!contract.exists && domainPersisting.length >= 2) {
    report.problem({ file: contractRel, line: 0, rule: 'contract', message: `the stores contract is missing while ${domainPersisting.length} stores persist (${domainPersisting.join(', ')})`, fix: 'Copy templates/contracts/stores.json (and its schema) and list the writes that span stores (crossStoreWrites) and the OS mirror stores.' });
  }
  const publishFile = `${layout.storesDir}/update-and-publish.ts`;
  if (contract.crossStoreWrites.length > 0 && !files.some((file) => file.rel === publishFile)) {
    report.problem({ file: publishFile, line: 0, rule: 'missing-file', message: 'the contract lists crossStoreWrites but updateAndPublish is missing', fix: 'Copy templates/src/stores/update-and-publish.ts (with its test) and add one reload line per store that holds rows from disk.' });
  }
  return report.finish({ checked: files.length, unit: 'source files' });
});
