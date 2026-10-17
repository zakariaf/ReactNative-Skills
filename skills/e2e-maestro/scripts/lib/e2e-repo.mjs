// e2e-repo.mjs: what the e2e-maestro checkers read from an app repo (a helper, not an entry point).
//
// - e2eApps(root, overrides): the Expo apps to check: the repo root, or each workspace of package.json
//   "workspaces" (When multi-package), each with its resolveLayout() folders (e2eDir, contractsDir,
//   scriptsDir are repo-relative).
// - isAdopted(root, app): the app has started E2E (an e2e folder, contracts/e2e.json or an e2e:* npm
//   script). Before that the checkers print NOT APPLICABLE; after it they are strict.
// - readContract(root, app): contracts/e2e.json parsed, with its validation problems.
// - manualFolders, debugLinks, knownTestIds: the facts check-flows reads from the app's contracts
//   (contracts/e2e.json, contracts/naming.json extraE2eFolders, contracts/debug-links.json,
//   contracts/screens.json and its component catalogue).

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { resolveLayout } from '../check-lib.mjs';

/** Tags every app may use; contracts/e2e.json "tags" and the manual folder names add to them. */
export const BASE_TAGS = Object.freeze(['smoke', 'journeys', 'offline', 'rtl', 'a11y', 'quarantine', 'screenshots']);
/** Roles whose element is one accessible node: a part inside it never reaches Maestro's tree. */
const ACCESSIBLE_ROLES = new Set(['button', 'checkbox', 'switch', 'link', 'radio', 'tab', 'menuitem', 'togglebutton', 'combobox', 'adjustable', 'imagebutton']);
const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** The apps to check: the root app, or every workspace (When multi-package). */
export function e2eApps(root, overrides = {}) {
  const layout = resolveLayout(root, overrides);
  if (layout.workspaces.length === 0) return [{ dir: '', label: '.', layout }];
  return layout.workspaces.map((workspace) => ({ dir: workspace.dir, label: workspace.dir, layout: workspace.layout }));
}

/** A repo file as text, or null. */
export function readRepoText(root, rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** A repo JSON file: { data } , { error } (not JSON) or null (missing). */
export function readRepoJson(root, rel) {
  const text = readRepoText(root, rel);
  if (text === null) return null;
  try {
    return { data: JSON.parse(text) };
  } catch (error) {
    return { error: error.message };
  }
}

const appRel = (app, rel) => (app.dir === '' ? rel : posix.join(app.dir, rel));
export const packageJsonOf = (app) => appRel(app, 'package.json');
export const contractRel = (app, name) => posix.join(app.layout.contractsDir, name);

/** The app started E2E: an e2e folder, contracts/e2e.json or an e2e:* / screenshots:* npm script. */
export function isAdopted(root, app) {
  if (existsSync(join(root, app.layout.e2eDir))) return true;
  if (existsSync(join(root, contractRel(app, 'e2e.json')))) return true;
  const pkg = readRepoJson(root, packageJsonOf(app))?.data;
  return Object.keys(pkg?.scripts ?? {}).some((name) => /^(e2e|screenshots)(:|$)/.test(name));
}

const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '');

/** Validation problems of contracts/e2e.json (the keys the runner and the checkers need). */
export function contractProblems(data) {
  const problems = [];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return ['is not a JSON object'];
  if (!isStringList(data.productionAppIds) || data.productionAppIds.length === 0) problems.push('"productionAppIds" must list the store app id(s): the runner refuses those builds (no debug link in them)');
  const network = data.network;
  if (network === undefined || network === null || typeof network !== 'object') problems.push('"network" is missing: say which runtime network proof applies (offline-only, allowlist with allowHosts, or off with why)');
  else if (!['offline-only', 'allowlist', 'off'].includes(network.mode)) problems.push(`"network.mode" is ${JSON.stringify(network.mode ?? null)}, not offline-only, allowlist or off`);
  else if (network.mode === 'allowlist' && (!isStringList(network.allowHosts) || network.allowHosts.length === 0)) problems.push('"network.mode" allowlist needs "allowHosts" (the hosts the test build may reach)');
  else if (network.mode === 'off' && (typeof network.why !== 'string' || network.why.trim() === '')) problems.push('"network.mode" off needs "why" (there is then no runtime network proof)');
  for (const [index, entry] of (Array.isArray(data.manualFolders) ? data.manualFolders : []).entries()) {
    if (typeof entry?.folder !== 'string' || !new RegExp(`^${SEGMENT}$`).test(entry.folder) || ['flows', 'subflows', 'screenshots', 'baselines'].includes(entry.folder)) problems.push(`"manualFolders[${index}].folder" must be a kebab-case folder other than flows, subflows, screenshots and baselines`);
    if (typeof entry?.why !== 'string' || entry.why.trim() === '') problems.push(`"manualFolders[${index}].why" is missing`);
  }
  if (data.manualFolders !== undefined && !Array.isArray(data.manualFolders)) problems.push('"manualFolders" must be a list');
  if (data.largeText !== undefined && !isStringList(data.largeText?.locales)) problems.push('"largeText.locales" must list locales');
  if (data.screenshots !== undefined && (!isStringList(data.screenshots?.locales) || data.screenshots.locales.length === 0)) problems.push('"screenshots.locales" must list the matrix locales');
  return problems;
}

/** contracts/e2e.json: { rel, data, problems } (data null when missing or not JSON). */
export function readContract(root, app) {
  const rel = contractRel(app, 'e2e.json');
  const read = readRepoJson(root, rel);
  if (read === null) return { rel, data: null, problems: ['is missing'] };
  if (read.error !== undefined) return { rel, data: null, problems: [`is not valid JSON: ${read.error}`] };
  return { rel, data: read.data, problems: contractProblems(read.data) };
}

/** Folders of flows the runner never lists: contracts/e2e.json manualFolders + naming.json extraE2eFolders. */
export function manualFolders(root, app, contract) {
  const folders = new Map();
  for (const entry of Array.isArray(contract?.manualFolders) ? contract.manualFolders : []) {
    if (typeof entry?.folder === 'string') folders.set(entry.folder, { startsOutside: entry.startsOutside === true, requiredParams: Array.isArray(entry.requiredParams) ? entry.requiredParams : [], source: 'contracts/e2e.json' });
  }
  const naming = readRepoJson(root, contractRel(app, 'naming.json'))?.data;
  for (const entry of Array.isArray(naming?.extraE2eFolders) ? naming.extraE2eFolders : []) {
    if (typeof entry?.folder === 'string' && entry.folder !== 'screenshots' && !folders.has(entry.folder)) folders.set(entry.folder, { startsOutside: false, requiredParams: [], source: 'contracts/naming.json' });
  }
  return folders;
}

/** contracts/debug-links.json (debug-menu-and-test-hooks): { rel, params } (params null when missing). */
export function debugLinks(root, app) {
  const rel = contractRel(app, 'debug-links.json');
  const data = readRepoJson(root, rel)?.data;
  return { rel, path: typeof data?.path === 'string' ? data.path : 'debug/setup', params: data?.params && typeof data.params === 'object' ? data.params : null };
}

/** A testID template (tasks.task-row.{taskId}) as a whole-id regular expression. */
function templateRegExp(testID) {
  const source = testID.split('.').map((part) => (/^\{[A-Za-z][A-Za-z0-9]*\}$/.test(part) ? SEGMENT : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('\\.');
  return new RegExp(`^${source}$`);
}

/** Parts a component derives from its element's testID (<id>.<part>), from screens.json and the catalogue. */
function componentParts(root, app, screens) {
  const parts = new Map();
  const add = (name, entry) => {
    if (typeof name !== 'string' || !entry) return;
    parts.set(name, { parts: Array.isArray(entry.parts) ? entry.parts : [], keyed: entry.keyed === true });
  };
  const catalogRel = typeof screens.componentCatalog === 'string' ? screens.componentCatalog : contractRel(app, 'component-library.json');
  const catalog = readRepoJson(root, catalogRel)?.data;
  for (const entry of Array.isArray(catalog?.components) ? catalog.components : []) add(entry?.name, entry);
  for (const [name, entry] of Object.entries(screens.components ?? {})) add(name, entry);
  return parts;
}

/**
 * Every testID a flow may use: contracts/screens.json elements (with {key} segments), the parts their
 * components derive, and contracts/e2e.json extraTestIDs. `unreachable` maps a crop-only id (a part
 * inside an accessible element, or hidden from screen readers) to { why, use }.
 * Returns null when contracts/screens.json does not exist yet.
 */
export function knownTestIds(root, app, contract) {
  const rel = contractRel(app, 'screens.json');
  const read = readRepoJson(root, rel);
  if (read === null || read.error !== undefined) return null;
  const screens = read.data ?? {};
  const known = { rel, literal: new Set(), templates: [], unreachable: new Map() };
  const addId = (id, unreachable) => {
    if (id.includes('{')) known.templates.push({ id, regex: templateRegExp(id), unreachable });
    else {
      known.literal.add(id);
      if (unreachable) known.unreachable.set(id, unreachable);
    }
  };
  const parts = componentParts(root, app, screens);
  for (const screen of Array.isArray(screens.screens) ? screens.screens : []) {
    for (const element of Array.isArray(screen?.elements) ? screen.elements : []) {
      if (typeof element?.testID !== 'string') continue;
      const hidden = element.parent ? { why: `a part inside ${element.parent}`, use: element.coveredBy ?? element.parent } : element.a11yHidden === true ? { why: 'hidden from screen readers (decorative)', use: element.coveredBy ?? null } : null;
      addId(element.testID, hidden);
      const derived = parts.get(element.component);
      if (!derived) continue;
      const isAccessible = ACCESSIBLE_ROLES.has(String(element.role ?? '').toLowerCase());
      const base = derived.keyed ? `${element.testID}.{key}` : element.testID;
      if (derived.keyed) addId(base, null);
      for (const part of derived.parts) addId(`${base}.${part}`, isAccessible ? { why: `a part inside the accessible ${element.testID}`, use: base } : null);
    }
  }
  for (const id of Object.keys(contract?.extraTestIDs ?? {})) addId(id, null);
  return known;
}

/** The entry for a literal id: { known, unreachable } (unreachable null when Maestro can list it). */
export function lookupTestId(known, id) {
  if (known.literal.has(id)) return { known: true, unreachable: known.unreachable.get(id) ?? null };
  const template = known.templates.find((entry) => entry.regex.test(id));
  if (template === undefined) return { known: false, unreachable: null };
  // A part of a keyed or templated element: name the concrete element the id sits inside.
  const concrete = (use) => (typeof use === 'string' && use.includes('{') ? id.split('.').slice(0, -1).join('.') : use);
  const unreachable = template.unreachable ? { why: template.unreachable.why.replace(/\S*\{[A-Za-z]+\}\S*/, concrete(template.unreachable.use)), use: concrete(template.unreachable.use) } : null;
  return { known: true, unreachable };
}

/** True when an id pattern (a Maestro regular expression) matches at least one known id. */
export function patternMatchesKnown(known, pattern) {
  if ([...known.literal].some((id) => pattern.test(id))) return true;
  return known.templates.some((entry) => pattern.test(entry.id.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name) => name.toLowerCase())));
}
