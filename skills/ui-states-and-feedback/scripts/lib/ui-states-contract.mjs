// ui-states-contract.mjs: reads contracts/screen-states.json and proves each declared screen against
// its view, its test and its state type (the contract rules of check-ui-states).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from '../check-lib.mjs';
import { findJsxTags, jsxAttributes, literalOf, makeLineOf, maskCode } from './source-scan.mjs';
import { QUERY_HOOK, featureRootOf } from './ui-states-source.mjs';

export const STATES = Object.freeze(['loading', 'offline', 'failed', 'empty', 'filtered-empty']);
/** The states whose message must offer a next step (offline resumes by itself). */
const ACTION_STATES = new Set(['failed', 'empty', 'filtered-empty']);
const TOP_KEYS = new Set(['$schema', '$comment', 'actionProp', 'screens', 'confirmations']);
const SCREEN_KEYS = new Set(['id', 'view', 'test', 'model', 'stateType', 'states', 'isList', 'hasFilter', 'readsServer']);
const CONFIRM_KEYS = new Set(['testID', 'whyNotUndo']);
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const QUERY_IMPORT = /from\s*['"]@tanstack\/react-query['"]/;
const DELAY_USE = /\buseDelayedVisibility\s*\(|<DelayedPlaceholder\b/;

/** The parsed contract with a line finder, or null when the file does not exist. */
export function readContract(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    fail(`${rel} is not valid JSON (${error.message})`, 'Fix the JSON syntax, then rerun.');
  }
  const lineOf = makeLineOf(text);
  /** The line of the first `"<key>": "<value>"` (or of the key alone), else 1. */
  const lineOfEntry = (key, value) => {
    const needle = value === undefined ? `"${key}"` : `"${key}": ${JSON.stringify(value)}`;
    const index = text.indexOf(needle);
    return index === -1 ? 1 : lineOf(index);
  };
  return { rel, data, lineOfEntry };
}

function invalid(contract, report, line, message) {
  report.problem({ file: contract.rel, line, rule: 'contract-invalid', message, fix: 'Follow contracts/screen-states.schema.json (shipped with the template).' });
}

function checkKeys(contract, report, object, allowed, where) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) invalid(contract, report, contract.lineOfEntry(key), `${where} has an unknown key "${key}"`);
  }
}

/** contract-invalid: the shape of the file. Returns the screens that are safe to check further. */
export function validScreens(contract, report) {
  const { data } = contract;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    invalid(contract, report, 1, 'the contract is not a JSON object');
    return [];
  }
  checkKeys(contract, report, data, TOP_KEYS, 'the contract');
  if (!Array.isArray(data.screens)) {
    invalid(contract, report, contract.lineOfEntry('screens'), '"screens" is missing or not an array');
    return [];
  }
  const seen = new Set();
  return data.screens.filter((screen, index) => validScreen(contract, report, screen, index, seen));
}

function validScreen(contract, report, screen, index, seen) {
  const where = `screens[${index}]`;
  if (screen === null || typeof screen !== 'object' || Array.isArray(screen)) {
    invalid(contract, report, contract.lineOfEntry('screens'), `${where} is not an object`);
    return false;
  }
  checkKeys(contract, report, screen, SCREEN_KEYS, where);
  const line = contract.lineOfEntry('id', screen.id);
  const problems = [];
  if (typeof screen.id !== 'string' || !ID.test(screen.id)) problems.push('"id" must be kebab-case (the testID prefix)');
  else if (seen.has(screen.id)) problems.push(`"id" "${screen.id}" is declared twice`);
  for (const key of ['view', 'test']) if (typeof screen[key] !== 'string' || screen[key] === '') problems.push(`"${key}" must name a repo file`);
  if (!Array.isArray(screen.states) || screen.states.some((state) => !STATES.includes(state))) problems.push(`"states" must list states from ${STATES.join(', ')}`);
  else if (new Set(screen.states).size !== screen.states.length) problems.push('"states" lists a state twice');
  for (const key of ['isList', 'hasFilter', 'readsServer']) if (key in screen && typeof screen[key] !== 'boolean') problems.push(`"${key}" must be true or false`);
  if ('stateType' in screen && (typeof screen.stateType?.file !== 'string' || typeof screen.stateType?.name !== 'string')) problems.push('"stateType" must be { "file", "name" }');
  for (const message of problems) invalid(contract, report, line, `${where}: ${message}`);
  seen.add(screen.id);
  return problems.length === 0;
}

/** The declared confirmations, by testID (contract-invalid for a malformed entry). */
export function declaredConfirmations(contract, report) {
  const list = contract.data?.confirmations;
  const declared = new Map();
  if (list === undefined) return declared;
  if (!Array.isArray(list)) {
    invalid(contract, report, contract.lineOfEntry('confirmations'), '"confirmations" must be an array');
    return declared;
  }
  for (const entry of list) {
    const line = contract.lineOfEntry('testID', entry?.testID);
    if (entry === null || typeof entry !== 'object' || typeof entry.testID !== 'string') {
      invalid(contract, report, line, 'a confirmation needs a "testID"');
      continue;
    }
    checkKeys(contract, report, entry, CONFIRM_KEYS, `confirmation "${entry.testID}"`);
    declared.set(entry.testID, { line, reason: typeof entry.whyNotUndo === 'string' ? entry.whyNotUndo.trim() : '' });
  }
  return declared;
}

function readRel(root, rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** contract-file: every file a screen names exists. Returns the texts that were found. */
function screenFiles(context, screen) {
  const { root, contract, report } = context;
  const line = contract.lineOfEntry('id', screen.id);
  const files = { view: screen.view, test: screen.test, model: screen.model, stateType: screen.stateType?.file };
  const texts = {};
  for (const [role, rel] of Object.entries(files)) {
    if (rel === undefined) continue;
    texts[role] = readRel(root, rel);
    if (texts[role] !== null) continue;
    report.problem({ file: contract.rel, line, rule: 'contract-file', message: `screen "${screen.id}": its ${role} ${rel} does not exist`, fix: 'Point the entry at the real file, or create it (templates/ holds the Tasks example).' });
  }
  return texts;
}

/** The states a screen must declare, each with why. */
function requiredStates(screen, modelText) {
  const required = [
    ['loading', 'it loads its data'],
    ['failed', 'any load can fail'],
  ];
  if (screen.isList === true) required.push(['empty', 'it lists items ("isList")']);
  if (screen.hasFilter === true) required.push(['filtered-empty', 'a filter narrows it ("hasFilter")']);
  if (screen.readsServer === true || (modelText !== null && modelText !== undefined && QUERY_IMPORT.test(modelText))) required.push(['offline', 'it reads server state']);
  return required;
}

function checkRequired(context, screen, texts) {
  const line = context.contract.lineOfEntry('id', screen.id);
  for (const [state, why] of requiredStates(screen, texts.model)) {
    if (screen.states.includes(state)) continue;
    context.report.problem({ file: context.contract.rel, line, rule: 'states-required', message: `screen "${screen.id}" does not declare "${state}", but ${why}`, fix: `Add "${state}" to its states, build that state in the view and render it in the test.` });
  }
}

/** The `kind: '<x>'` literals of an exported type alias. */
function unionKinds(text, name) {
  const start = new RegExp(`export\\s+type\\s+${name}\\b[^=]*=`).exec(text);
  if (start === null) return null;
  const rest = text.slice(start.index + start[0].length);
  const end = rest.search(/\n(?:export|type|function|const|interface)\b/);
  const body = end === -1 ? rest : rest.slice(0, end);
  return [...body.matchAll(/\bkind\s*:\s*(['"])([a-z-]+)\1/g)].map((match) => match[2]);
}

function checkKinds(context, screen, texts) {
  if (screen.stateType === undefined || typeof texts.stateType !== 'string') return;
  const { file, name } = screen.stateType;
  const kinds = unionKinds(texts.stateType, name);
  const fix = 'Keep the state union and the contract in step: one kind per declared state, plus "ready".';
  if (kinds === null) {
    context.report.problem({ file, line: 1, rule: 'state-kinds', message: `no exported type ${name} in ${file}`, fix });
    return;
  }
  const want = new Set([...screen.states, 'ready']);
  const have = new Set(kinds);
  const missing = [...want].filter((kind) => !have.has(kind));
  const extra = [...have].filter((kind) => !want.has(kind));
  if (missing.length === 0 && extra.length === 0) return;
  const parts = [missing.length > 0 ? `lacks ${missing.join(', ')}` : '', extra.length > 0 ? `has undeclared ${extra.join(', ')}` : ''].filter(Boolean);
  context.report.problem({ file, line: makeLineOf(texts.stateType)(texts.stateType.indexOf(`type ${name}`)), rule: 'state-kinds', message: `${name} ${parts.join(' and ')} (screen "${screen.id}")`, fix });
}

/** state-testid, state-action, loading-delayed: the view renders each state as declared. */
function checkView(context, screen, text) {
  const { report } = context;
  const actionProp = context.contract.data.actionProp ?? 'action';
  const masked = maskCode(text);
  const lineOf = makeLineOf(text);
  const tags = findJsxTags(text, masked).map((tag) => ({ tag, attrs: jsxAttributes(text, tag, masked) }));
  for (const state of screen.states) {
    const testID = `${screen.id}.state.${state}`;
    const found = tags.find(({ attrs }) => literalOf(attrs.get('testID')) === testID);
    if (found === undefined) {
      report.problem({ file: screen.view, line: 1, rule: 'state-testid', message: `no element with testID="${testID}"`, fix: `Render the "${state}" state with the literal testID "${testID}" (tests and E2E flows find it by that id).` });
      continue;
    }
    if (!ACTION_STATES.has(state) || found.attrs.has(actionProp)) continue;
    report.problem({ file: screen.view, line: lineOf(found.tag.start), rule: 'state-action', message: `the "${state}" state offers no next step (no ${actionProp}=)`, fix: 'Give it its one action: Try again for failed, the first item for empty, clear the filter for filtered-empty.' });
  }
  if (screen.states.includes('loading') && !DELAY_USE.test(text)) {
    report.problem({ file: screen.view, line: 1, rule: 'loading-delayed', message: 'the loading state is not delayed, so it flashes on every fast load', fix: 'Wrap it in DelayedPlaceholder (or read useDelayedVisibility) with a placeholder shaped like the content.' });
  }
}

/** state-tested: the screen's test renders every declared state. */
function checkTested(context, screen, text) {
  const missing = screen.states.filter((state) => !text.includes(`${screen.id}.state.${state}`));
  if (missing.length === 0) return;
  context.report.problem({ file: screen.test, line: 1, rule: 'state-tested', message: `never renders ${missing.map((state) => `${screen.id}.state.${state}`).join(', ')}`, fix: 'Render each declared state in the test and assert its testID, its text and its action.' });
}

/** Every contract rule for one screen. */
export function checkScreen(context, screen) {
  const texts = screenFiles(context, screen);
  checkRequired(context, screen, texts);
  checkKinds(context, screen, texts);
  if (typeof texts.view === 'string') checkView(context, screen, texts.view);
  if (typeof texts.test === 'string') checkTested(context, screen, texts.test);
}

/**
 * screen-undeclared: a feature reads server state (a use…Query( call), but no screen in the contract
 * names a view, model or test in its feature folder, so none of its states is proven. One problem
 * per folder, on its first reading file. `readers` are the features files that call a query hook.
 */
export function checkUndeclaredScreens(context, readers, layout) {
  const screens = Array.isArray(context.contract.data?.screens) ? context.contract.data.screens : [];
  const declared = new Set();
  for (const screen of screens) {
    for (const key of ['view', 'model', 'test']) {
      if (typeof screen?.[key] === 'string' && screen[key] !== '') declared.add(featureRootOf(screen[key], layout));
    }
  }
  const reported = new Set();
  for (const file of [...readers].sort((a, b) => a.rel.localeCompare(b.rel))) {
    const folder = featureRootOf(file.rel, layout);
    if (declared.has(folder) || reported.has(folder)) continue;
    reported.add(folder);
    const index = file.masked.search(QUERY_HOOK);
    context.report.problem({
      file: file.rel,
      line: file.lineOf(Math.max(index, 0)),
      rule: 'screen-undeclared',
      message: `${folder}/ reads server state, but no screen in ${context.contract.rel} names a view, model or test there, so its loading, failed, empty and offline states go unchecked`,
      fix: `Add the screen to ${context.contract.rel} ({ "id", "view", "test", "model", "states", ... }) and build and test each state it declares.`,
    });
  }
}
