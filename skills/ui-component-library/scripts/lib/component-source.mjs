// component-source.mjs: helpers for check-components.mjs and write-component-specs.mjs: the app's
// component catalogue (contracts/component-library.json), the component specs derived from the
// token file's components block, and small source scanners (StyleSheet entries, prop types, JSX).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, maskComments, matchGlob, walkRepo } from '../check-lib.mjs';

export const CONTRACT_NAME = 'component-library.json';

/** Files of other skills the library builds on; a missing one breaks every component that imports it. */
export const DEFAULT_PREREQUISITES = Object.freeze([
  { file: '{themeDir}/tokens.ts', owner: 'design-system-structure' },
  { file: '{themeDir}/make-styles.ts', owner: 'design-system-structure' },
  { file: '{themeDir}/use-theme.ts', owner: 'design-system-structure' },
  { file: '{themeDir}/type-styles.ts', owner: 'design-system-structure' },
  { file: '{themeDir}/motion.ts', owner: 'design-system-structure' },
  { file: '{themeDir}/shadow-styles.ts', owner: 'design-system-structure' },
  { file: '{themeDir}/use-text-locale.ts', owner: 'design-system-structure' },
  { file: '{uiDir}/app-text.tsx', owner: 'design-system-structure' },
  { file: '{uiDir}/pressable-surface.tsx', owner: 'design-system-structure' },
  { file: '{uiDir}/press-feedback-context.tsx', owner: 'design-system-structure' },
  { file: '{testDir}/render-with-providers.tsx', owner: 'unit-and-component-tests' },
  { file: '{testDir}/a11y/find-inaccessible-pressables.ts', owner: 'accessibility-as-code' },
]);

/** The one press implementation (design-system-structure's PressableSurface). */
export const DEFAULT_PRESS_HOSTS = Object.freeze(['pressable-surface.tsx']);
/**
 * Folders of src/ui other skills own: the accessibility hooks, the icon set, the motion moments, the
 * list-detail layout (adaptive-layout) and the feedback ladder (ui-states-and-feedback).
 */
export const DEFAULT_EXCLUDE = Object.freeze(['a11y/**', 'icons/**', 'motion/**', 'adaptive/**', 'feedback/**']);

/**
 * Single files in the ui folder that other skills create and keep (not library components): never
 * discovered, never catalogue-missing, never unlisted. A catalogue's `ownedElsewhere` adds to these.
 * SubtreeErrorBoundary is a class on purpose (React has no hook that catches a render error).
 */
export const DEFAULT_OWNED_ELSEWHERE = Object.freeze([
  { file: '{uiDir}/screen-frame.tsx', owner: 'react-components-and-hooks' },
  { file: '{uiDir}/subtree-error-boundary.tsx', owner: 'react-components-and-hooks' },
  { file: '{uiDir}/physical-direction-view.tsx', owner: 'rtl-and-direction' },
  { file: '{uiDir}/screen-body.tsx', owner: 'screen-contracts' },
  { file: '{uiDir}/ad-banner-slot.tsx', owner: 'admob-ads-and-consent' },
  { file: '{uiDir}/parity-launch-marker.tsx', owner: 'design-visual-parity' },
]);
export const TESTID_KINDS = Object.freeze(['required', 'optional', 'none']);
const FLAG_KEYS = Object.freeze(['hidesItself', 'mayRotate', 'mayShadow', 'inPairCell', 'modalRoot', 'drawnUnderline', 'holdFill', 'scatter']);
const ENTRY_KEYS = new Set(['name', 'file', 'role', 'testID', 'parts', 'notes', ...FLAG_KEYS]);
const CONTRACT_KEYS = new Set(['$schema', '$comment', 'uiDir', 'exclude', 'specs', 'prerequisites', 'ownedElsewhere', 'pressHosts', 'components', 'mockOnly']);
const SPECS_KEYS = new Set(['tokens', 'block', 'out', 'module', 'asRenderedBorders', 'overrides']);

function readJson(path, what) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new UsageError(`${what} cannot be read: ${error.message}`, `Check ${path}.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${what} is not valid JSON: ${error.message.split('\n')[0]}`, `Fix ${path} (plain JSON, no comments).`);
  }
}

function bad(path, message) {
  throw new UsageError(`${path}: ${message}`, 'Fix the catalogue; the template and its schema (contracts/component-library.schema.json) show every key.');
}

function checkEntry(path, entry, index) {
  const at = `components[${index}]`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) bad(path, `${at} is not an object`);
  for (const key of Object.keys(entry)) if (!ENTRY_KEYS.has(key)) bad(path, `${at} has an unknown key "${key}"`);
  if (typeof entry.name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(entry.name)) bad(path, `${at}.name must be a PascalCase component name`);
  if (typeof entry.file !== 'string' || !/\.tsx$/.test(entry.file) || entry.file.includes('..') || entry.file.startsWith('/')) bad(path, `${at}.file must be a .tsx path relative to the ui folder`);
  if (entry.testID !== undefined && !TESTID_KINDS.includes(entry.testID)) bad(path, `${at}.testID must be one of ${TESTID_KINDS.join(', ')}`);
  if (entry.parts !== undefined && (!Array.isArray(entry.parts) || entry.parts.some((part) => typeof part !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(part)))) bad(path, `${at}.parts must be kebab-case part names (label, fill, back-button)`);
  for (const key of FLAG_KEYS) if (entry[key] !== undefined && typeof entry[key] !== 'boolean') bad(path, `${at}.${key} must be true or false`);
}

function checkSpecs(path, specs) {
  if (specs === false || specs === undefined) return;
  if (specs === null || typeof specs !== 'object' || Array.isArray(specs)) bad(path, 'specs must be an object or false');
  for (const key of Object.keys(specs)) if (!SPECS_KEYS.has(key)) bad(path, `specs has an unknown key "${key}"`);
  for (const key of ['tokens', 'block', 'out', 'module']) if (specs[key] !== undefined && typeof specs[key] !== 'string') bad(path, `specs.${key} must be a string`);
  if (specs.overrides !== undefined && !Array.isArray(specs.overrides)) bad(path, 'specs.overrides must be a list');
  for (const [index, override] of (specs.overrides ?? []).entries()) {
    if (override === null || typeof override !== 'object' || typeof override.path !== 'string' || typeof override.value !== 'number') bad(path, `specs.overrides[${index}] needs a dotted "path" and a numeric "value"`);
  }
}

/** Validates the catalogue's shape (bad shape = exit 2); the rules themselves are problems. */
export function validateContract(path, data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) bad(path, 'the catalogue is not a JSON object');
  for (const key of Object.keys(data)) if (!CONTRACT_KEYS.has(key)) bad(path, `unknown key "${key}"`);
  if (!Array.isArray(data.components)) bad(path, '"components" must be a list');
  data.components.forEach((entry, index) => checkEntry(path, entry, index));
  const names = new Set();
  for (const entry of data.components) {
    if (names.has(entry.name)) bad(path, `${entry.name} is listed twice`);
    names.add(entry.name);
  }
  for (const key of ['pressHosts', 'exclude']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some((item) => typeof item !== 'string'))) bad(path, `"${key}" must be a list of strings`);
  }
  for (const key of ['prerequisites', 'ownedElsewhere']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some((item) => typeof item?.file !== 'string' || typeof item?.owner !== 'string'))) bad(path, `"${key}" must be a list of { file, owner }`);
  }
  if (data.mockOnly !== undefined && (!Array.isArray(data.mockOnly) || data.mockOnly.some((item) => typeof item?.name !== 'string' || typeof item?.why !== 'string'))) bad(path, '"mockOnly" must be a list of { name, file?, why }');
  checkSpecs(path, data.specs);
  return data;
}

/** The catalogue: { rel, exists, data } (data null when the file does not exist). */
export function loadContract(root, layout, given) {
  const rel = given ?? layout.config.componentLibraryContract ?? `${layout.contractsDir}/${CONTRACT_NAME}`;
  const abs = join(root, rel);
  if (!existsSync(abs)) return { rel, exists: false, data: null };
  return { rel, exists: true, data: validateContract(rel, readJson(abs, rel)) };
}

/**
 * {themeDir}-style placeholders filled from the layout and the resolved ui folder. When the ui
 * folder is not the layout's (a monorepo's UI package: packages/ui/src/ui), the theme is its sibling
 * (packages/ui/src/theme), the way the canonical layout keeps src/ui beside src/theme.
 */
export function fillLayout(text, layout, uiDir) {
  const themeDir = uiDir === layout.uiDir ? layout.themeDir : uiDir.replace(/[^/]+$/, 'theme');
  const values = { ...layout, uiDir, themeDir };
  return text.replace(/\{(\w+)\}/g, (whole, key) => (typeof values[key] === 'string' ? values[key] : whole));
}

/** Specs configuration from the catalogue (null when the app turned generated specs off). */
export function specsConfig(contract, uiDir) {
  const specs = contract?.specs;
  if (specs === false) return null;
  return {
    tokens: specs?.tokens ?? 'design/tokens.json',
    block: specs?.block ?? 'components',
    out: specs?.out ?? `${uiDir}/component-specs.json`,
    module: specs?.module ?? `${uiDir}/component-specs.ts`,
    asRenderedBorders: specs?.asRenderedBorders === true,
    overrides: specs?.overrides ?? [],
  };
}

export function readTokens(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) throw new UsageError(`token file not found: ${rel}`, 'Create the token file first (design-system-structure), or point specs.tokens in the catalogue at it.');
  return readJson(abs, rel);
}

function getPath(value, dotted) {
  return dotted.split('.').reduce((node, key) => (node !== null && typeof node === 'object' ? node[key] : undefined), value);
}

const REFERENCE = /^\{([A-Za-z0-9_.-]+)\}$/;

/**
 * Resolves design-token references ("{spacing.md}", also DTCG "$value" wrappers) against the whole
 * token file, so the components block can name shared steps instead of retyping them.
 */
export function resolveReferences(value, tokens, trail = []) {
  if (typeof value === 'string') {
    const match = REFERENCE.exec(value);
    if (!match) return value;
    if (trail.includes(match[1])) throw new UsageError(`token reference cycle: ${[...trail, match[1]].join(' -> ')}`, 'Break the cycle in the token file.');
    const target = getPath(tokens, match[1]);
    if (target === undefined) throw new UsageError(`token reference {${match[1]}} points at nothing`, 'Fix the reference in the components block, or add the token it names.');
    return resolveReferences(target, tokens, [...trail, match[1]]);
  }
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, tokens, trail));
  if (value !== null && typeof value === 'object') {
    if ('$value' in value) return resolveReferences(value.$value, tokens, trail);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('$')).map(([key, item]) => [key, resolveReferences(item, tokens, trail)]));
  }
  return value;
}

/** Keeps only numbers and all-number arrays: the measurements a component can use as pt values. */
export function numericProjection(value) {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.length > 0 && value.every((item) => typeof item === 'number') ? value : undefined;
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const projected = numericProjection(item);
      if (projected !== undefined) out[key] = projected;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

/**
 * Keys a browser-rendered reference draws as a CSS border: `border`, `*Border`, `border*` and a
 * fill's end edge (`fillEdge`). Rings (box-shadow), strokes, sizes and gaps are never borders.
 */
export function isBorderKey(key) {
  return /^border/.test(key) || /Border$/.test(key) || key === 'fillEdge';
}

/**
 * The width a browser draws a CSS border with: Chrome floors a border of 1 px or more to whole CSS
 * px (2.5 -> 2, 1.5 -> 1); a sub-pixel border keeps its value. Used only when the design's approved
 * references are browser renders (specs.asRenderedBorders), so the app matches what the reviewer saw.
 */
export function asRenderedBorder(width) {
  return width >= 1 ? Math.floor(width) : width;
}

function floorBorders(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = typeof item === 'number' && isBorderKey(key) ? asRenderedBorder(item) : floorBorders(item);
  return out;
}

function setPath(target, dotted, value) {
  const keys = dotted.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object' || Array.isArray(node[key])) {
      throw new UsageError(`specs override ${dotted}: the components block has no "${key}" group`, 'Point the override at an existing component group (contracts/component-library.json specs.overrides).');
    }
    node = node[key];
  }
  node[keys.at(-1)] = value;
}

/** Overrides that lack the one-sentence reason every override must carry. */
export function overridesWithoutReason(config) {
  return (config?.overrides ?? []).filter((override) => typeof override.why !== 'string' || override.why.trim().length < 10);
}

/**
 * The component specs: the numeric projection of the token file's components block with references
 * resolved, borders floored only for browser-rendered references, then the catalogue's overrides.
 * The token file is never edited; this derivation is what component-specs.json must equal.
 */
export function specsFromTokens(tokens, config) {
  const block = tokens?.[config.block];
  if (block === undefined) throw new UsageError(`the token file has no "${config.block}" block`, `Add the component measurements to ${config.tokens} under "${config.block}" (references/measurements-and-specs.md), or set specs to false in the catalogue.`);
  const projected = numericProjection(resolveReferences(block, tokens));
  if (projected === undefined) throw new UsageError(`the "${config.block}" block of ${config.tokens} holds no numbers`, 'Give each component group its measurements in pt.');
  const specs = config.asRenderedBorders ? floorBorders(projected) : projected;
  for (const { path, value } of config.overrides) setPath(specs, path, value);
  return specs;
}

/** Why a derived value differs from what the token file says at that path, or null. */
export function specNote(tokens, config, path) {
  const override = config.overrides.find((entry) => entry.path === path);
  if (override) return `override: ${override.why ?? 'no reason given'}`;
  const raw = getPath(tokens?.[config.block], path);
  if (typeof raw === 'string' && REFERENCE.test(raw)) return `the token file says ${raw}`;
  const key = path.split('.').at(-1);
  if (config.asRenderedBorders && typeof raw === 'number' && isBorderKey(key) && asRenderedBorder(raw) !== raw) return `a CSS border: the token's ${raw} renders as ${asRenderedBorder(raw)} (specs.asRenderedBorders)`;
  return null;
}

/** The exact text component-specs.json must hold (Prettier-stable: number arrays on one line). */
export function specsJsonText(specs) {
  const text = JSON.stringify(specs, null, 2).replace(/\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]/g, (_, items) => `[${items.split(/,\s*/).join(', ')}]`);
  return `${text}\n`;
}

/** First difference between two JSON values as a dotted path, or null when equal. */
export function firstDifference(expected, actual, path = '') {
  if (typeof expected !== typeof actual || Array.isArray(expected) !== Array.isArray(actual) || (expected === null) !== (actual === null)) {
    return { path: path || '(root)', expected, actual };
  }
  if (expected === null || typeof expected !== 'object') return expected === actual ? null : { path: path || '(root)', expected, actual };
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of [...keys].sort()) {
    const next = path ? `${path}.${key}` : key;
    if (!(key in expected)) return { path: next, expected: undefined, actual: actual[key] };
    if (!(key in actual)) return { path: next, expected: expected[key], actual: undefined };
    const diff = firstDifference(expected[key], actual[key], next);
    if (diff) return diff;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Repo files
// ---------------------------------------------------------------------------------------------

const SOURCE_EXCLUDES = ['*.test.ts', '*.test.tsx', '*.d.ts', '__generated__', '__mocks__'];

/** App source files under the given folders (repo walk: installed skills and output folders pruned). */
export function sourceFilesUnder(root, dirs) {
  const prefixes = [...new Set(dirs.filter(Boolean))].map((dir) => (dir === '.' ? '' : `${dir}/`));
  return walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: SOURCE_EXCLUDES }).filter((rel) => prefixes.some((prefix) => rel.startsWith(prefix)));
}

/** Test files anywhere in the repo (repo walk). */
export function testFiles(root) {
  return walkRepo(root, { include: ['*.test.ts', '*.test.tsx'] });
}

/** Component files of the ui folder (relative to it), minus excluded folders and prerequisites. */
export function uiComponentFiles(root, uiDir, { exclude, skip }) {
  return sourceFilesUnder(root, [uiDir])
    .filter((rel) => rel.endsWith('.tsx'))
    .map((rel) => rel.slice(uiDir.length + 1))
    .filter((rel) => !exclude.some((glob) => matchGlob(rel, glob)) && !skip.has(rel));
}

export function readSource(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ---------------------------------------------------------------------------------------------
// Source scanners (comment-masked text keeps offsets, so line numbers still match)
// ---------------------------------------------------------------------------------------------

export function masked(source) {
  return maskComments(source);
}

/** Character ranges of every `StyleSheet.create({...})` argument. */
export function styleSheetRanges(text) {
  const ranges = [];
  const re = /StyleSheet\.create\s*\(/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    let depth = 0;
    let start = -1;
    for (let i = match.index + match[0].length; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          ranges.push([start, i + 1]);
          break;
        }
      } else if (ch === ')' && depth === 0) {
        break;
      }
    }
  }
  return ranges;
}

export function inRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/** The flat `name: { ... }` entries inside StyleSheet.create calls: [{ name, body, index }]. */
export function styleEntries(text) {
  const sheets = styleSheetRanges(text);
  const entries = [];
  for (const match of text.matchAll(/\b(\w+)\s*:\s*\{([^{}]*)\}/g)) {
    if (inRanges(match.index, sheets)) entries.push({ name: match[1], body: match[2], index: match.index });
  }
  return entries;
}

/** The body of `export type <Name>Props = { ... };` (generic parameters allowed), or null. */
export function propsBody(source, name) {
  const match = new RegExp(`export type ${name}Props(?:<[^>]*>)?\\s*=\\s*\\{`).exec(source);
  if (!match) return null;
  let depth = 0;
  for (let i = match.index + match[0].length - 1; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  return null;
}

const IDENT = /[\w$]/;

function skipString(text, i) {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j += 1) {
    if (text[j] === '\\') j += 1;
    else if (text[j] === quote) return j + 1;
  }
  return text.length;
}

/** True when `<` at `i` opens a JSX tag rather than a TypeScript generic or a comparison. */
function opensJsx(text, i) {
  if (!/[A-Za-z>/]/.test(text[i + 1] ?? '')) return false;
  let p = i - 1;
  while (p >= 0 && /\s/.test(text[p])) p -= 1;
  if (p < 0) return true;
  if (/[)\]]/.test(text[p])) return false;
  if (!IDENT.test(text[p])) return true;
  let start = p;
  while (start > 0 && IDENT.test(text[start - 1])) start -= 1;
  return text.slice(start, p + 1) === 'return';
}

function tagEnd(text, from) {
  let depth = 0;
  for (let j = from; j < text.length; j += 1) {
    const ch = text[j];
    if (ch === '"' || ch === "'" || ch === '`') j = skipString(text, j) - 1;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (depth === 0 && ch === '/' && text[j + 1] === '>') return { end: j + 2, isSelfClosing: true };
    else if (depth === 0 && ch === '>') return { end: j + 1, isSelfClosing: false };
  }
  return { end: text.length, isSelfClosing: true };
}

/**
 * The JSX elements of a comment-masked .tsx source, in order: { name, start, attrs, parent,
 * children } (parent and children are indexes; fragments have the name ''). A small scanner, not a
 * parser: enough for component files that Prettier keeps regular.
 */
export function jsxElements(text) {
  const elements = [];
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = stack.length === 0 ? skipString(text, i) : i + 1;
      continue;
    }
    if (ch !== '<' || !opensJsx(text, i)) {
      i += 1;
      continue;
    }
    if (text[i + 1] === '/') {
      const close = /^<\/\s*([\w$.]*)\s*>/.exec(text.slice(i));
      const name = close ? close[1] : '';
      while (stack.length > 0) {
        const top = stack.pop();
        if (elements[top].name === name) break;
      }
      i += close ? close[0].length : 2;
      continue;
    }
    const name = /^<([\w$.]*)/.exec(text.slice(i))[1];
    const { end, isSelfClosing } = tagEnd(text, i + 1 + name.length);
    const index = elements.length;
    const parent = stack.length > 0 ? stack.at(-1) : null;
    elements.push({ name, start: i, attrs: text.slice(i + 1 + name.length, end), parent, children: [] });
    if (parent !== null) elements[parent].children.push(index);
    if (!isSelfClosing) stack.push(index);
    i = end;
  }
  return elements;
}

/** Style entry names an element uses through `style={...}`, `faceStyle={...}` or `layoutStyle={...}`. */
export function styleRefsOf(element) {
  const names = new Set();
  for (const attr of element.attrs.matchAll(/\b(?:style|faceStyle|layoutStyle)\s*=\s*\{/g)) {
    let depth = 0;
    let end = attr.index + attr[0].length - 1;
    for (; end < element.attrs.length; end += 1) {
      if (element.attrs[end] === '{') depth += 1;
      else if (element.attrs[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    for (const ref of element.attrs.slice(attr.index, end).matchAll(/\bstyles\.(\w+)/g)) names.add(ref[1]);
  }
  return names;
}

export function hasDescendant(elements, element, predicate) {
  return element.children.some((index) => predicate(elements[index]) || hasDescendant(elements, elements[index], predicate));
}

const BOX_KEYS = /\b(padding\w*|border\w*Width|backgroundColor)\s*:/;

/**
 * AppTexts that carry the component's own testID (`testID={testID}` or `testID={props.testID}`)
 * while their parent View (or Animated.View) draws the box and has no testID of its own, and the
 * AppText is its only labelled child (the rest are icons). Maestro then reports the text's bounds,
 * not the chip, badge or header the design measures. Part ids (`${testID}.label`) on text stay
 * fine, and so does text in a plain layout View.
 */
export function testIdsOnInnerText(text) {
  const elements = jsxElements(text);
  const entries = new Map(styleEntries(text).map((entry) => [entry.name, entry]));
  const hasTestId = (element) => /\btestID\s*=/.test(element.attrs);
  const hasOwnTestId = (element) => /\btestID\s*=\s*\{\s*(?:props\.)?testID\s*\}/.test(element.attrs);
  const drawsBox = (element) => BOX_KEYS.test(element.attrs.replace(/\bstyles\.\w+/g, '')) || [...styleRefsOf(element)].some((name) => BOX_KEYS.test(entries.get(name)?.body ?? ''));
  const found = [];
  for (const element of elements) {
    if (element.name !== 'AppText' || !hasOwnTestId(element) || element.parent === null) continue;
    const parent = elements[element.parent];
    if (!['View', 'Animated.View'].includes(parent.name) || hasTestId(parent)) continue;
    const siblings = parent.children.map((index) => elements[index]).filter((sibling) => sibling !== element);
    if (siblings.some((sibling) => hasTestId(sibling) || sibling.name === 'AppText')) continue;
    if (drawsBox(parent)) found.push({ index: element.start, parent: parent.name });
  }
  return found;
}

/**
 * Style entries with a fixed `height` that an element holding text uses: at 200 % text the text
 * outgrows the box and clips (use minHeight).
 */
export function fixedHeightsAroundText(text) {
  const elements = jsxElements(text);
  const fixed = new Map(styleEntries(text).filter((entry) => /(^|[\s,{])height\s*:/.test(entry.body)).map((entry) => [entry.name, entry]));
  const found = new Map();
  for (const element of elements) {
    for (const name of styleRefsOf(element)) {
      if (fixed.has(name) && hasDescendant(elements, element, (child) => child.name === 'AppText')) found.set(name, fixed.get(name));
    }
  }
  return [...found.values()];
}
