// names.mjs: name-case helpers and the library's name grammars (assets/naming-rules.json), shared
// by check-file-names.mjs and check-code-names.mjs (a helper, not an entry point).

import { readFileSync } from 'node:fs';

// This file sits in scripts/lib/; the data sits in the skill's assets/ folder.
const SCRIPTS_DIR = new URL('..', import.meta.url);
export const RULES = JSON.parse(readFileSync(new URL('../assets/naming-rules.json', SCRIPTS_DIR), 'utf8'));

export const KEBAB = new RegExp(RULES.kebabSegment);
export const TEST_ID = new RegExp(RULES.testId);
export const I18N_KEY = new RegExp(RULES.i18nKey);
export const APP_ID = new RegExp(RULES.appId);
export const PRODUCT_ID = new RegExp(RULES.productId);
export const LOCALE_TAG = new RegExp(RULES.localeTag);
export const NPM_SCRIPT = new RegExp(RULES.npmScript);
export const ENV_VAR = new RegExp(RULES.envVar);
export const TEST_TITLE = new RegExp(RULES.testTitle);
export const MIME_TYPE = new RegExp(RULES.mimeType);

/** 'use-tasks-model' -> 'useTasksModel' */
export function camelFromKebab(kebab) {
  return kebab.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

/** 'task-row' -> 'TaskRow' */
export function pascalFromKebab(kebab) {
  const camel = camelFromKebab(kebab);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** 'ClockPort' -> 'clock-port', 'SqlDriver' -> 'sql-driver' */
export function kebabFromPascal(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** Base name without the folder and every extension: 'task-list.test.ts' -> 'task-list'. */
export function stem(fileName) {
  return fileName.split('/').pop().split('.')[0];
}

export const isUpperSnake = (name) => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(name);
export const isPascal = (name) => /^[A-Z][A-Za-z0-9]*$/.test(name);
export const isCamel = (name) => /^[a-z][A-Za-z0-9]*$/.test(name);

/** True when a name has a run of 3+ capitals, like SQLDriver or isRTL (acronyms are words). */
export function hasAcronymRun(name) {
  if (isUpperSnake(name)) return false;
  return /[A-Z]{3,}/.test(name.replace(/^_+/, ''));
}

/** A boolean name starts with a prefix (isReady, hasHint) or, in UPPER_CASE, with IS_, HAS_... */
export function hasBooleanPrefix(name) {
  const bare = name.replace(/^_+/, '');
  return RULES.booleanPrefixes.some((prefix) => new RegExp(`^${prefix}[A-Z0-9]`).test(bare) || bare.startsWith(`${prefix.toUpperCase()}_`));
}

const ROUTE_PARAM = /^\[(\.\.\.)?([a-z][A-Za-z0-9]*)\]$/;
const ROUTE_GROUP = /^\(([a-z0-9]+(-[a-z0-9]+)*)(,[a-z0-9]+(-[a-z0-9]+)*)*\)$/;

/**
 * Why an Expo Router file or folder name breaks the router grammar with kebab-case segments, or
 * null when it is fine. Files: _layout, index, +not-found (and other +special names), <segment>+api,
 * [param], [...rest], kebab-case segments; platform and middle extensions are allowed
 * (about.web.tsx). Folders: kebab-case segments, (group) or (a,b) groups, [param], [...rest].
 * Params are camelCase because they become the keys of useLocalSearchParams().
 */
export function routeNameProblem(name, { isFolder }) {
  // "[...rest].tsx": the brackets may hold dots, so the base runs to the closing bracket.
  const [, base, extensions] = isFolder ? [null, name, ''] : /^(\[[^\]]*\]|[^.]*)(.*)$/.exec(name);
  const bad = extensions.split('.').slice(1).find((piece) => !KEBAB.test(piece));
  if (bad !== undefined) return `extension part "${bad}" is not kebab-case`;
  if (!isFolder && RULES.routeSpecialNames.includes(base)) return null;
  if (!isFolder && /^\+[a-z]+(-[a-z]+)*$/.test(base)) return null;
  if (!isFolder && /^[a-z0-9]+(-[a-z0-9]+)*\+api$/.test(base)) return null;
  if (isFolder && ROUTE_GROUP.test(base)) return null;
  if (base.startsWith('(')) return isFolder ? `group "${base}" is not (kebab-case)` : `"${base}" is a group name on a file`;
  if (base.startsWith('[')) return ROUTE_PARAM.test(base) ? null : `param "${base}" is not [camelCase] or [...camelCase]`;
  return KEBAB.test(base) ? null : `segment "${base}" is not kebab-case`;
}
