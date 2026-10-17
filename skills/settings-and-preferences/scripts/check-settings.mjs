#!/usr/bin/env node
// check-settings.mjs: proves the settings model end to end against the repo-owned contract
// (contracts/settings.json): the saved fields and their first-launch values, one reducer action per
// change, persist before publish, synchronous hydration, one writer, a row that dispatches every
// action, an effect outside the settings code for every field, units converted at the edge, data
// resets that keep the settings, restarts only for a direction flip, and the switch feedback.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-settings.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  UsageError,
  createReporter,
  lineOf,
  maskComments,
  matchGlob,
  notYetCreated,
  parseArgs,
  requireDir,
  resolveLayout,
  run,
  walkRepo,
} from './check-lib.mjs';
import { extractBlock, topLevelEntries } from './lib/object-literal.mjs';

const SPEC = {
  name: 'check-settings',
  summary:
    'Checks the settings model against contracts/settings.json: fields, defaults, actions, persist-then-publish, ' +
    'synchronous hydration, one writer, rows, effects, units, resets that keep the settings, restarts and feedback.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The settings contract (default: <contractsDir>/settings.json, or rn-skills.config.json "settingsContract")' },
    json: { type: 'boolean', help: 'Also print the problems as JSON before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'repo-root defaults to "." and must hold package.json. Paths in the contract are repo-relative, so a',
    'monorepo keeps one contract per app (pass it with --contract).',
    '',
    'NOT APPLICABLE when the app has no settings: no contract and no settings screen folder',
    '(<featuresDir>/settings). A malformed contract is exit 2.',
    '',
    'Rules:',
    '  settings-contract          a settings screen folder exists but no contract',
    '  settings-schema            the strict schema export holds exactly the contract fields, each with its validator',
    '  settings-default           the defaults object holds the contract first-launch value of every field, and nothing else',
    '  reducer-action             the reducer has a case per action, and calls each field clamp function',
    '  persist-then-publish       the store persists before it publishes, so no screen shows an unsaved value',
    '  hydrate-sync               the store and the storage adapters read and write synchronously (no await, then or *Async)',
    '  single-writer              no zustand persist middleware on the store, and no file outside the storage adapters',
    '                             writes a setting (a key-value SDK or localStorage next to a field name or the storage key)',
    '  row-dispatch               the screen folders dispatch every action (rowExempt aside)',
    '  setting-effect             every field has its effect read outside effectExclude (the setting does something)',
    '  unit-scale                 every effect file reading a percent field converts it (a division by 100 by default)',
    '  reset-keeps-settings       a data reset never names the settings, their storage or a whole-store clear, and',
    '                             (key-value mode) no app file outside the storage adapters clears a whole key-value store',
    '  reset-publish              a reset with publishWith (document mode) is written only inside a publishWith(...) call,',
    '                             never with a bare .update()',
    '  restart-on-direction-only  screen code reloads the app only next to the isRestartNeeded decision',
    '  toggle-feedback            the screen folders call the contract toggleFeedback (when it is set)',
  ].join('\n'),
};

const KV_SDKS = [
  'expo-sqlite/kv-store',
  'expo-sqlite/localStorage/install',
  '@react-native-async-storage/async-storage',
  'react-native-mmkv',
  'expo-secure-store',
];
/** An import of one of `sdks` (or a use of the localStorage global). */
function kvImportRe(sdks) {
  return new RegExp(`(?:from|import)\\s*['"](${sdks.map((name) => name.replace(/[/.]/g, '\\$&')).join('|')})['"]|\\blocalStorage\\s*\\.`);
}
const KV_IMPORT = kvImportRe(KV_SDKS);
/** The SDKs with a call that empties the whole store (expo-secure-store has none: it deletes key by key). */
const KV_CLEARABLE_IMPORT = kvImportRe(KV_SDKS.filter((name) => name !== 'expo-secure-store'));
const ZUSTAND_PERSIST = /import\s*\{[^}]*\bpersist\b[^}]*\}\s*from\s*['"]zustand\/middleware['"]/;
const RELOAD_CALL = /\breloadAppAsync\s*\(|\bUpdates\s*\.\s*reloadAsync\s*\(|\bDevSettings\s*\.\s*reload\s*\(|\bRNRestart\b/;
const RESTART_DECISION = /\bisRestartNeeded\b/;
/** A call that empties a whole key-value store: the saved settings go with it. */
const WHOLE_STORE_CLEAR = /(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?\b(?:clearSync|clearAsync|clearAll|clearStore)\s*\(|\b(?:Storage|AsyncStorage|localStorage|storage|kvStore)\s*\.\s*clear\s*\(/;
const ASYNC_IO = /\bawait\b|\.then\s*\(|\b[a-zA-Z_$][\w$]*Async\s*\(/;
const TEST_FILE = /(\.test\.tsx?|\.d\.ts)$|(^|\/)__tests__\//;
const DEFAULT_SCALE = '\\/\\s*100\\b';

const squash = (text) => text.replace(/\s+/g, ' ').replace(/"/g, "'").replace(/,\s*([\])}])/g, '$1').replace(/([[({])\s+/g, '$1').replace(/\s+([\])}])/g, '$1').trim();
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------------------------

function compile(source, where) {
  try {
    return new RegExp(source);
  } catch (error) {
    throw new UsageError(`contract ${where} is not a valid regex: ${error.message}`, 'Write a JavaScript regex source string (escape \\ as \\\\ in JSON).');
  }
}

const isText = (value) => typeof value === 'string' && value.length > 0;
const isTextList = (value) => Array.isArray(value) && value.every(isText);

function requireShape(ok, where, fix = 'Copy the template contract (templates/contracts/settings.json) and keep its shape.') {
  if (!ok) throw new UsageError(`contract ${where}`, fix);
}

function validateResets(resets) {
  requireShape(resets === undefined || Array.isArray(resets), 'resets must be a list');
  for (const [index, reset] of (resets ?? []).entries()) {
    requireShape(isText(reset?.file) && isText(reset?.function), `resets[${index}] needs file and function`);
    requireShape(isTextList(reset.keeps) && reset.keeps.length > 0, `resets[${index}].keeps must list at least one identifier`);
    requireShape(reset.publishWith === undefined || isText(reset.publishWith), `resets[${index}].publishWith must be a function name`);
  }
}

function validateFields(contract) {
  requireShape(contract.fields !== null && typeof contract.fields === 'object' && Object.keys(contract.fields).length > 0, 'fields must name at least one field');
  for (const [name, field] of Object.entries(contract.fields)) {
    requireShape(['schema', 'default', 'action', 'effect'].every((key) => isText(field?.[key])), `fields.${name} needs schema, default, action and effect`);
    requireShape(contract.actions.includes(field.action), `fields.${name}.action "${field.action}" is not in actions`, 'List every action in "actions".');
    requireShape(field.unit === undefined || field.unit === 'percent', `fields.${name}.unit must be "percent"`);
    compile(field.effect, `fields.${name}.effect`);
    if (field.scale !== undefined) compile(field.scale, `fields.${name}.scale`);
  }
}

function validateContract(contract) {
  requireShape(contract !== null && typeof contract === 'object' && !Array.isArray(contract), 'must be a JSON object');
  for (const key of ['schema', 'defaults']) requireShape(isText(contract[key]?.file) && isText(contract[key]?.export), `${key} needs file and export`);
  requireShape(isText(contract.reducer), 'reducer must be a file path');
  requireShape(isText(contract.store?.file) && isText(contract.store?.persist) && isText(contract.store?.publish), 'store needs file, persist and publish');
  compile(contract.store.persist, 'store.persist');
  compile(contract.store.publish, 'store.publish');
  requireShape(isTextList(contract.screenDirs) && contract.screenDirs.length > 0, 'screenDirs must list at least one folder');
  requireShape(isTextList(contract.actions) && contract.actions.length > 0, 'actions must list at least one action');
  requireShape(contract.rowExempt === undefined || isTextList(contract.rowExempt), 'rowExempt must be a list of actions');
  requireShape(contract.effectExclude === undefined || isTextList(contract.effectExclude), 'effectExclude must be a list of globs');
  requireShape(contract.storage === undefined || isTextList(contract.storage?.adapters), 'storage.adapters must be a list of files');
  requireShape(contract.toggleFeedback === undefined || contract.toggleFeedback === null || isText(contract.toggleFeedback), 'toggleFeedback must be a regex string or null');
  if (isText(contract.toggleFeedback)) compile(contract.toggleFeedback, 'toggleFeedback');
  validateFields(contract);
  validateResets(contract.resets);
  return contract;
}

function loadContract(root, layout, given) {
  const rel = given ?? layout.config.settingsContract ?? `${layout.contractsDir}/settings.json`;
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    if (given) throw new UsageError(`nothing to check: ${rel} not found`, 'Pass the path of the app settings contract.');
    return { rel, contract: null, text: '' };
  }
  const text = readFileSync(abs, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, 'Fix the JSON (templates/contracts/settings.json is the shape).');
  }
  return { rel, contract: validateContract(parsed), text };
}

// ---------------------------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------------------------

function makeRepo(root) {
  const cache = new Map();
  const read = (rel) => {
    if (!cache.has(rel)) {
      const abs = join(root, rel);
      cache.set(rel, existsSync(abs) ? maskComments(readFileSync(abs, 'utf8')) : null);
    }
    return cache.get(rel);
  };
  return { read, files: walkRepo(root, { include: ['*.ts', '*.tsx'] }) };
}

const under = (rel, dir) => rel === dir || rel.startsWith(`${dir.replace(/\/$/, '')}/`);

/** Code files of the app (every src folder), tests left out. */
function appFiles(repo, layout) {
  const srcDirs = [layout.srcDir, ...layout.workspaces.map((workspace) => workspace.layout.srcDir)];
  return repo.files.filter((rel) => srcDirs.some((dir) => under(rel, dir)) && !TEST_FILE.test(rel));
}

function contractLine(ctx, needle) {
  const index = ctx.contractText.indexOf(needle);
  return index === -1 ? 1 : lineOf(ctx.contractText, index);
}

/** `export const NAME[: T] =` → the index just after "=" in `source`, or -1. */
function exportStart(source, pattern) {
  const match = new RegExp(`export\\s+const\\s+(${pattern})\\s*(?::[^=]+)?=\\s*`).exec(source);
  return match ? { index: match.index, after: match.index + match[0].length, name: match[1] } : null;
}

// ---------------------------------------------------------------------------------------------
// Rules: schema, defaults, reducer, store
// ---------------------------------------------------------------------------------------------

/** Every export the schema pattern matches, as { file, name, version, source, index, inner }. */
function schemaExports(ctx) {
  const { file, export: name } = ctx.contract.schema;
  const pattern = name.includes('<n>') ? escapeRe(name).replace('<n>', '\\d+') : escapeRe(name);
  const files = /[*?{[]/.test(file) ? ctx.repo.files.filter((rel) => matchGlob(rel, file)) : [file];
  const found = [];
  for (const rel of files) {
    const source = ctx.repo.read(rel);
    if (source === null) continue;
    for (const match of source.matchAll(new RegExp(`export\\s+const\\s+(${pattern})\\s*(?::[^=]+)?=\\s*(v\\.)?(strictObject|object|looseObject)\\(\\s*\\{`, 'g'))) {
      const block = extractBlock(source, match.index + match[0].length - 1);
      const version = Number(/(\d+)$/.exec(match[1])?.[1] ?? 0);
      found.push({ file: rel, name: match[1], version, source, index: match.index, kind: match[3], inner: block?.inner ?? '' });
    }
  }
  return found;
}

function entriesOf(schema, all) {
  const entries = new Map();
  for (const entry of topLevelEntries(schema.inner)) entries.set(entry.key, entry.value);
  for (const spread of schema.inner.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)\.entries\b/g)) {
    const base = all.find((candidate) => candidate.name === spread[1]);
    if (base) for (const [key, value] of entriesOf(base, all)) if (!entries.has(key)) entries.set(key, value);
  }
  return entries;
}

function checkSchema(ctx) {
  const all = schemaExports(ctx);
  const { file, export: name } = ctx.contract.schema;
  if (all.length === 0) {
    ctx.problem({ file, line: 1, rule: 'settings-schema', message: `no \`export const ${name} = v.strictObject({ ... })\``, fix: 'Declare the settings as one strict valibot object (templates/src/stores/settings/settings-schema.ts).' });
    return;
  }
  const schema = all.reduce((best, item) => (item.version > best.version ? item : best));
  const line = lineOf(schema.source, schema.index);
  if (schema.kind !== 'strictObject') {
    ctx.problem({ file: schema.file, line, rule: 'settings-schema', message: `${schema.name} is v.${schema.kind}, so an unknown or misspelt field passes`, fix: 'Use v.strictObject: an unknown key is an error, so a typo never saves.' });
  }
  const entries = entriesOf(schema, all);
  for (const [field, spec] of Object.entries(ctx.contract.fields)) {
    const value = entries.get(field);
    if (value === undefined) ctx.problem({ file: schema.file, line, rule: 'settings-schema', message: `${schema.name} has no ${field}`, fix: `Add ${field}: ${spec.schema} (the contract lists it).` });
    else if (squash(value) !== squash(spec.schema)) ctx.problem({ file: schema.file, line, rule: 'settings-schema', message: `${field} is ${squash(value)}, the contract says ${spec.schema}`, fix: 'Change the schema and the contract together; a stored field never changes shape in place (a new meaning is a new field name).' });
  }
  for (const key of entries.keys()) {
    if (!(key in ctx.contract.fields)) ctx.problem({ file: schema.file, line, rule: 'settings-schema', message: `unknown setting ${key}`, fix: 'Add the field to contracts/settings.json first (validator, default, action, effect), then to the code.' });
  }
}

function checkDefaults(ctx) {
  const { file, export: name } = ctx.contract.defaults;
  const source = ctx.repo.read(file);
  const start = source === null ? null : exportStart(source, escapeRe(name));
  const open = start === null ? -1 : source.indexOf('{', start.after);
  if (start === null || open === -1 || !/^\s*(?:Object\.freeze\(\s*)?$/.test(source.slice(start.after, open))) {
    ctx.problem({ file, line: 1, rule: 'settings-default', message: `no \`export const ${name} = { ... }\` object literal`, fix: 'Write the first-launch values as one object literal (templates/src/stores/settings/settings-schema.ts).' });
    return;
  }
  const line = lineOf(source, start.index);
  const entries = new Map(topLevelEntries(extractBlock(source, open)?.inner ?? '').map((entry) => [entry.key, squash(entry.value)]));
  for (const [field, spec] of Object.entries(ctx.contract.fields)) {
    const value = entries.get(field);
    if (value !== squash(spec.default)) ctx.problem({ file, line, rule: 'settings-default', message: `${name}.${field} is ${value ?? 'missing'}, the contract says ${spec.default}`, fix: 'Settings that mirror a phone setting start at system (or null); noise starts off; change the contract first if the product decided otherwise.' });
  }
  for (const key of entries.keys()) {
    if (!(key in ctx.contract.fields)) ctx.problem({ file, line, rule: 'settings-default', message: `${name}.${key} is not a contract field`, fix: 'Remove it, or add the field to contracts/settings.json and the schema.' });
  }
}

function checkReducer(ctx) {
  const file = ctx.contract.reducer;
  const source = ctx.repo.read(file);
  if (source === null) {
    ctx.problem({ file, line: 1, rule: 'reducer-action', message: 'the settings reducer is missing', fix: 'Copy templates/src/stores/settings/settings-reducer.ts and keep one case per action.' });
    return;
  }
  for (const action of ctx.contract.actions) {
    if (!new RegExp(`case\\s+['"]${escapeRe(action)}['"]`).test(source)) ctx.problem({ file, line: 1, rule: 'reducer-action', message: `no case '${action}'`, fix: 'Handle every settings action in the pure reducer, with a test per action.' });
  }
  for (const [field, spec] of Object.entries(ctx.contract.fields)) {
    if (spec.clamp && !new RegExp(`(?<!function\\s+)\\b${escapeRe(spec.clamp)}\\s*\\(`).test(source)) ctx.problem({ file, line: 1, rule: 'reducer-action', message: `${field} is stored without ${spec.clamp}()`, fix: `Round and clamp ${field} in the reducer (${spec.clamp}), with a property test over any number.` });
  }
}

function checkStore(ctx) {
  const { file, persist, publish } = ctx.contract.store;
  const source = ctx.repo.read(file);
  if (source === null) {
    ctx.problem({ file, line: 1, rule: 'persist-then-publish', message: 'the settings store is missing', fix: 'Copy templates/src/stores/settings/settings-store.ts.' });
    return;
  }
  const persistAt = source.search(new RegExp(persist));
  const publishAt = source.search(new RegExp(publish));
  if (persistAt === -1 || publishAt === -1 || persistAt > publishAt) {
    const what = persistAt === -1 ? 'never persists' : publishAt === -1 ? 'never publishes a change' : 'publishes before it persists';
    ctx.problem({ file, line: lineOf(source, Math.max(0, persistAt === -1 ? publishAt : persistAt)), rule: 'persist-then-publish', message: `dispatch ${what} (store.persist / store.publish in the contract)`, fix: 'Reduce, write synchronously, then set the new settings; a failed write publishes nothing.' });
  }
  const persistMw = ZUSTAND_PERSIST.exec(source);
  if (persistMw) ctx.problem({ file, line: lineOf(source, persistMw.index), rule: 'single-writer', message: "zustand's persist middleware keeps a second copy and publishes before it saves", fix: 'Persist through the settings storage port inside dispatch (persist, then publish).' });
  for (const rel of [file, ...(ctx.contract.storage?.adapters ?? [])]) {
    const text = rel === file ? source : ctx.repo.read(rel);
    if (text === null) continue;
    const match = ASYNC_IO.exec(text);
    if (match) ctx.problem({ file: rel, line: lineOf(text, match.index), rule: 'hydrate-sync', message: `asynchronous settings I/O (${match[0].trim()})`, fix: 'Read and write synchronously (getItemSync / setItemSync): the store hydrates before the first paint, so the first frame already has the saved theme and language.' });
  }
}

// ---------------------------------------------------------------------------------------------
// Rules: writers, rows, effects, units
// ---------------------------------------------------------------------------------------------

function checkSingleWriter(ctx) {
  const adapters = ctx.contract.storage?.adapters ?? [];
  for (const rel of adapters) {
    if (ctx.repo.read(rel) === null) ctx.problem({ file: rel, line: 1, rule: 'single-writer', message: 'the declared settings storage adapter is missing', fix: 'Copy templates/src/services/settings-storage/kv-settings-storage-adapter.ts or fix storage.adapters.' });
  }
  const names = [...Object.keys(ctx.contract.fields), ...(ctx.contract.storage?.key ? [ctx.contract.storage.key] : [])];
  const literal = new RegExp(`(['"\`])(${names.map(escapeRe).join('|')})\\1`);
  for (const rel of ctx.app) {
    if (adapters.includes(rel)) continue;
    const text = ctx.repo.read(rel);
    const sdk = KV_IMPORT.exec(text);
    const name = sdk && literal.exec(text);
    if (name) ctx.problem({ file: rel, line: lineOf(text, name.index), rule: 'single-writer', message: `stores the setting "${name[2]}" outside the settings store (${sdk[1] ?? 'localStorage'})`, fix: 'Read the setting from the settings store and change it with an action; only the declared storage adapter writes settings.' });
  }
}

function screenFiles(ctx) {
  return ctx.app.filter((rel) => ctx.contract.screenDirs.some((dir) => under(rel, dir)));
}

function checkRows(ctx, screen) {
  const text = screen.map((rel) => ctx.repo.read(rel)).join('\n');
  const where = ctx.contract.screenDirs[0];
  if (screen.length === 0) {
    ctx.problem({ file: where, line: 1, rule: 'row-dispatch', message: 'no settings screen code in screenDirs', fix: 'Build the screen with templates/src/features/settings/ (rows, preference actions, model hook).' });
    return;
  }
  for (const action of ctx.contract.actions) {
    if ((ctx.contract.rowExempt ?? []).includes(action)) continue;
    if (!new RegExp(`['"]${escapeRe(action)}['"]`).test(text)) ctx.problem({ file: where, line: 1, rule: 'row-dispatch', message: `no settings row dispatches '${action}'`, fix: 'Give the setting a row whose handler dispatches its action once (settings-preference-actions.ts), or list a code-only action in rowExempt.' });
  }
  const feedback = ctx.contract.toggleFeedback;
  if (typeof feedback === 'string' && !new RegExp(feedback).test(text)) {
    ctx.problem({ file: where, line: 1, rule: 'toggle-feedback', message: `the settings switches play no feedback (${feedback})`, fix: 'Give useSettingsModel the input onToggled: () => { playUiFeedback(services, \'toggle\'); } (audio-and-haptics-feedback), never usePressFeedback (silent unless the app opted into tap sounds). It runs once, after the dispatch, so turning sound or haptics off is already silent.' });
  }
  for (const rel of screen) {
    const source = ctx.repo.read(rel);
    const reload = RELOAD_CALL.exec(source);
    if (reload && !RESTART_DECISION.test(source)) ctx.problem({ file: rel, line: lineOf(source, reload.index), rule: 'restart-on-direction-only', message: `reloads the app (${reload[0].trim()}) without the isRestartNeeded decision`, fix: 'A language change switches the text at once; reload only when planLanguageChange says isRestartNeeded (the layout direction flips), after the person confirms.' });
  }
}

function checkEffects(ctx) {
  const exclude = ctx.contract.effectExclude ?? [];
  const effectFiles = ctx.app.filter((rel) => !exclude.some((glob) => matchGlob(rel, glob)));
  for (const [field, spec] of Object.entries(ctx.contract.fields)) {
    const pattern = new RegExp(spec.effect);
    if (!effectFiles.some((rel) => pattern.test(ctx.repo.read(rel)))) {
      ctx.problem({ file: ctx.contractRel, line: contractLine(ctx, `"${field}"`), rule: 'setting-effect', message: `nothing outside the settings code reads ${field} (${spec.effect}): the setting has no effect`, fix: 'Apply it where it acts: a provider prop, a store subscription at startup, an adapter that reads the store at call time, or a feature hook (references/settings-model.md, the effects table).' });
    }
    if (spec.unit !== 'percent') continue;
    const reads = new RegExp(`\\b${escapeRe(field)}\\b`);
    const scale = new RegExp(spec.scale ?? DEFAULT_SCALE);
    for (const rel of effectFiles) {
      const source = ctx.repo.read(rel);
      const read = reads.exec(source);
      if (read && !scale.test(source)) ctx.problem({ file: rel, line: lineOf(source, read.index), rule: 'unit-scale', message: `${field} (integer percent) is used without converting it`, fix: 'Convert at the port edge (percent / 100 for a 0..1 audio volume, as toSoundOutput does); the store keeps the canonical unit.' });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Rules: resets
// ---------------------------------------------------------------------------------------------

function functionBody(source, name) {
  const match = new RegExp(`(?:function\\s+${escapeRe(name)}\\b[^{]*|\\b${escapeRe(name)}\\s*=\\s*(?:\\([^)]*\\)|[\\w$]+)\\s*(?::[^=]+)?=>\\s*)\\{`).exec(source);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  return { at: match.index, open, inner: extractBlock(source, open)?.inner ?? '' };
}

function checkResetBody(ctx, reset) {
  const source = ctx.repo.read(reset.file);
  if (source === null) {
    const reason = notYetCreated(ctx.root, { file: reset.file, owner: reset.owner ?? 'persistence-and-migrations' });
    if (reason) ctx.skip({ file: reset.file, rule: 'reset-keeps-settings', message: reason });
    return false;
  }
  const body = functionBody(source, reset.function);
  if (body === null) {
    ctx.problem({ file: reset.file, line: 1, rule: 'reset-keeps-settings', message: `no function ${reset.function}`, fix: 'Point the contract reset at the function the delete-data dialog runs.' });
    return true;
  }
  const kept = new RegExp(`\\b(${reset.keeps.map(escapeRe).join('|')})\\b`).exec(body.inner);
  if (kept) ctx.problem({ file: reset.file, line: lineOf(source, body.open + 1 + kept.index), rule: 'reset-keeps-settings', message: `${reset.function} touches ${kept[1]}`, fix: 'A data reset deletes the data and keeps the settings (and purchases): "Reset settings" is its own action and its own confirmation.' });
  return true;
}

/** The [open, close] index ranges of every `name(...)` call's argument list in `source`. */
function callRanges(source, name) {
  const ranges = [];
  for (const match of source.matchAll(new RegExp(`\\b${escapeRe(name)}\\s*\\(`, 'g'))) {
    const open = match.index + match[0].length - 1;
    const block = extractBlock(source, open);
    if (block) ranges.push({ open, close: block.close, inner: block.inner });
  }
  return ranges;
}

function checkResetWrites(ctx, reset) {
  const fn = escapeRe(reset.function);
  const bare = new RegExp(`\\.update\\s*\\(\\s*(?:\\(?\\s*[\\w$]*\\s*\\)?\\s*=>\\s*)?${fn}\\b`, 'g');
  const named = new RegExp(`\\b${fn}\\b`);
  let isWired = false;
  for (const rel of ctx.app) {
    if (rel === reset.file) continue;
    const source = ctx.repo.read(rel);
    if (!named.test(source)) continue;
    const wrapped = callRanges(source, reset.publishWith);
    if (wrapped.some((range) => named.test(range.inner))) isWired = true;
    for (const write of source.matchAll(bare)) {
      if (wrapped.some((range) => write.index > range.open && write.index < range.close)) continue;
      ctx.problem({ file: rel, line: lineOf(source, write.index), rule: 'reset-publish', message: `${reset.function} is written with a bare .update(), so every other store keeps its old data`, fix: `Put the one write inside ${reset.publishWith}'s write callback: ${reset.publishWith}(stores, () => <documents.update(${reset.function}, { refreshBackup: true }) as a Result>), so every store re-reads once it landed.` });
    }
  }
  if (!isWired) ctx.problem({ file: reset.file, line: 1, rule: 'reset-publish', message: `nothing writes ${reset.function} inside a ${reset.publishWith}(...) call`, fix: `Wire the confirmed dialog to a handler that calls ${reset.publishWith}(stores, () => ...${reset.function}...) (state-management-zustand owns updateAndPublish).` });
}

/**
 * `clearAll(): void {` or `async clearStore() {`: a method or function of the app's own being
 * defined (no receiver, the closing parenthesis followed by an optional return type and a body), not
 * a call into the SDK. Its body is scanned on its own: a whole-store clear inside it is still found.
 */
function isMethodDefinition(text, match) {
  if (/\.\s*[A-Za-z_$][\w$]*\s*\($/.test(match[0])) return false;
  let depth = 0;
  for (let index = match.index + match[0].length - 1; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') depth -= 1;
    if (depth === 0) return /^\s*(?::\s*[^{};=]+?)?\s*\{/.test(text.slice(index + 1, index + 200));
  }
  return false;
}

/**
 * The names in a file that can stand for a key-value store: what it imports from a clearable SDK,
 * what it builds from one (`const cache = createMMKV()`, `= new SQLiteStorage('cache')`), and the
 * usual store names. `tokenStore.clearAll()` on an object of the app's own is not a store clear.
 */
function kvReceivers(text) {
  const names = new Set(['Storage', 'AsyncStorage', 'localStorage', 'storage', 'kvStore']);
  const sdk = KV_SDKS.filter((name) => name !== 'expo-secure-store').map((name) => name.replace(/[/.]/g, '\\$&')).join('|');
  for (const match of text.matchAll(new RegExp(`import\\s+([^'";]+?)\\s+from\\s*['"](?:${sdk})['"]`, 'g'))) {
    for (const name of match[1].replace(/\btype\b|\* as\b|[{}]/g, ' ').split(/[\s,]+/)) {
      const local = name.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local) && local !== 'as') names.add(local);
    }
  }
  for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:new\s+)?([A-Za-z_$][\w$]*)\s*[(<]/g)) {
    if (names.has(match[2])) names.add(match[1]);
  }
  return names;
}

/** A clear with no receiver, or on one of the file's store names. */
function isKvReceiver(match, receivers) {
  const receiver = /^([A-Za-z_$][\w$]*)\s*\./.exec(match[0]);
  return receiver === null || receivers.has(receiver[1]);
}

/** Key-value mode: a whole-store clear anywhere in the app wipes the settings, whatever handler runs it. */
function checkWholeStoreClears(ctx) {
  if (!ctx.contract.storage) return;
  const adapters = ctx.contract.storage.adapters ?? [];
  for (const rel of ctx.app) {
    if (adapters.includes(rel)) continue;
    const text = ctx.repo.read(rel);
    if (!KV_CLEARABLE_IMPORT.test(text)) continue;
    const receivers = kvReceivers(text);
    for (const clear of text.matchAll(new RegExp(WHOLE_STORE_CLEAR.source, 'g'))) {
      if (isMethodDefinition(text, clear) || !isKvReceiver(clear, receivers)) continue;
      ctx.problem({ file: rel, line: lineOf(text, clear.index), rule: 'reset-keeps-settings', message: `clears a whole key-value store (${clear[0].replace(/\s+/g, '').replace(/\($/, '()')}), the saved settings included`, fix: 'Delete the data through the data layer (persistence-and-migrations\' resetAllData) and remove only the keys you own; "Reset settings" is its own action (reset-settings) with its own confirmation.' });
    }
  }
}

function checkResets(ctx) {
  for (const reset of ctx.contract.resets ?? []) {
    const exists = checkResetBody(ctx, reset);
    if (exists && reset.publishWith) checkResetWrites(ctx, reset);
  }
  checkWholeStoreClears(ctx);
}

// ---------------------------------------------------------------------------------------------

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) throw new UsageError(`nothing to check: no package.json in ${positionals[0] ?? '.'}`, 'Run from the app repo root, or pass it as the first argument.');
  const layout = resolveLayout(root);
  const report = createReporter({ name: 'check-settings', json: options.json });
  const { rel, contract, text } = loadContract(root, layout, options.contract);
  const screenDir = `${layout.featuresDir}/settings`;
  const storeDir = `${layout.storesDir}/settings`;
  if (contract === null) {
    if (!existsSync(join(root, screenDir))) return report.notApplicable(`the app has no settings: no ${rel} and no settings screen in ${screenDir}/`);
    report.problem({ file: rel, line: 1, rule: 'settings-contract', message: `the app has settings code (${screenDir}/${existsSync(join(root, storeDir)) ? `, ${storeDir}/` : ''}) but no settings contract`, fix: 'Copy templates/contracts/settings.json and fill in the app fields: the checker proves the code against it.' });
    return report.finish({ checked: 1, unit: 'files' });
  }
  const repo = makeRepo(root);
  const ctx = {
    root,
    repo,
    contract,
    contractRel: rel,
    contractText: text,
    app: appFiles(repo, layout),
    problem: (problem) => report.problem(problem),
    skip: (skip) => report.skip(skip),
  };
  checkSchema(ctx);
  checkDefaults(ctx);
  checkReducer(ctx);
  checkStore(ctx);
  checkSingleWriter(ctx);
  checkRows(ctx, screenFiles(ctx));
  checkEffects(ctx);
  checkResets(ctx);
  return report.finish({ checked: ctx.app.length + 1, unit: 'files' });
});
