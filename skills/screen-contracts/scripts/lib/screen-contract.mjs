// screen-contract.mjs: reads and validates the app's screen contract (contracts/screens.json), the
// source-language catalog and the component catalogue, and knows which parts a component derives.
// Helper for check-screens.mjs and list-screen.mjs (not an entry point).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fail, resolveLayout, toPosix, walk, walkRepo } from '../check-lib.mjs';
import { canonicalRegExp, escapeRegExp } from './screen-source.mjs';

/** rn-skills.config.json key that moves the contract (documented in references/contract-format.md). */
export const CONFIG_KEY = 'screensContract';
export const PRESENTATIONS = Object.freeze(['route', 'modal-route', 'overlay', 'dialog', 'sheet', 'embedded']);
/** Presentations a route file renders: they name `route` and `model`. */
export const ROUTED = new Set(['route', 'modal-route']);
/** Presentations drawn in the tree over another screen: they must keep screen readers inside. */
export const IN_TREE_OVERLAYS = new Set(['overlay', 'dialog', 'sheet']);
/** Components that keep VoiceOver and TalkBack inside on their own (React Native's Modal, the library Scrim). */
export const DEFAULT_MODAL_ROOTS = Object.freeze(['Modal', 'Scrim']);
/** Library components that repeat a keyed child per data item (segments, stat cells, chart columns, dots). */
export const DEFAULT_KEYED = Object.freeze(['SegmentedControl', 'StatGrid', 'BarChart', 'PagerDots']);
/** Route files that are never a screen of their own (Expo Router conventions). */
export const NON_SCREEN_ROUTE = /(?:^|\/)(?:_layout|\+html|\+native-intent|\+middleware)\.[jt]sx?$|\+api\.[jt]sx?$/;

/** <scope>.<element>[.<part-or-key>...]: kebab segments, at least two; `{camelCase}` stands for a data key. */
export const CONTRACT_ID = /^[a-z0-9]+(-[a-z0-9]+)*(\.([a-z0-9]+(-[a-z0-9]+)*|\{[a-z][A-Za-z0-9]*\}))+$/;
/** A testID in code: kebab segments, at least two. */
export const TESTID_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COPY_KEY = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

/** Repo-relative contract path: --contract, then rn-skills.config.json screensContract, then <contractsDir>/screens.json. */
export function contractPathOf(layout, given) {
  return toPosix(given ?? layout.config?.[CONFIG_KEY] ?? `${layout.contractsDir}/screens.json`);
}

/** The 1-based line of the first `"key": "value"` in the raw JSON text (1 when absent). */
export function jsonLine(text, key, value) {
  const at = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"${escapeRegExp(String(value))}"`).exec(text);
  return at === null ? 1 : text.slice(0, at.index).split('\n').length;
}

function isRepoPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.split('/').includes('..') && !/^[A-Za-z]:/.test(value);
}

function readJsonFile(root, rel, what) {
  const abs = join(root, rel);
  try {
    return { text: readFileSync(abs, 'utf8'), data: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (error) {
    return fail(`${what} ${rel} is not valid JSON (${error.message})`, `Fix the JSON syntax of ${rel}; its schema sits next to it.`);
  }
}

/** The source language from <i18nDir>/languages.ts (SOURCE_LANGUAGE = 'en'), else 'en'. */
export function sourceLanguageOf(root, layout) {
  const file = join(root, layout.i18nDir, 'languages.ts');
  if (!existsSync(file)) return 'en';
  const match = /\bSOURCE_LANGUAGE\b[^=]*=\s*['"]([A-Za-z0-9-]+)['"]/.exec(readFileSync(file, 'utf8'));
  return match ? match[1] : 'en';
}

/** Parts each component derives from its testID: the component catalogue, then the contract's `components`. */
function componentTable(root, layout, data, problems, text) {
  const table = new Map();
  const catalogueRel = toPosix(data.componentCatalog ?? `${layout.contractsDir}/component-library.json`);
  let catalogueFound = false;
  if (existsSync(join(root, catalogueRel))) {
    catalogueFound = true;
    const { data: catalogue } = readJsonFile(root, catalogueRel, 'the component catalogue');
    for (const entry of Array.isArray(catalogue?.components) ? catalogue.components : []) {
      if (typeof entry?.name !== 'string') continue;
      table.set(entry.name, { parts: Array.isArray(entry.parts) ? entry.parts : [], keyed: DEFAULT_KEYED.includes(entry.name), modalRoot: entry.modalRoot === true });
    }
  } else if (data.componentCatalog !== undefined) {
    problems.push({ line: jsonLine(text, 'componentCatalog', data.componentCatalog), message: `componentCatalog names ${catalogueRel}, which does not exist`, fix: 'Point componentCatalog at the component catalogue (ui-component-library writes contracts/component-library.json), or remove the key.' });
  }
  for (const [name, entry] of Object.entries(data.components ?? {})) {
    if (!/^[A-Z][A-Za-z0-9.]*$/.test(name) || typeof entry !== 'object' || entry === null || (entry.parts !== undefined && !Array.isArray(entry.parts))) {
      problems.push({ line: 1, message: `components.${name} must be { "parts": [...], "keyed": true|false } under a PascalCase component name`, fix: 'Fix the components entry (references/contract-format.md, "Derived parts").' });
      continue;
    }
    const base = table.get(name) ?? { parts: [], keyed: DEFAULT_KEYED.includes(name) };
    table.set(name, { parts: entry.parts ?? base.parts, keyed: entry.keyed ?? base.keyed });
  }
  return { table, catalogueRel, catalogueFound };
}

/** Validate one screen and index it; problems are pushed as { line, message, fix }. */
function indexScreen(screen, ctx) {
  const { text, problems, seenIds } = ctx;
  const line = jsonLine(text, 'id', screen?.id);
  const bad = (message, fix, at = line) => problems.push({ line: at, message, fix });
  if (typeof screen?.id !== 'string' || !KEBAB.test(screen.id)) return bad(`a screen has no kebab-case id (${JSON.stringify(screen?.id)})`, 'Give every screen a kebab-case "id" (lists, task-detail, delete-list-dialog).');
  if (seenIds.has(screen.id)) bad(`screen id "${screen.id}" is listed twice`, 'Keep one entry per screen.');
  seenIds.add(screen.id);
  const where = `screen "${screen.id}"`;
  if (!PRESENTATIONS.includes(screen.presentation)) bad(`${where} has presentation ${JSON.stringify(screen.presentation)}`, `Use one of ${PRESENTATIONS.join(', ')}.`);
  for (const key of ['view', 'route', 'model', 'test']) {
    if (screen[key] !== undefined && !isRepoPath(screen[key])) bad(`${where} ${key} ${JSON.stringify(screen[key])} is not a repo-relative path`, 'Write repo-relative paths without .. (src/features/lists/lists-screen.tsx).');
  }
  if (!isRepoPath(screen.view)) bad(`${where} names no view file`, 'Set "view" to the pure view (src/features/<feature>/<feature>-screen.tsx).');
  if (ROUTED.has(screen.presentation)) {
    if (!isRepoPath(screen.route)) bad(`${where} is a ${screen.presentation} but names no route file`, 'Set "route" to its Expo Router file (src/app/...).');
    if (!isRepoPath(screen.model)) bad(`${where} is a ${screen.presentation} but names no model hook`, 'Set "model" to its use-<feature>-model.ts.');
  }
  const code = Array.isArray(screen.code) && screen.code.length > 0 ? screen.code : isRepoPath(screen.view) ? [`${screen.view.slice(0, screen.view.lastIndexOf('/') + 1)}`] : [];
  for (const entry of code) if (!isRepoPath(entry)) bad(`${where} code entry ${JSON.stringify(entry)} is not a repo-relative path`, 'List folders ("src/features/lists/"), shallow folders ("src/features/settings/*") or files.');
  const scopes = Array.isArray(screen.scopes) && screen.scopes.length > 0 ? screen.scopes : [screen.id];
  for (const scope of scopes) {
    if (!KEBAB.test(scope)) bad(`${where} scope ${JSON.stringify(scope)} is not kebab-case`, 'A scope is the first testID segment: kebab-case.');
    const owner = ctx.scopeOwner.get(scope);
    if (owner !== undefined && owner !== screen.id) bad(`scope "${scope}" belongs to both ${owner} and ${screen.id}`, 'Give each screen its own scopes: one scope, one owner.');
    ctx.scopeOwner.set(scope, screen.id);
  }
  const states = Array.isArray(screen.states) && screen.states.length > 0 ? screen.states : null;
  if (states === null) bad(`${where} lists no states`, 'List every state, the default first: [{ "id": "default" }, { "id": "empty", "drawn": false, "why": "..." }].');
  const stateIds = new Set();
  for (const state of states ?? []) {
    if (typeof state?.id !== 'string' || !KEBAB.test(state.id)) bad(`${where} has a state without a kebab-case id`, 'Give each state a kebab-case "id".');
    else if (stateIds.has(state.id)) bad(`${where} lists state "${state.id}" twice`, 'Keep one entry per state.');
    else stateIds.add(state.id);
    if (state?.drawn === false && (typeof state.why !== 'string' || state.why.trim() === '')) bad(`${where} state "${state.id}" is not drawn by the design but gives no "why"`, 'Say why the state exists and how it was decided ("why": "Chosen: ...").', jsonLine(text, 'id', state.id));
    if (state?.reference !== undefined && !isRepoPath(state.reference)) bad(`${where} state "${state.id}" reference ${JSON.stringify(state.reference)} is not a relative path`, 'Name the image file inside the references folder (lists-default.png).');
  }
  const elements = Array.isArray(screen.elements) ? screen.elements : [];
  if (elements.length === 0) bad(`${where} lists no elements`, 'List every element the design shows (and every Chosen one) with its testID.');
  const byCanon = new Map();
  const indexed = [];
  for (const element of elements) {
    const at = jsonLine(text, 'testID', element?.testID);
    if (typeof element?.testID !== 'string' || !CONTRACT_ID.test(element.testID)) {
      bad(`${where} element ${JSON.stringify(element?.testID)} is not a testID (<scope>.<element>[.<part-or-key>...], kebab segments, {param} for a data key)`, 'Fix the testID shape (naming-conventions owns the grammar).', at);
      continue;
    }
    const canon = element.testID.replace(/\{[a-zA-Z0-9]+\}/g, '*');
    if (!scopes.includes(element.testID.split('.')[0])) bad(`${where} element ${element.testID} is outside its scopes (${scopes.join(', ')})`, 'Start the testID with one of the screen\'s scopes, or add the scope.', at);
    const elementStates = Array.isArray(element.states) ? element.states : null;
    for (const state of elementStates ?? []) if (!stateIds.has(state)) bad(`${where} element ${element.testID} names state "${state}", which the screen does not list`, `Use the screen's states (${[...stateIds].join(', ')}).`, at);
    for (const key of ['text', 'a11yLabel']) {
      if (element[key] !== undefined && element[key] !== null && (typeof element[key] !== 'string' || !COPY_KEY.test(element[key]))) bad(`${where} element ${element.testID} ${key} ${JSON.stringify(element[key])} is not a copy key`, 'Use the catalog key (<area>.<element>[.<variant>]), or leave the field out for data text.', at);
    }
    if (element.textVia !== undefined && !isRepoPath(element.textVia)) bad(`${where} element ${element.testID} textVia ${JSON.stringify(element.textVia)} is not a repo-relative path`, 'Name the module that renders the key (src/i18n/format-date.ts).', at);
    const previous = byCanon.get(canon);
    if (previous !== undefined) {
      const overlap = (previous.states ?? [...stateIds]).some((state) => (elementStates ?? [...stateIds]).includes(state));
      if (overlap) bad(`${where} lists ${element.testID} twice for the same state`, 'List an element once per state; a second entry needs disjoint "states".', at);
    }
    const entry = { ...element, canon, regex: canonicalRegExp(canon), states: elementStates, line: at };
    if (previous === undefined) byCanon.set(canon, entry);
    indexed.push(entry);
  }
  for (const entry of indexed) {
    for (const key of ['parent', 'coveredBy']) {
      if (entry[key] !== undefined && !byCanon.has(String(entry[key]).replace(/\{[a-zA-Z0-9]+\}/g, '*'))) bad(`${where} element ${entry.testID} ${key} "${entry[key]}" is not an element of this screen`, `Name an element of ${screen.id} in "${key}".`, entry.line);
    }
  }
  const test = screen.test ?? (isRepoPath(screen.view) ? screen.view.replace(/\.tsx?$/, '.test.tsx') : null);
  return { ...screen, code, scopes, states: states ?? [{ id: 'default' }], stateIds, elements: indexed, byCanon, test, line };
}

/**
 * Load the contract. Returns null when it does not exist; exits 2 on malformed JSON. Structural
 * problems come back in `problems` ({ line, message, fix }) for the contract-invalid rule.
 */
export function loadContract(root, { contract: given } = {}) {
  const layout = resolveLayout(root);
  const rel = contractPathOf(layout, given);
  if (!existsSync(join(root, rel))) return { layout, rel, missing: true };
  if (statSync(join(root, rel)).isDirectory()) fail(`${rel} is a folder, not the screen contract`, 'Point --contract at contracts/screens.json.');
  const { text, data } = readJsonFile(root, rel, 'the screen contract');
  const problems = [];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) fail(`${rel} is not a JSON object`, 'Start from the template contracts/screens.json.');
  if (data.version !== 1) problems.push({ line: 1, message: `version is ${JSON.stringify(data.version)}, expected 1`, fix: 'Set "version": 1 (the format this skill reads).' });
  if (!Array.isArray(data.screens) || data.screens.length === 0) problems.push({ line: 1, message: 'the contract lists no screens', fix: 'List every screen of the app under "screens".' });
  const components = componentTable(root, layout, data, problems, text);
  const ctx = { text, problems, seenIds: new Set(), scopeOwner: new Map() };
  const screens = new Map();
  for (const screen of Array.isArray(data.screens) ? data.screens : []) {
    const indexed = indexScreen(screen, ctx);
    if (indexed !== undefined && !screens.has(indexed.id)) screens.set(indexed.id, indexed);
  }
  const policies = policiesOf(data, screens, problems, text);
  // A component the catalogue marks as the modal root (ui-component-library's Scrim) keeps screen readers inside too.
  for (const [name, entry] of components.table) if (entry.modalRoot && !policies.modalRoots.includes(name)) policies.modalRoots.push(name);
  const ignoredRoutes = [];
  for (const entry of Array.isArray(data.ignoredRoutes) ? data.ignoredRoutes : []) {
    const at = jsonLine(text, 'file', entry?.file);
    if (!isRepoPath(entry?.file) || typeof entry?.why !== 'string' || entry.why.trim() === '') problems.push({ line: at, message: `ignoredRoutes entry ${JSON.stringify(entry)} needs "file" and "why"`, fix: 'Write { "file": "src/app/...", "why": "redirect only" }.' });
    else if (!existsSync(join(root, entry.file))) problems.push({ line: at, message: `ignoredRoutes names ${entry.file}, which does not exist`, fix: 'Remove the stale entry.' });
    else ignoredRoutes.push(entry.file);
  }
  const language = sourceLanguageOf(root, layout);
  const catalogRel = toPosix(data.sourceCatalog ?? `${layout.i18nDir}/catalogs/${language}.json`);
  const catalog = existsSync(join(root, catalogRel)) ? readJsonFile(root, catalogRel, 'the source catalog').data : null;
  const referencesDir = toPosix(data.references ?? 'design/screens');
  return { layout, rel, text, data, problems, screens, scopeOwner: ctx.scopeOwner, components, policies, ignoredRoutes, catalogRel, catalog, referencesDir, language };
}

function policiesOf(data, screens, problems, text) {
  const raw = data.policies ?? {};
  const primary = raw.primaryAction ?? null;
  const match = Array.isArray(primary?.match) ? primary.match : [];
  for (const entry of match) {
    if (typeof entry?.component !== 'string' || typeof entry?.prop !== 'string' || typeof entry?.value !== 'string') problems.push({ line: jsonLine(text, 'component', entry?.component), message: `policies.primaryAction.match entry ${JSON.stringify(entry)} needs component, prop and value`, fix: 'Write { "component": "Button", "prop": "variant", "value": "primary" }.' });
  }
  const adSlot = raw.adSlot ?? null;
  for (const id of adSlot?.screens ?? []) if (!screens.has(id)) problems.push({ line: 1, message: `policies.adSlot.screens names "${id}", which is not a screen of the contract`, fix: 'Name screen ids from "screens".' });
  return {
    primaryAction: primary === null ? null : { max: Number.isInteger(primary.max) && primary.max > 0 ? primary.max : 1, match: match.filter((entry) => typeof entry?.component === 'string') },
    adSlot: adSlot === null ? null : { components: Array.isArray(adSlot.components) ? adSlot.components : [], screens: new Set(adSlot.screens ?? []) },
    modalRoots: Array.isArray(raw.modalRoots) ? raw.modalRoots : [...DEFAULT_MODAL_ROOTS],
    retiredKeys: raw.retiredKeys && typeof raw.retiredKeys === 'object' ? raw.retiredKeys : {},
  };
}

/** The files one code entry names: [{ rel, abs, depth }] (depth = the entry's folder depth, for ownership). */
function entryFiles(root, entry) {
  const isShallow = entry.endsWith('/*');
  const path = isShallow ? entry.slice(0, -2) : entry.replace(/\/$/, '');
  const abs = join(root, path);
  if (!existsSync(abs)) return [];
  const depth = path.split('/').length;
  if (statSync(abs).isFile()) return [{ rel: path, abs, depth: Number.MAX_SAFE_INTEGER }];
  return walk(abs, { include: ['*.ts', '*.tsx'], pruneDirsContaining: ['SKILL.md'] })
    .filter((rel) => !isShallow || !rel.includes('/'))
    .map((rel) => ({ rel: toPosix(join(path, rel)), abs: join(abs, rel), depth }));
}

/**
 * Every .ts/.tsx file of each screen, as Map<screenId, [{ rel, abs }]>. A file belongs to the screen
 * whose code entry is the most specific (a file entry, else the deepest folder): the delete dialog
 * in src/features/lists/delete-list-dialog/ is the dialog's code, not the Lists screen's, although
 * the Lists folder contains it. Folders holding a SKILL.md (installed skills) are pruned.
 */
export function assignScreenFiles(root, screens) {
  const owner = new Map();
  for (const screen of screens) {
    for (const entry of screen.code) {
      for (const file of entryFiles(root, entry)) {
        const current = owner.get(file.rel);
        if (current === undefined || file.depth > current.depth) owner.set(file.rel, { ...file, screen: screen.id });
      }
    }
  }
  const files = new Map(screens.map((screen) => [screen.id, []]));
  for (const file of [...owner.values()].sort((a, b) => a.rel.localeCompare(b.rel))) files.get(file.screen).push({ rel: file.rel, abs: file.abs });
  return files;
}

export function isTestFile(rel) {
  return /\.(?:test|spec)\.[jt]sx?$/.test(rel) || rel.includes('/__tests__/');
}

/** The nearest element of the same screen whose canonical id is a segment prefix of `canon`. */
export function structuralParent(screen, canon) {
  const segments = canon.split('.');
  for (let cut = segments.length - 1; cut >= 2; cut -= 1) {
    const candidate = screen.byCanon.get(segments.slice(0, cut).join('.'));
    if (candidate) return { element: candidate, rest: segments.slice(cut) };
  }
  return null;
}

/**
 * How a part is drawn by a component from its parent's testID: { component, parent, keyed } or null.
 * `rest` is the id after the parent: a part (['label']), a data key (['done']), or a key and a part.
 */
export function derivationOf(contract, screen, canon) {
  const parent = structuralParent(screen, canon);
  if (parent === null) return null;
  const rule = contract.components.table.get(parent.element.component);
  if (rule === undefined) return null;
  const { rest } = parent;
  if (rest.length === 1 && rule.parts.includes(rest[0])) return { component: parent.element.component, parent: parent.element, keyed: false, key: null };
  if (!rule.keyed) return null;
  if (rest.length === 1) return { component: parent.element.component, parent: parent.element, keyed: true, key: rest[0] };
  if (rest.length === 2 && rule.parts.includes(rest[1])) return { component: parent.element.component, parent: parent.element, keyed: true, key: rest[0] };
  return null;
}

/** Repo route files under routesDir that are screens (no layouts, API routes, tests); the repo walk prunes installed skills. */
export function routeFiles(root, layout) {
  if (!existsSync(join(root, layout.routesDir))) return [];
  const prefix = `${layout.routesDir}/`;
  return walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx'] })
    .filter((rel) => rel.startsWith(prefix))
    .filter((rel) => !isTestFile(rel) && !rel.endsWith('.d.ts') && !NON_SCREEN_ROUTE.test(rel));
}

/** "src/features/lists/use-lists-model.ts" -> "useListsModel". */
export function hookNameOf(modelPath) {
  const base = modelPath.slice(modelPath.lastIndexOf('/') + 1).replace(/\.[jt]sx?$/, '');
  return base.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

/** The text of a copy key in a catalog, or null. */
export function catalogText(catalog, key) {
  return catalog !== null && typeof catalog?.[key] === 'string' ? catalog[key] : null;
}
