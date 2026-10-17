#!/usr/bin/env node
// check-rtl.mjs: checks that an Expo app stays right-to-left correct: logical style keys and rows,
// start/end text alignment through the text primitive, one layout-direction source, a direction
// switch that restarts once from a mounted component behind a guard, the direction decided before the
// app starts, roots outside the providers that set their own text locale, physical surfaces kept left
// to right, the directional-icon set, numbers formatted in the language's digits, and no hand-written
// bidi controls.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-rtl.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { createReporter, fail, lineOf, notYetCreated, parseArgs, parseJsonc, requireDir, resolveLayout, run, toPosix, walkRepo } from './check-lib.mjs';
import { findCalls, findClosing, findImports, findJsxTags, functionsOf, isTestFile, jsxAttributes, maskCode, resolveImport, scanSource } from './lib/source-scan.mjs';
import { LiteralError, findConstInitializer, parseValue } from './lib/ts-literal.mjs';

const SPEC = {
  name: 'check-rtl',
  summary: 'Checks an Expo app for right-to-left mistakes: physical left/right style keys, textAlign left/right, row-reverse, scaleX flips, hand-set writingDirection, Text outside the text primitive, I18nManager outside src/i18n/direction.ts, direction reloads that bypass the guard or run at import time, expo-localization RTL flags, layout direction taken from the language, the directional-icon set, physical surfaces that mirror, numbers turned into text without the locale tag, raw bidi controls, the direction module, the direction gate in the root layout, and roots outside the providers without their own text locale.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'When multi-package: the Expo app folder (e.g. apps/mobile), relative to the repo root' },
    contract: { type: 'string', value: 'file', help: 'The direction contract, relative to the app folder (default: <contractsDir>/rtl.json; optional)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (scans <srcDir> with its routes, plugins/ and the root app.config.*, app.json, index.*, App.tsx):',
    '  physical-style-key        left/right/marginLeft/paddingRight/borderTopLeftRadius... in a style context',
    '                            (StyleSheet.create, a *style prop, a *Style-typed variable, the object a function',
    '                            typed to return a *Style builds, useAnimatedStyle)',
    '  text-align-literal        a \'left\' | \'right\' literal in a textAlign value, ternaries included (AppText',
    '                            align="start" | "end" instead), outside the text style hook',
    '  row-reverse               flexDirection: \'row-reverse\' (row already mirrors)',
    '  scale-x-flip              scaleX: -1 outside the Icon component (mirror positions, flip only directional icons)',
    '  writing-direction         writingDirection set outside the text style hook (AppText direction="ltr" instead)',
    '  text-import               Text imported from react-native outside the text primitive',
    '  i18nmanager               I18nManager outside src/i18n/direction.ts or a platform sibling of it (direction.web.ts)',
    '  reload-outside-direction  a language or direction change reloads without restartForDirection: a reload call',
    '                            (reloadAppAsync, Updates.reloadAsync, DevSettings.reload) outside direction.ts whose',
    '                            reason, enclosing function or file name mentions language, locale, direction, rtl, ltr',
    '  reload-at-module-scope    a reload call evaluated at import time (it crashed a Release build)',
    '  expo-localization-rtl     supportsRTL / forcesRTL in the app config or a plugin (they re-derive the direction',
    '                            from the device at every launch and undo an in-app language choice); with',
    '                            directionSource "device" only forcesRTL fails',
    '  layout-direction          a navigator\'s or DirectionProvider\'s direction taken from the language (directionOf,',
    '                            language) instead of the layout, outside a root drawn outside the app',
    '  directional-icons         DIRECTIONAL_ICONS must equal the contract\'s directional icon names that exist in ICON_PATHS',
    '  physical-surface-ltr      a component the contract lists in physicalSurfaces rendered outside <PhysicalDirectionView>',
    '  number-to-text            a JSX child that turns a number into text with String(), .toString() or .toFixed()',
    '                            (Latin digits in every language; createNumberFormatter(localeTagFor(...)))',
    '  bidi-in-source            raw or escaped bidi controls, LRM/RLM or ALM outside the bidi files (isolate() for free',
    '                            text, AppText direction="ltr" for a whole left-to-right text in a right-to-left row)',
    '  direction-module          with a right-to-left language in languages.ts: src/i18n/direction.ts exists, calls',
    '                            allowRTL and forceRTL, and restartForDirection records the guard before it reloads',
    '  direction-before-render   the root layout renders DirectionGate (or plans the direction) before anything with',
    '                            effects: no startup call (contract startupCalls) in the component that renders the gate,',
    '                            and no JSX element around the gate there except the contract gateWrappers',
    '  root-direction-provider   a root drawn outside the app\'s providers (the root ErrorBoundary: its Fallback component,',
    '                            the one component it returns, or the JSX it renders inline; the restart screen;',
    '                            contract outsideRoots) renders TextLocaleProvider with directionOf(language); a Fallback',
    '                            file whose only JSX is one local screen component may leave it to that screen (one level)',
    '',
    'Test files (*.test.ts[x], test/, __mocks__/) may assert styles, mock modules and spell controls; only text-align-literal,',
    'row-reverse, i18nmanager and text-import apply to them. Folders holding a SKILL.md (installed skills) are never scanned.',
    'contracts/rtl.json (optional; keys: directionSource, rootLayout, startupCalls, gateWrappers, outsideRoots, physicalSurfaces, iconSet, iconComponent,',
    '  directionalIcons, textPrimitive, textStyleHook, bidiFiles) holds the app\'s facts; a malformed file is exit 2.',
    'Profiles: directionSource "app" (default: an in-app language choice decides the direction through direction.ts and',
    '  DirectionGate) or "device" (the app only follows the device language: direction-module and direction-before-render',
    '  are not checked and supportsRTL is allowed).',
    'Defaults: rootLayout <routesDir>/_layout.tsx (App.tsx when that does not exist), startupCalls openDeviceData,',
    '  openDeviceDatabase, openDatabaseSync, openDatabaseAsync; gateWrappers Fragment, React.Fragment,',
    '  GestureHandlerRootView, SafeAreaProvider, WebStorageGate; iconSet <uiDir>/icons/icon-paths.ts; iconComponent <uiDir>/icons/icon.tsx;',
    '  directionalIcons back, forward, chevron, undo, redo; textPrimitive <uiDir>/app-text.tsx; textStyleHook',
    '  <themeDir>/use-text-style.ts; bidiFiles <i18nDir>/bidi.ts and the text primitive.',
  ].join('\n'),
};

const PHYSICAL_KEYS = ['left', 'right', 'marginLeft', 'marginRight', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'borderLeftColor', 'borderRightColor', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'];
const LOGICAL = {
  left: 'start', right: 'end', marginLeft: 'marginStart', marginRight: 'marginEnd', paddingLeft: 'paddingStart', paddingRight: 'paddingEnd',
  borderLeftWidth: 'borderStartWidth', borderRightWidth: 'borderEndWidth', borderLeftColor: 'borderStartColor', borderRightColor: 'borderEndColor',
  borderTopLeftRadius: 'borderTopStartRadius', borderTopRightRadius: 'borderTopEndRadius', borderBottomLeftRadius: 'borderBottomStartRadius', borderBottomRightRadius: 'borderBottomEndRadius',
};
const CONTRACT_KEYS = ['$comment', 'directionSource', 'rootLayout', 'startupCalls', 'gateWrappers', 'outsideRoots', 'physicalSurfaces', 'iconSet', 'iconComponent', 'directionalIcons', 'textPrimitive', 'textStyleHook', 'bidiFiles'];
const DEFAULT_STARTUP_CALLS = ['openDeviceData', 'openDeviceDatabase', 'openDatabaseSync', 'openDatabaseAsync'];
/** Elements without effects that may sit around DirectionGate in the root layout. */
// Not StrictMode: around the gate it wraps AppRoot, whose startup initializer then runs twice in development (two database opens).
// WebStorageGate (web-support): on the web the restart is a page reload that runs the warm-up again,
// and on devices the gate renders its children with no effect work.
const DEFAULT_GATE_WRAPPERS = ['Fragment', 'React.Fragment', 'GestureHandlerRootView', 'SafeAreaProvider', 'WebStorageGate'];
const DEFAULT_DIRECTIONAL_ICONS = ['back', 'forward', 'chevron', 'undo', 'redo'];
/** Bidi control code points: ALM, LRM, RLM, LRE..RLO, LRI..PDI. Built at run time so this file stays plain ASCII. */
const BIDI_POINTS = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const BIDI_RAW = new RegExp(`[${BIDI_POINTS.map((point) => String.fromCodePoint(point)).join('')}]`);
const BACKSLASH = String.fromCharCode(92);
const BIDI_ESCAPE = new RegExp(`${BACKSLASH}${BACKSLASH}u(?:061[cC]|200[eEfF]|202[a-eA-E]|206[6-9]|${BACKSLASH}{0*(?:61[cC]|200[eEfF]|202[a-eA-E]|206[6-9])${BACKSLASH}})`);
const DIRECTION_WORDS = /language|locale|direction|\brtl\b|\bltr\b|Rtl|Ltr/i;
const RELOAD_CALLEES = ['reloadAppAsync', '(?:[A-Za-z_$][\\w$]*\\.)?reloadAsync', 'DevSettings\\.reload'];
const LTR_TEXT_FIX = 'A whole left-to-right text in a right-to-left row (an English label kept in an Arabic screen) is a left-to-right paragraph aligned to the row\'s start: <AppText direction="ltr">, never marks around it.';

function readContract(appRoot, layout, given) {
  const rel = given ?? toPosix(join(layout.contractsDir, 'rtl.json'));
  const path = join(appRoot, rel);
  if (!existsSync(path)) {
    if (given) fail(`contract ${rel} does not exist`, 'Pass an existing file to --contract, or leave it out to use contracts/rtl.json (optional).');
    return { rel, data: {} };
  }
  let data;
  try {
    data = parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${rel} is not valid JSON: ${error.message}`, 'Fix the JSON (the skill ships templates/contracts/rtl.json and its schema).');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) fail(`${rel} must hold a JSON object`, 'Start from templates/contracts/rtl.json.');
  for (const key of Object.keys(data)) {
    if (!CONTRACT_KEYS.includes(key)) fail(`${rel} has an unknown key "${key}"`, `Use only: ${CONTRACT_KEYS.join(', ')}.`);
  }
  if (data.directionSource !== undefined && !['app', 'device'].includes(data.directionSource)) fail(`${rel} "directionSource" must be "app" or "device"`, 'Leave it out (default "app": an in-app language choice decides the direction), or "device" for an app that only follows the device language.');
  for (const key of ['rootLayout', 'iconSet', 'iconComponent', 'textPrimitive', 'textStyleHook']) {
    if (data[key] !== undefined && typeof data[key] !== 'string') fail(`${rel} "${key}" must be a repo-relative path string`, 'See templates/contracts/rtl.schema.json.');
  }
  for (const key of ['startupCalls', 'gateWrappers', 'outsideRoots', 'physicalSurfaces', 'directionalIcons', 'bidiFiles']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some((item) => typeof item !== 'string'))) fail(`${rel} "${key}" must be a list of strings`, 'See templates/contracts/rtl.schema.json.');
  }
  return { rel, data };
}

function settingsFrom(appRoot, layout, contract) {
  const join2 = (...parts) => toPosix(join(...parts));
  // React Navigation: App.tsx is the root when the routes folder holds no root layout.
  const noRoutes = !existsSync(join(appRoot, layout.routesDir, '_layout.tsx')) && existsSync(join(appRoot, 'App.tsx'));
  const textPrimitive = contract.textPrimitive ?? join2(layout.uiDir, 'app-text.tsx');
  return {
    directionSource: contract.directionSource ?? 'app',
    rootLayout: contract.rootLayout ?? (noRoutes ? 'App.tsx' : join2(layout.routesDir, '_layout.tsx')),
    startupCalls: contract.startupCalls ?? DEFAULT_STARTUP_CALLS,
    gateWrappers: contract.gateWrappers ?? DEFAULT_GATE_WRAPPERS,
    outsideRoots: contract.outsideRoots ?? [],
    physicalSurfaces: contract.physicalSurfaces ?? [],
    iconSet: contract.iconSet ?? join2(layout.uiDir, 'icons', 'icon-paths.ts'),
    iconComponent: contract.iconComponent ?? join2(layout.uiDir, 'icons', 'icon.tsx'),
    directionalIcons: contract.directionalIcons ?? DEFAULT_DIRECTIONAL_ICONS,
    textPrimitive,
    textStyleHook: contract.textStyleHook ?? join2(layout.themeDir, 'use-text-style.ts'),
    bidiFiles: contract.bidiFiles ?? [join2(layout.i18nDir, 'bidi.ts'), textPrimitive],
    directionFile: join2(layout.i18nDir, 'direction.ts'),
    restartRoot: join2(layout.i18nDir, 'direction-restart.tsx'),
    languagesFile: join2(layout.i18nDir, 'languages.ts'),
  };
}

/** The files to scan: app source (routes included), config plugins and the root entry and config files. */
function collectFiles(appRoot, layout) {
  const src = `${layout.srcDir}/`;
  const rootFiles = new Set(['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.json', 'index.ts', 'index.tsx', 'index.js', 'App.tsx']);
  return walkRepo(appRoot, { include: ['*.ts', '*.tsx', '*.js', '*.mjs', '*.json'], ignore: ['**/*.d.ts'] })
    .filter((rel) => {
      if (rootFiles.has(rel)) return true;
      if (rel.endsWith('.json')) return false;
      return (rel.startsWith(src) || rel.startsWith('plugins/')) && /\.(ts|tsx)$/.test(rel) || (rel.startsWith('plugins/') && /\.(js|mjs)$/.test(rel));
    });
}

/** [start, end] ranges of style contexts in masked code. */
function styleRanges(source, masked, isTsx) {
  const ranges = [];
  for (const call of findCalls(masked, 'StyleSheet\\.create')) ranges.push([call.open, call.close]);
  // Reanimated animated styles are styles too: useAnimatedStyle(() => ({ marginStart: x.get() })).
  for (const call of findCalls(masked, 'useAnimatedStyle')) ranges.push([call.open, call.close]);
  for (const match of masked.matchAll(/:\s*(?:[A-Za-z]+\.)?[A-Za-z]*Style\b[^=;{]*=\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(masked, open);
    if (close !== -1) ranges.push([open, close]);
  }
  // A helper typed to return a style builds one: function badge(): TextStyle { return { ... } } and
  // const badge = (): ViewStyle => ({ ... }). Its whole body is a style context.
  for (const match of masked.matchAll(/\)\s*:\s*(?:[A-Za-z]+\.)?[A-Za-z]*Style\b(?:\s*\[\s*\])?\s*(?:=>\s*)?[({]/g)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(masked, open);
    if (close !== -1) ranges.push([open, close]);
  }
  if (isTsx) {
    for (const tag of findJsxTags(source, masked)) {
      for (const [name, attr] of jsxAttributes(source, tag, masked)) {
        if (attr.kind !== 'expr' || !/(^s|S)tyle$/.test(name)) continue;
        const open = masked.indexOf('{', attr.index);
        const close = findClosing(masked, open);
        if (close !== -1) ranges.push([open, close]);
      }
    }
  }
  return ranges;
}

/**
 * The `{` of every expression child of a JSX element: what follows the `>` of an opening tag, a
 * closing tag or a fragment, up to the next tag (text runs and further expression children
 * included). Attribute values and arrow bodies (`=> {`) are never children.
 */
function jsxChildExpressions(masked, tags) {
  const starts = tags.filter((tag) => !tag.selfClosing).map((tag) => tag.end);
  for (const match of masked.matchAll(/<\/[A-Za-z][\w.]*\s*>|<\/?>/g)) starts.push(match.index + match[0].length - 1);
  const opens = [];
  for (const start of starts) {
    let i = start + 1;
    while (i < masked.length && masked[i] !== '<') {
      if (masked[i] === '{') {
        const close = findClosing(masked, i);
        if (close === -1) break;
        opens.push(i);
        i = close + 1;
        continue;
      }
      i += 1;
    }
  }
  return opens;
}

/**
 * The text of a JSX expression child (between `open` and `close`) with every nested opening tag
 * blanked: a nested element's attributes (`key`, `testID`, `style` template literals) are not
 * text, and its real children are found on their own by jsxChildExpressions. Lengths are kept so
 * indexes still map back to the file.
 */
function withoutNestedTags(masked, tags, open, close) {
  const chars = masked.slice(open + 1, close).split('');
  for (const tag of tags) {
    if (tag.start <= open || tag.start >= close) continue;
    for (let i = tag.start; i <= Math.min(tag.end, close - 1); i += 1) {
      if (chars[i - open - 1] !== '\n') chars[i - open - 1] = ' ';
    }
  }
  return chars.join('');
}

/** The innermost function (from functionsOf) whose block body holds `index`, or null. */
function enclosingFunction(functions, index) {
  let best = null;
  for (const fn of functions) {
    if (fn.bodyStart === -1 || index <= fn.bodyStart || index >= fn.bodyEnd) continue;
    if (best === null || fn.bodyStart > best.bodyStart) best = fn;
  }
  return best;
}

/**
 * True when the call at `index` runs at import time: it sits in a top-level statement that holds no
 * function, arrow, method or class between the statement start and the call.
 */
function isModuleScope(masked, index) {
  let depth = 0;
  let statementStart = 0;
  for (let i = 0; i < index; i += 1) {
    const ch = masked[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1;
      if (depth === 0 && ch === '}') statementStart = i + 1;
    } else if (depth === 0 && (ch === ';' || ch === '\n')) {
      const rest = masked.slice(i + 1, index);
      if (ch === ';' || !/^\s*[.?)\]}]/.test(rest)) statementStart = i + 1;
    }
  }
  const prefix = masked.slice(statementStart, index);
  if (/=>|\bfunction\b|\bclass\b/.test(prefix)) return false;
  // Method shorthand inside an object: name(...) { ... reload() }
  return !/[A-Za-z_$][\w$]*\s*\([^()]*\)\s*(?::[^{]*)?\{/.test(prefix);
}

/** The string value of a call's first argument when it is a plain literal, else ''. */
function firstStringArgument(source, call) {
  const text = source.slice(call.open + 1, call.close).trim();
  const match = /^(['"`])([^'"`]*)\1/.exec(text);
  return match ? match[2] : '';
}

/** Languages and right-to-left languages from languages.ts (null when the file does not exist). */
function readLanguages(appRoot, rel) {
  const path = join(appRoot, rel);
  if (!existsSync(path)) return null;
  const source = readFileSync(path, 'utf8');
  const rtl = new Set();
  const at = findConstInitializer(source, 'RTL_LANGUAGES');
  if (at !== -1) {
    const end = source.indexOf(';', at);
    for (const match of source.slice(at, end === -1 ? undefined : end).matchAll(/['"]([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)['"]/g)) rtl.add(match[1]);
  }
  let languages = [];
  const listAt = findConstInitializer(source, 'LANGUAGES');
  if (listAt !== -1) {
    try {
      const { value } = parseValue(source, listAt);
      if (Array.isArray(value)) languages = value.filter((item) => typeof item === 'string');
    } catch (error) {
      if (!(error instanceof LiteralError)) throw error;
    }
  }
  return { languages, rtl: [...rtl] };
}

/** The end of the top-level statement that starts at `from`: a `;` or a new top-level declaration at depth 0. */
function statementEnd(masked, from) {
  let depth = 0;
  for (let i = from; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0 && ch === ';') return i;
    else if (depth === 0 && ch === '\n' && /^\s*(?:export|import|function|const|let|var|type|interface|class)\b/.test(masked.slice(i + 1, i + 80))) return i;
  }
  return masked.length;
}

/**
 * What a root layout's ErrorBoundary draws (Expo Router renders it in place of the layout, outside
 * every provider the layout mounts): { kind: 'file', path } when it hands off to one component (the
 * `Fallback:` of createRouteErrorBoundary, or the one component the function returns), { kind:
 * 'inline', start, end } when it renders its own JSX, or null when it draws nothing checkable. The
 * text primitive, the text-locale module and providers are never followed: they are parts of an
 * inline fallback, not the fallback.
 */
function errorBoundaryRoot(appRoot, layout, settings, rootRel, source, masked) {
  const found = /\bexport\s+(const|function)\s+ErrorBoundary\b/.exec(masked);
  if (found === null) return null;
  const start = found.index;
  let end;
  if (found[1] === 'function') {
    const params = masked.indexOf('(', start);
    const paramsClose = params === -1 ? -1 : findClosing(masked, params);
    const open = paramsClose === -1 ? -1 : masked.indexOf('{', paramsClose);
    const close = open === -1 ? -1 : findClosing(masked, open);
    end = close === -1 ? masked.length : close + 1;
  } else {
    end = statementEnd(masked, start);
  }
  const region = source.slice(start, end);
  const fallback = /\bFallback\s*:\s*([A-Z][\w$]*)/.exec(maskCode(region));
  const tags = findJsxTags(source, masked).filter((tag) => tag.start > start && tag.start < end);
  let name = fallback?.[1] ?? null;
  if (name === null) {
    if (tags.length === 0) return null;
    // One component and nothing else (no nested tags, no text): the boundary hands off to it.
    const sole = tags.length === 1 && (tags[0].selfClosing || /^\s*<\//.test(masked.slice(tags[0].end + 1, end))) ? tags[0] : null;
    if (sole === null || /Provider$/.test(sole.name)) return { kind: 'inline', start, end };
    name = sole.name;
  }
  for (const imp of findImports(source, masked)) {
    const clause = imp.text.replace(/\bfrom\b[\s\S]*$/, '');
    if (!new RegExp(`(?:^import\\s+${name}\\b|[{,\\s]${name}\\s*[,}])`).test(clause)) continue;
    const resolved = resolveImport(rootRel, imp.from, { root: appRoot, aliases: layout.aliases });
    if (resolved.kind !== 'local' || !resolved.exists) return null;
    const path = toPosix(resolved.path);
    const isPart = path === settings.textPrimitive || /(^|\/)text-locale\.tsx?$/.test(path);
    if (isPart) return fallback === null ? { kind: 'inline', start, end } : null;
    return { kind: 'file', path };
  }
  // Declared in the root layout itself, or not imported: the layout file holds what it draws.
  return fallback === null ? { kind: 'inline', start, end } : null;
}

function checkDirectionalIcons(source, masked, settings, problem) {
  const names = new Set();
  const pathsAt = masked.search(/ICON_PATHS\s*(?::[^=]*)?=\s*\{/);
  if (pathsAt !== -1) {
    const open = masked.indexOf('{', pathsAt);
    const close = findClosing(masked, open);
    for (const match of source.slice(open, close + 1).matchAll(/[{,]\s*(['"]?)([A-Za-z0-9-]+)\1\s*:/g)) {
      const at = open + match.index;
      let depth = 0;
      for (let i = open; i <= at; i += 1) depth += masked[i] === '{' ? 1 : masked[i] === '}' ? -1 : 0;
      if (depth === 1) names.add(match[2]);
    }
  }
  const directional = settings.directionalIcons;
  const fix = `DIRECTIONAL_ICONS = exactly the icons among ${directional.join(', ')} (contract directionalIcons) that exist in ICON_PATHS; play, clocks, checkmarks, logos and pictures never flip.`;
  const setAt = masked.search(/DIRECTIONAL_ICONS\b[^=]*=/);
  if (setAt === -1) {
    if (directional.some((name) => names.has(name))) problem(0, 'DIRECTIONAL_ICONS is missing although directional icons exist', fix);
    return;
  }
  const open = masked.indexOf('[', setAt);
  const close = findClosing(masked, open);
  const listed = open === -1 ? [] : [...source.slice(open, close + 1).matchAll(/['"]([A-Za-z0-9-]+)['"]/g)].map((m) => m[1]);
  for (const name of listed.filter((n) => !directional.includes(n))) problem(setAt, `"${name}" is in DIRECTIONAL_ICONS but does not point along the reading direction`, fix);
  for (const name of directional.filter((n) => names.has(n) && !listed.includes(n))) problem(setAt, `"${name}" points along the reading direction but is not in DIRECTIONAL_ICONS`, fix);
}

/**
 * The direction module or one of its platform siblings (direction.web.ts from web-support keeps the
 * same contract: the guard first, then the flip on <html dir>, then one reload).
 */
function isDirectionModule(rel, settings) {
  if (rel === settings.directionFile) return true;
  const stem = settings.directionFile.replace(/\.ts$/, '');
  return new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(web|ios|android|native)\\.tsx?$`).test(rel);
}

/** direction-module: the one module that touches I18nManager forces both flags and records the guard before reloading. */
function checkDirectionModule(appRoot, settings, problem) {
  const rel = settings.directionFile;
  if (!existsSync(join(appRoot, rel))) {
    problem(rel, 1, 'is missing although the app ships a right-to-left language, so nothing flips the layout when the language changes', 'Copy templates/src/i18n/direction.ts (with direction-plan, direction-gate, direction-restart and the guard port) and render DirectionGate in the root layout.');
    return;
  }
  const source = readFileSync(join(appRoot, rel), 'utf8');
  const masked = maskCode(source);
  const fix = 'Keep templates/src/i18n/direction.ts: forceLayoutDirection calls allowRTL and forceRTL; restartForDirection writes the guard, forces, then reloads.';
  for (const flag of ['allowRTL', 'forceRTL']) {
    if (!new RegExp(`\\bI18nManager\\.${flag}\\s*\\(`).test(masked)) problem(rel, 1, `never calls I18nManager.${flag}(): both flags are needed (allowRTL(false) keeps a left-to-right language left to right on a right-to-left phone)`, fix);
  }
  const write = masked.search(/\.writePending\s*\(/);
  const reload = masked.search(/\breloadAppAsync\s*\(/);
  if (reload === -1) problem(rel, 1, 'never reloads (reloadAppAsync): a direction change only applies to a new JS run', fix);
  else if (write === -1 || write > reload) problem(rel, lineOf(source, reload), 'reloads before it records the pending direction, so a flip that does not take restarts forever', fix);
}

/** direction-before-render: the root layout decides the direction before anything with effects runs. */
function checkRootLayout(appRoot, settings, problem) {
  const rel = settings.rootLayout;
  const source = readFileSync(join(appRoot, rel), 'utf8');
  const masked = maskCode(source);
  const scan = scanSource(source);
  const functions = functionsOf(scan);
  const gate = findJsxTags(source, masked).find((tag) => tag.name === 'DirectionGate');
  const plan = masked.search(/\bplanDirection\s*\(/);
  const decision = gate?.start ?? (plan === -1 ? -1 : plan);
  const fix = 'Render <DirectionGate language guard onGiveUp onGuardFailure> as the root layout\'s first element and move the startup work (database open, stores, providers) into its child component (examples/root-layout.md).';
  if (decision === -1) {
    problem(rel, 1, 'renders the app without deciding the layout direction first, so a right-to-left language shows in a left-to-right layout until something restarts the app', fix);
    return;
  }
  const owner = enclosingFunction(functions, decision);
  if (owner === null) return;
  const body = [owner.bodyStart, owner.bodyEnd];
  if (gate !== undefined) {
    // DirectionGate is the outermost element: a provider or element around it mounts (and runs its
    // effects: a database open, a migration) in a JS run that is about to be replaced.
    for (const outer of findJsxTags(source, masked)) {
      if (outer.selfClosing || outer.start >= gate.start || outer.start < body[0] || settings.gateWrappers.includes(outer.name)) continue;
      const closing = masked.indexOf(`</${outer.name}>`, outer.end);
      if (closing === -1 || closing < gate.end) continue;
      problem(rel, lineOf(source, outer.start), `<${outer.name}> wraps DirectionGate in ${owner.name}, so it mounts and runs its effects before the direction is decided: a restart would repeat them`, `Move <${outer.name}> inside the gate's child (AppRoot), or list it in contracts/rtl.json gateWrappers when it has no effects.`);
    }
  }
  const startupCall = new RegExp(`\\b(${settings.startupCalls.map((name) => name.replace(/[$]/g, '\\$')).join('|')})\\s*\\(`, 'g');
  for (const match of masked.slice(body[0], body[1]).matchAll(startupCall)) {
    const at = body[0] + match.index;
    if (gate === undefined && at > decision) continue;
    problem(rel, lineOf(source, at), `${match[1]}() runs in ${owner.name}, the component that decides the direction, before the decision: a restart would repeat its effects`, fix);
  }
  // A top-level helper that runs a startup call, referenced from the deciding component (useState(startApp)).
  const ownBody = masked.slice(body[0], body[1]);
  for (const fn of functions) {
    if (fn === owner || fn.bodyStart === -1 || fn.name === '(anonymous)' || enclosingFunction(functions, fn.index) !== null) continue;
    const fnBody = masked.slice(fn.bodyStart, fn.bodyEnd);
    const call = [...fnBody.matchAll(startupCall)][0];
    if (call === undefined) continue;
    const use = new RegExp(`\\b${fn.name}\\b`).exec(ownBody);
    if (use === null) continue;
    problem(rel, lineOf(source, body[0] + use.index), `${owner.name} runs ${fn.name}(), which calls ${call[1]}(), before the direction is decided: a restart would repeat its effects`, fix);
  }
}

/** expo-localization-rtl wording: supportsRTL is only wrong with an in-app choice; forcesRTL is wrong in both profiles. */
function localizationFlagMessage(flag, settings) {
  if (flag === 'forcesRTL') return 'forcesRTL is set for expo-localization: it forces a right-to-left layout at every launch, for left-to-right languages too, and undoes any other choice';
  return `${flag} is set for expo-localization: it re-derives the layout direction from the device at every launch and undoes an in-app language choice`;
}

function localizationFlagFix(settings) {
  if (settings.directionSource === 'device') return 'Remove forcesRTL. An app that follows the device needs no expo-localization RTL flag: React Native allows right to left by default, and iOS then follows the bundle localization (supportedLocales); supportsRTL is unnecessary and makes iOS follow the device language too.';
  return 'Give expo-localization supportedLocales only; src/i18n/direction.ts owns the direction (allowRTL + forceRTL + one reload). An app with no language choice of its own may declare contracts/rtl.json directionSource "device" instead.';
}

/** True when the source (or its [from, to) region) mounts TextLocaleProvider and derives a direction with directionOf(). */
function setsTextLocale(source, masked, from, to) {
  const provider = findJsxTags(source, masked).find((tag) => tag.name === 'TextLocaleProvider' && tag.start >= from && tag.start < to);
  return { provider, ok: provider !== undefined && /\bdirectionOf\s*\(/.test(masked.slice(from, to)) };
}

/**
 * The one local screen a fallback file hands off to: the file's only JSX tag, a component imported
 * from a local module (not the text primitive, the text-locale module or a provider). One level only.
 */
function soleScreenOf(appRoot, rel, source, masked, follow) {
  const tags = findJsxTags(source, masked);
  if (tags.length !== 1 || /Provider$/.test(tags[0].name)) return null;
  const name = tags[0].name;
  for (const imp of findImports(source, masked)) {
    const clause = imp.text.replace(/\bfrom\b[\s\S]*$/, '');
    if (!new RegExp(`(?:^import\\s+${name}\\b|[{,\\s]${name}\\s*[,}])`).test(clause)) continue;
    const resolved = resolveImport(rel, imp.from, { root: appRoot, aliases: follow.layout.aliases });
    if (resolved.kind !== 'local' || !resolved.exists) return null;
    const path = toPosix(resolved.path);
    if (path === follow.settings.textPrimitive || /(^|\/)text-locale\.tsx?$/.test(path)) return null;
    return path;
  }
  return null;
}

/** root-direction-provider: a root drawn outside the app's providers sets the text locale of its own language. */
function checkOutsideRoot(appRoot, rel, root, problem) {
  const { why, region, follow } = root;
  const source = readFileSync(join(appRoot, rel), 'utf8');
  const masked = maskCode(source);
  const [from, to] = region ?? [0, source.length];
  const { provider, ok } = setsTextLocale(source, masked, from, to);
  if (ok) return;
  if (follow !== undefined && provider === undefined) {
    // A fallback that only renders one screen component may leave the provider to that screen.
    const screen = soleScreenOf(appRoot, rel, source, masked, follow);
    if (screen !== null) {
      const screenSource = readFileSync(join(appRoot, screen), 'utf8');
      const screenMasked = maskCode(screenSource);
      if (setsTextLocale(screenSource, screenMasked, 0, screenSource.length).ok) return;
    }
  }
  problem(rel, provider === undefined ? lineOf(source, from) : lineOf(source, provider.start), `${why} renders outside the app's providers without its own TextLocaleProvider for its language, so AppText falls back to English: Arabic text is laid out left to right with Latin line heights`, `Wrap what it draws${follow === undefined ? '' : ' (or the one screen component that is its only JSX)'} in <TextLocaleProvider value={{ language, direction: directionOf(language) }}>, with the language its text is in.`);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const repoRoot = requireDir(positionals[0] ?? '.', 'app repo root');
  const appRoot = options['app-dir'] ? requireDir(join(repoRoot, options['app-dir']), 'app folder') : repoRoot;
  const layout = resolveLayout(appRoot);
  const { data: contract } = readContract(appRoot, layout, options.contract);
  const settings = settingsFrom(appRoot, layout, contract);
  const files = collectFiles(appRoot, layout);
  if (!files.some((rel) => rel.startsWith(`${layout.srcDir}/`))) fail(`nothing to check: no .ts or .tsx file under ${toPosix(relative(repoRoot, join(appRoot, layout.srcDir))) || layout.srcDir}`, 'Run from the app repo root, pass it (node check-rtl.mjs <repo-root>), or --app-dir <dir> when multi-package; a moved source folder goes in rn-skills.config.json "srcDir".');
  const report = createReporter({ name: 'check-rtl', json: options.json });
  const shown = (rel) => toPosix(relative(repoRoot, join(appRoot, rel))) || rel;
  const fileProblem = (rel, line, rule) => (message, fix) => report.problem({ file: shown(rel), line, rule, message, fix });

  const languages = readLanguages(appRoot, settings.languagesFile);
  const hasRtl = languages !== null && languages.rtl.length > 0;
  const outsideRoots = new Map();
  if (existsSync(join(appRoot, settings.restartRoot))) outsideRoots.set(settings.restartRoot, { why: 'the direction restart screen', region: null });
  for (const rel of settings.outsideRoots) outsideRoots.set(toPosix(rel), { why: 'this root (contract outsideRoots)', region: null });
  const hasRootLayout = existsSync(join(appRoot, settings.rootLayout));
  if (hasRootLayout) {
    const source = readFileSync(join(appRoot, settings.rootLayout), 'utf8');
    const boundary = errorBoundaryRoot(appRoot, layout, settings, settings.rootLayout, source, maskCode(source));
    if (boundary?.kind === 'file' && !outsideRoots.has(boundary.path)) outsideRoots.set(boundary.path, { why: `the root ErrorBoundary fallback (${basename(boundary.path)})`, region: null, follow: { layout, settings } });
    if (boundary?.kind === 'inline') outsideRoots.set(settings.rootLayout, { why: 'the root ErrorBoundary, drawn inline in the root layout,', region: [boundary.start, boundary.end] });
  }

  for (const rel of files) {
    const source = readFileSync(join(appRoot, rel), 'utf8');
    const test = isTestFile(rel);
    const problem = (index, rule, message, fix) => report.problem({ file: shown(rel), line: lineOf(source, index), rule, message, fix });

    if (rel.endsWith('.json')) {
      const match = (settings.directionSource === 'device' ? /"(forcesRTL)"\s*:/ : /"(supportsRTL|forcesRTL)"\s*:/).exec(source);
      if (match) problem(match.index, 'expo-localization-rtl', localizationFlagMessage(match[1], settings), localizationFlagFix(settings));
      continue;
    }
    const masked = maskCode(source);
    const code = (regex, cb) => {
      for (const match of source.matchAll(regex)) {
        if (masked[match.index] === ' ' && source[match.index] !== ' ') continue; // inside a comment or a string
        cb(match);
      }
    };
    const isTsx = rel.endsWith('.tsx');

    if (!test) {
      for (const range of styleRanges(source, masked, isTsx)) {
        const slice = masked.slice(range[0], range[1] + 1);
        for (const match of slice.matchAll(new RegExp(`(^|[{,]\\s*)(${PHYSICAL_KEYS.join('|')})\\s*:`, 'g'))) {
          const key = match[2];
          problem(range[0] + match.index + match[1].length, 'physical-style-key', `style key "${key}" is physical: React Native turns it into ${LOGICAL[key]} in a right-to-left layout only while the global swapLeftAndRightInRTL preference is on (any library can turn it off; react-native-web never swaps), and next to a logical key on the same element the swapped key wins`, `Use ${LOGICAL[key]}. A truly physical offset (a drag thumb, a scrubber position) is transform: [{ translateX }], which is never swapped, or sits in a PhysicalDirectionView, where start is the left edge.`);
        }
      }
    }

    if (rel !== settings.textStyleHook) {
      // The whole value expression, so an isRtl ternary ('right' : 'left') is caught too.
      code(/\btextAlign\s*:/g, (m) => {
        let i = m.index + m[0].length;
        let depth = 0;
        for (; i < masked.length; i += 1) {
          const ch = masked[i];
          if (ch === '(' || ch === '[' || ch === '{') depth += 1;
          else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth === 0) break;
            depth -= 1;
          } else if (depth === 0 && (ch === ',' || ch === ';')) break;
        }
        const side = /['"](left|right)['"]/.exec(source.slice(m.index + m[0].length, i));
        if (side) problem(m.index, 'text-align-literal', `textAlign takes '${side[1]}', a physical side`, 'Pass align="start" | "end" to AppText; only the text style hook maps start/end to left/right (React Native swaps them in a right-to-left layout), so no isRtl ternary is needed either.');
      });
    }
    code(/flexDirection\s*:\s*['"]row-reverse['"]/g, (m) => problem(m.index, 'row-reverse', 'row-reverse fakes right-to-left and double-flips under a right-to-left layout', "Use flexDirection: 'row'; React Native mirrors it by itself."));
    if (!isDirectionModule(rel, settings)) code(/\bI18nManager\b/g, (m) => problem(m.index, 'i18nmanager', 'I18nManager is used outside the direction module', 'Use useDirection() in components and readLayoutDirection() at the root; only src/i18n/direction.ts touches I18nManager.'));
    if (rel !== settings.iconComponent && !test) code(/scaleX\s*:\s*-\s*1\b/g, (m) => problem(m.index, 'scale-x-flip', 'scaleX: -1 mirrors by transform', 'Flip only directional icons, inside the Icon component (DIRECTIONAL_ICONS); a surface that mirrors maps its coordinates (x -> width - x) for drawing and hit-testing alike.'));
    if (rel !== settings.textStyleHook && !test) code(/\bwritingDirection\s*:/g, (m) => problem(m.index, 'writing-direction', 'writingDirection is set by hand', `Render text with AppText; the text style hook sets writingDirection from the text locale. ${LTR_TEXT_FIX}`));

    for (const imp of findImports(source, masked)) {
      if (imp.from !== 'react-native' || rel === settings.textPrimitive) continue;
      const names = /\{([^}]*)\}/.exec(imp.text)?.[1] ?? '';
      if (/^import\s+type\b/.test(imp.text)) continue;
      if (names.split(',').map((n) => n.trim()).some((n) => n === 'Text' || n.startsWith('Text as '))) problem(imp.index, 'text-import', 'Text is imported from react-native', 'Render text with AppText (or <T>): it sets the alignment, the writing direction, the script font and the 200% cap in one place.');
    }

    if (!test) {
      const scan = scanSource(source);
      const functions = functionsOf(scan);
      for (const callee of RELOAD_CALLEES) {
        for (const call of findCalls(masked, callee)) {
          const name = source.slice(call.start, call.open).trim();
          if (isModuleScope(masked, call.start)) problem(call.start, 'reload-at-module-scope', `${name}() runs at import time`, 'Reload only from a mounted component (an effect or a press handler): a reload while the bundle is being evaluated crashed a Release build, and module code runs again after it.');
          if (isDirectionModule(rel, settings)) continue;
          const reason = firstStringArgument(source, call);
          const owner = enclosingFunction(functions, call.start);
          if (DIRECTION_WORDS.test(reason) || (owner && DIRECTION_WORDS.test(owner.name)) || DIRECTION_WORDS.test(basename(rel))) {
            problem(call.start, 'reload-outside-direction', `${name}() reloads for a language or direction change outside the direction module, without the guard or the forced direction`, 'Save the language, then call restartForDirection(directionOf(language), guard) from src/i18n/direction.ts: it records the guard, sets allowRTL and forceRTL, then reloads once.');
          }
        }
      }
    }

    if (/^(app\.config\.[cm]?[jt]s|plugins\/)/.test(rel) || rel.startsWith(`${layout.configDir}/`)) {
      code(settings.directionSource === 'device' ? /\b(forcesRTL)\b/g : /\b(supportsRTL|forcesRTL)\b/g, (m) => problem(m.index, 'expo-localization-rtl', localizationFlagMessage(m[1], settings), localizationFlagFix(settings)));
    }

    if (!test && !settings.bidiFiles.includes(rel)) {
      const raw = BIDI_RAW.exec(source);
      if (raw) problem(raw.index, 'bidi-in-source', `raw bidi control U+${raw[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} in source`, `Remove it: t() isolates free-text values, isolate() from src/i18n/bidi.ts wraps other free text. ${LTR_TEXT_FIX}`);
      const escaped = BIDI_ESCAPE.exec(source);
      if (escaped) problem(escaped.index, 'bidi-in-source', `bidi control escape ${escaped[0]} in source`, `Import FSI/PDI or isolate() from src/i18n/bidi.ts instead of writing controls by hand. ${LTR_TEXT_FIX}`);
    }

    if (isTsx) {
      const tags = findJsxTags(source, masked);
      for (const tag of tags) {
        if (/^(Navigation|NavigationContainer)$/.test(tag.name) || (tag.name === 'DirectionProvider' && !outsideRoots.has(rel))) {
          const direction = jsxAttributes(source, tag, masked).get('direction');
          if (direction && /directionOf\s*\(|language/i.test(direction.value)) {
            problem(tag.start, 'layout-direction', `<${tag.name}> takes its direction from the language (${direction.value})`, 'Pass the layout direction (readLayoutDirection(), or nothing: Expo Router and React Navigation default to it): between a language change and the restart the language and the layout differ, and navigation, icons and coordinates must follow the layout. Only a root drawn outside the app (contract outsideRoots) uses its language\'s direction.');
          }
        }
      }
      if (!test) {
        for (const tag of tags.filter((t) => settings.physicalSurfaces.includes(t.name))) {
          const wrapped = tags.some((outer) => outer.name === 'PhysicalDirectionView' && !outer.selfClosing && outer.start < tag.start && masked.indexOf('</PhysicalDirectionView>', outer.end) > tag.start);
          if (!wrapped) problem(tag.start, 'physical-surface-ltr', `<${tag.name}> is a physical surface (contract physicalSurfaces) but nothing keeps it left to right, so its view children mirror in a right-to-left layout`, 'Wrap it in <PhysicalDirectionView> (templates/src/ui/physical-direction-view.tsx); content that reads in the language direction passes mirrorsInRtl.');
        }
        const turnedAt = new Set();
        for (const open of jsxChildExpressions(masked, tags)) {
          const close = findClosing(masked, open);
          for (const turned of withoutNestedTags(masked, tags, open, close).matchAll(/\.toFixed\s*\(|\.toString\s*\(\s*\)|(?<![\w$.])String\s*\(/g)) {
            const at = open + 1 + turned.index;
            if (turnedAt.has(at)) continue;
            turnedAt.add(at);
            problem(at, 'number-to-text', `a JSX child turns a value into text with ${turned[0].replace(/\s/g, '')}..., which writes Latin digits in every language`, 'Format numbers with createNumberFormatter(localeTagFor(language, digits)) (or a {count, number} message) in the model hook, and pass the string.');
          }
        }
      }
    }

    if (rel === settings.iconSet) checkDirectionalIcons(source, masked, settings, (index, message, fix) => problem(index, 'directional-icons', message, fix));
  }

  if (languages === null) {
    for (const rule of ['direction-module', 'direction-before-render']) report.skip({ file: shown(settings.languagesFile), rule, message: notYetCreated(appRoot, { file: settings.languagesFile, owner: 'i18n-strings-and-catalogs' }) });
  } else if (!hasRtl) {
    report.note(`direction-module, direction-before-render, root-direction-provider: not checked (${settings.languagesFile} lists no right-to-left language)`);
  } else {
    if (settings.directionSource === 'device') {
      report.note('direction-module, direction-before-render: not checked (contracts/rtl.json directionSource is "device": the system sets the direction at launch; on Android it follows the device locale even when the app falls back to a left-to-right language)');
    } else {
      checkDirectionModule(appRoot, settings, (rel, line, message, fix) => fileProblem(rel, line, 'direction-module')(`${rel} ${message}`, fix));
      if (hasRootLayout) checkRootLayout(appRoot, settings, (rel, line, message, fix) => fileProblem(rel, line, 'direction-before-render')(message, fix));
      else report.skip({ file: shown(settings.rootLayout), rule: 'direction-before-render', message: notYetCreated(appRoot, { file: settings.rootLayout, owner: 'expo-project-bootstrap' }) });
    }
    for (const [rel, root] of outsideRoots) {
      if (!existsSync(join(appRoot, rel))) {
        fileProblem(rel, 1, 'root-direction-provider')(`${rel} is listed in contracts/rtl.json outsideRoots but does not exist`, 'Fix the path in contracts/rtl.json or remove the entry.');
        continue;
      }
      checkOutsideRoot(appRoot, rel, root, (file, line, message, fix) => fileProblem(file, line, 'root-direction-provider')(message, fix));
    }
  }
  if (settings.physicalSurfaces.length === 0) report.note('physical-surface-ltr: no physical surfaces declared (contracts/rtl.json physicalSurfaces)');
  return report.finish({ checked: files.length, unit: 'files' });
});
