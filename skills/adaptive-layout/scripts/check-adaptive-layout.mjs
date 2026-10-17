#!/usr/bin/env node
// check-adaptive-layout.mjs: checks that an Expo app lays out by the window it has, not by the
// device it runs on: no device or platform branching for layout, breakpoints only in the window-class
// and pane modules, readable widths on wide windows, no fixed widths wider than the narrowest window,
// grids sized from their container, orientation locks only where the contract allows them, the
// tablet and resizing settings the platforms now require, and list-detail screens whose selection is
// the route's.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-adaptive-layout.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { createReporter, fail, lineOf, maskComments, matchGlob, notYetCreated, parseArgs, parseJsonc, requireDir, resolveAlias, resolveLayout, run, toPosix, walkRepo } from './check-lib.mjs';
import { findJsxTags, isTestFile, jsxAttributes, maskCode } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-adaptive-layout',
  summary: 'Checks an Expo app for layouts that adapt by device instead of by window: device or platform branching, scattered width breakpoints, a forked window-class hook, screens without a readable width, fixed widths wider than the narrowest window, grids sized from the window or remounted wrongly, orientation locks and orientation reads, the iPad and Android resizing opt-outs, missing tablet support, and list-detail screens that keep the selection outside the route.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'When multi-package: the Expo app folder (e.g. apps/mobile), relative to the repo root' },
    contract: { type: 'string', value: 'file', help: 'The adaptive-layout contract, relative to the app folder (default: <contractsDir>/adaptive-layout.json; optional)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (scan <srcDir> and the routes folder, minus tests; the config rules read app.config.* or app.json and plugins/).',
    'The layout rules (device-branch, device-orientation, raw-breakpoint, fixed-width, readable-width-token, grid-*) read',
    'only UI code (contract layoutGlobs; default: the routes folder, <featuresDir>, <uiDir>, <srcDir>/hooks, <themeDir>):',
    'services, core, data and api code lays nothing out (a haptics adapter may read Platform.isPad, an image resize may',
    'pass width: 1080).',
    '  device-branch          a layout decision from the device: Platform.isPad, interfaceIdiom, expo-device DeviceType or',
    '                         getDeviceTypeAsync, react-native-device-info isTablet(), an isTablet/isPhone/isPad helper',
    '  raw-breakpoint         a width or height compared with a number of 300 or more (a literal, or a file-local',
    '                         const NAME = <number>) outside the breakpoint modules',
    '  window-class-fork      a second window classifier (classifyWindow, useWindowClass, REGULAR_WIDTH_MIN, useBreakpoint,',
    '                         useWindowSizeClass, useIsTablet, useResponsive, useDeviceType) outside src/hooks/use-window-class.ts',
    '  readable-width         a screen file that neither caps its content at CONTENT_MAX_WIDTH nor renders ScreenFrame or',
    '                         ListDetailLayout (contract readableComponents), unless the contract lists it in fullBleedScreens',
    '                         or it sits in a contracts/architecture.json testOnlyFolders folder (never in a store build)',
    '  readable-width-token   a maxWidth literal of 300 or more (the readable cap is the CONTENT_MAX_WIDTH token)',
    '  fixed-width            a width, minWidth or flexBasis wider than maxFixedWidth (default 288: the 320 pt window',
    '                         minus two 16 pt gutters): a literal style key, either branch of a ternary, a file-local',
    '                         numeric const, or JSX width={n}',
    '  grid-columns-key       a FlatList or FlashList with a computed numColumns and no key (React Native throws',
    '                         "Changing numColumns on the fly is not supported")',
    '  grid-columns-source    a computed numColumns in a file that does not use gridColumnsOf (columns come from the',
    '                         measured container, never the window)',
    '  orientation-lock       expo-screen-orientation lockAsync/lockPlatformAsync, or a locking orientation option in a',
    '                         route file (not default or all), outside the contract orientationLocks files',
    '  orientation-unlock     a file allowed to call lockAsync that never calls unlockAsync',
    '  device-orientation     addOrientationChangeListener or getOrientationAsync read for layout (the window shape is',
    '                         useWindowClass().isLandscape)',
    '  config-orientation     app config orientation other than default/portrait, or other than the contract appOrientation;',
    '                         an expo-screen-orientation initialOrientation lock the contract appOrientation does not name',
    '  full-screen-opt-out    requireFullScreen: true or UIRequiresFullScreen (unless UIRequiresFullScreenIgnoredStartingWithVersion',
    '                         is 27 or lower, Apple TN3192), resizeableActivity, min/maxAspectRatio or',
    '                         PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY in the app config or a config plugin',
    '  tablet-support         ios.supportsTablet (or isTabletOnly) is not true and the contract does not say tablets: false',
    '  list-detail-selection  a feature that renders ListDetailLayout keeps the selection in useState (selected*,',
    '                         selection*, active/current/focused/open...Id), or neither the feature nor a route file that',
    '                         imports it reads the route (useLocalSearchParams / useGlobalSearchParams)',
    '  list-detail-screens    a contract listDetailScreens file is missing or does not render ListDetailLayout, or the kit',
    '                         (src/ui/adaptive/list-detail-layout.tsx) is missing',
    '',
    'NOT APPLICABLE when package.json does not depend on react-native. SKIP lines: src/hooks/use-window-class.ts',
    '(react-components-and-hooks creates it) and app.config.ts (expo-project-bootstrap creates it).',
    'contracts/adaptive-layout.json (optional; keys: appOrientation, tablets, tabletsReason, listDetailScreens,',
    '  fullBleedScreens, orientationLocks, breakpointModules, screenGlobs, layoutGlobs, readableComponents, maxFixedWidth)',
    '  holds the app\'s facts; a malformed file is exit 2. Defaults: breakpointModules <srcDir>/hooks/use-window-class.ts',
    '  and <uiDir>/adaptive/**; screenGlobs <featuresDir>/**/*-screen.tsx; layoutGlobs as above; readableComponents',
    '  ScreenFrame, ListDetailLayout; maxFixedWidth 288. Folders holding a SKILL.md (installed skills) are never scanned.',
  ].join('\n'),
};

const CONTRACT_KEYS = ['$schema', '$comment', 'appOrientation', 'tablets', 'tabletsReason', 'listDetailScreens', 'fullBleedScreens', 'orientationLocks', 'breakpointModules', 'screenGlobs', 'layoutGlobs', 'readableComponents', 'maxFixedWidth'];
const ORIENTATIONS = ['default', 'portrait', 'landscape'];
const CONFIG_FILES = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];
const CODE_FILES = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'];
const BREAKPOINT_MIN = 300;
const DEFAULT_MAX_FIXED_WIDTH = 288;
const WINDOW_FIX = 'Decide by the window, never the device: useWindowClass() for compact/regular, landscape and large text, useListDetailLayout() for the pane count, gridColumnsOf() for columns.';

const DEVICE_PATTERNS = [
  { re: /\bPlatform\.isPad\b/g, what: 'Platform.isPad' },
  { re: /\binterfaceIdiom\b/g, what: 'Platform.constants.interfaceIdiom' },
  { re: /\bDeviceType\.(?:PHONE|TABLET|DESKTOP|TV)\b/g, what: 'expo-device DeviceType' },
  { re: /\bgetDeviceTypeAsync\s*\(/g, what: 'expo-device getDeviceTypeAsync()' },
  { re: /\bisTablet\s*\(/g, what: 'isTablet()' },
  { re: /\b(?:const|let|var|function)\s+(?:isTablet|isPhone|isPad|isIPad|isIpad|isHandset)\b/g, what: 'a device-kind helper' },
];
const FORK_PATTERN = /\b(?:function|const|let|var)\s+(classifyWindow|useWindowClass|useWindowSizeClass|useBreakpoints?|useIsTablet|useResponsive|useDeviceType|REGULAR_WIDTH_MIN)\b/g;
const SIZE_OPERAND = String.raw`(?:Math\.(?:min|max)\([^()]*\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)`;
const BREAKPOINT_LEFT = new RegExp(String.raw`(${SIZE_OPERAND})\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)(?![\w.])`, 'g');
const BREAKPOINT_RIGHT = new RegExp(String.raw`(?<![\w.])(\d+(?:\.\d+)?)\s*(>=|<=|>|<)\s*(${SIZE_OPERAND})`, 'g');
const SIZE_WORD = /(?:width|height|shortestside|longestside|Math\.(?:min|max))/i;
const NAME = String.raw`[A-Za-z_$][\w$]*`;
const BREAKPOINT_LEFT_NAME = new RegExp(String.raw`(${SIZE_OPERAND})\s*(>=|<=|>|<)\s*(${NAME})(?![\w$.(])`, 'g');
const BREAKPOINT_RIGHT_NAME = new RegExp(String.raw`(?<![\w$.])(${NAME})\s*(>=|<=|>|<)\s*(${SIZE_OPERAND})`, 'g');
// A file-local numeric constant: const TABLET_BREAKPOINT = 768; (an imported one is not resolved).
const NUMERIC_CONST = new RegExp(String.raw`\b(?:const|let)\s+(${NAME})\s*(?::\s*number\s*)?=\s*(\d+(?:\.\d+)?)\s*(?:as\s+const\s*)?(?=[;,\n])`, 'g');
const FIXED_WIDTH_KEY = /(?<![\w$])(width|minWidth|flexBasis)\s*:\s*(\d+(?:\.\d+)?)(?![\w.%])/g;
const FIXED_WIDTH_NAME = new RegExp(String.raw`(?<![\w$])(width|minWidth|flexBasis)\s*:\s*(${NAME})(?=\s*[,}\n])`, 'g');
// width: isWide ? 500 : '100%' (either branch a number or a numeric constant).
const FIXED_WIDTH_TERNARY = /(?<![\w$])(width|minWidth|flexBasis)\s*:\s*[^,{}?:;\n]+\?\s*([^,{}?:;\n]+?)\s*:\s*([^,{}?:;\n]+?)\s*(?=[,}\n])/g;
const FIXED_WIDTH_ATTR = /(?<![\w$])(width|minWidth)\s*=\s*\{\s*(\d+(?:\.\d+)?)\s*\}/g;
const MAX_WIDTH_KEY = /(?<![\w$])maxWidth\s*:\s*(\d+(?:\.\d+)?)(?![\w.%])/g;
const LOCK_CALL = /\b(lockAsync|lockPlatformAsync)\s*\(/g;
const ORIENTATION_READ = /\b(addOrientationChangeListener|getOrientationAsync)\s*\(/g;
// A route's orientation option; 'default' and 'all' lock nothing.
const ROUTE_ORIENTATION = /(?<![\w$.])orientation\s*:/g;
const UNLOCKED_ROUTE_ORIENTATIONS = new Set(['default', 'all']);
const SELECTION_STATE = /\bconst\s*\[\s*(selected[\w$]*|selection[\w$]*|(?:active|current|focused|open|chosen)[\w$]*(?:Id|Key|Item))\s*,\s*[\w$]+\s*\]\s*=\s*(?:React\.)?useState\b/gi;
const IMPORT_SPEC = /\b(?:from|import|require)\s*\(?\s*(['"])([^'"\n]+)\1/g;
const ROUTE_PARAMS = /\buse(?:Local|Global)SearchParams\b/;
// Apple's migration path (TN3192) keeps the key for older iOS versions only when the same config sets
// UIRequiresFullScreenIgnoredStartingWithVersion to 27 or lower: the app then resizes from that
// version on (26 or 27 are the usual values; an older one resizes from that older version).
const IGNORED_FROM = /\bUIRequiresFullScreenIgnoredStartingWithVersion["']?\s*:\s*["']?(\d+)(?:\.\d+)*["']?/;
const IGNORED_FROM_MAX = 27;
// The value written after a key: `: false`, `: 'true'`, `="true"` (a manifest attribute in a plugin).
const KEY_VALUE = /^["']?\s*[:=]\s*(["']?)(true|false)\1/;
const IOS_OPT_OUT_FIX = 'Remove it and make the layout adapt (useWindowClass, useListDetailLayout); prove it at the window table\'s sizes. An app that must keep full screen on older iOS versions sets ios.infoPlist.UIRequiresFullScreenIgnoredStartingWithVersion to \'26\' (27 or lower; Apple TN3192) and still lays out for resizing.';
const ANDROID_OPT_OUT_FIX = 'Remove the attribute or property (from the app config or the config plugin that writes it) and make the layout adapt (useWindowClass, useListDetailLayout); check it on an API 36 tablet AVD (<project>-tablet) and a foldable or resizable emulator.';
const OPT_OUTS = [
  { re: /["']?\brequireFullScreen["']?\s*:\s*true\b/g, what: 'ios.requireFullScreen: true', why: 'deprecated since iPadOS 26 and ignored by apps built with the iOS 27 SDK; the app is resized anyway', ios: true, fix: IOS_OPT_OUT_FIX },
  { re: /\bUIRequiresFullScreen\b(?!IgnoredStartingWithVersion)/g, what: 'UIRequiresFullScreen', why: 'deprecated since iPadOS 26 and ignored by apps built with the iOS 27 SDK; the app is resized anyway', ios: true, fix: IOS_OPT_OUT_FIX, redundantWhen: 'false', redundantWhy: 'Apple TN3192 asks apps not to include the key' },
  { re: /\bresizeableActivity\b/g, what: 'android:resizeableActivity', why: 'ignored on displays 600 dp and wider for apps targeting API 36', fix: ANDROID_OPT_OUT_FIX, redundantWhen: 'true', redundantWhy: 'resizable is already the default, and API 36 ignores the attribute on large screens' },
  { re: /\b(?:max|min)AspectRatio\b/g, what: 'an aspect-ratio limit', why: 'ignored on displays 600 dp and wider for apps targeting API 36', fix: ANDROID_OPT_OUT_FIX },
  { re: /\bPROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY\b/g, what: 'PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY', why: 'a temporary opt-out that stops working when the app targets API 37', fix: ANDROID_OPT_OUT_FIX },
];
// expo-screen-orientation's config plugin option: an iOS launch lock (OrientationLock names).
const INITIAL_ORIENTATION = /\binitialOrientation["']?\s*:\s*["'](\w+)["']/g;
const INITIAL_ORIENTATION_FAMILY = { PORTRAIT: 'portrait', PORTRAIT_UP: 'portrait', PORTRAIT_DOWN: 'portrait', LANDSCAPE: 'landscape', LANDSCAPE_LEFT: 'landscape', LANDSCAPE_RIGHT: 'landscape' };

function readContract(appRoot, layout, given) {
  const rel = given ?? toPosix(join(layout.contractsDir, 'adaptive-layout.json'));
  const path = join(appRoot, rel);
  if (!existsSync(path)) {
    if (given) fail(`contract ${rel} does not exist`, 'Pass an existing file to --contract, or leave it out to use contracts/adaptive-layout.json (optional).');
    return {};
  }
  let data;
  try {
    data = parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${rel} is not valid JSON: ${error.message}`, 'Fix the JSON (the skill ships templates/contracts/adaptive-layout.json and its schema).');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) fail(`${rel} must hold a JSON object`, 'Start from templates/contracts/adaptive-layout.json.');
  const bad = (key, what) => fail(`${rel} "${key}" must be ${what}`, 'See templates/contracts/adaptive-layout.schema.json.');
  for (const key of Object.keys(data)) {
    if (!CONTRACT_KEYS.includes(key)) fail(`${rel} has an unknown key "${key}"`, `Use only: ${CONTRACT_KEYS.join(', ')}.`);
  }
  if (data.appOrientation !== undefined && !ORIENTATIONS.includes(data.appOrientation)) bad('appOrientation', `one of ${ORIENTATIONS.join(', ')}`);
  if (data.tablets !== undefined && typeof data.tablets !== 'boolean') bad('tablets', 'true or false');
  if (data.tablets === false && (typeof data.tabletsReason !== 'string' || data.tabletsReason.trim() === '')) bad('tabletsReason', 'a non-empty reason when "tablets" is false');
  for (const key of ['listDetailScreens', 'breakpointModules', 'screenGlobs', 'layoutGlobs', 'readableComponents']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some((item) => typeof item !== 'string' || item.trim() === ''))) bad(key, 'a list of non-empty strings');
  }
  for (const key of ['fullBleedScreens', 'orientationLocks']) {
    const list = data[key];
    if (list === undefined) continue;
    const isEntry = (item) => item && typeof item === 'object' && typeof item.file === 'string' && item.file.trim() !== '' && typeof item.reason === 'string' && item.reason.trim() !== '';
    if (!Array.isArray(list) || !list.every(isEntry)) bad(key, 'a list of { "file": "<path>", "reason": "<why>" } entries, each with a non-empty reason');
  }
  if (data.maxFixedWidth !== undefined && (!Number.isInteger(data.maxFixedWidth) || data.maxFixedWidth < 1)) bad('maxFixedWidth', 'a positive integer');
  return data;
}

/** architecture-and-boundaries' testOnlyFolders (code only a test build carries), or none. */
function testOnlyFolders(appRoot, layout) {
  const path = join(appRoot, layout.contractsDir, 'architecture.json');
  if (!existsSync(path)) return [];
  try {
    const folders = parseJsonc(readFileSync(path, 'utf8'))?.testOnlyFolders;
    return Array.isArray(folders) ? folders.filter((f) => typeof f === 'string').map((f) => toPosix(f).replace(/\/?$/, '/')) : [];
  } catch {
    // A malformed architecture contract is architecture-and-boundaries' to report.
    return [];
  }
}

function settingsFrom(layout, contract) {
  const at = (...parts) => toPosix(join(...parts));
  return {
    windowClassFile: at(layout.srcDir, 'hooks', 'use-window-class.ts'),
    kitFile: at(layout.uiDir, 'adaptive', 'list-detail-layout.tsx'),
    breakpointModules: contract.breakpointModules ?? [at(layout.srcDir, 'hooks', 'use-window-class.ts'), `${at(layout.uiDir, 'adaptive')}/**`],
    screenGlobs: contract.screenGlobs ?? [`${layout.featuresDir}/**/*-screen.tsx`],
    // UI code only: services, core, data and api code lays nothing out.
    layoutGlobs: contract.layoutGlobs ?? [layout.routesDir, layout.featuresDir, layout.uiDir, at(layout.srcDir, 'hooks'), layout.themeDir].map((dir) => `${dir}/**`),
    readableComponents: contract.readableComponents ?? ['ScreenFrame', 'ListDetailLayout'],
    fullBleed: new Set((contract.fullBleedScreens ?? []).map((entry) => toPosix(entry.file))),
    locks: new Set((contract.orientationLocks ?? []).map((entry) => toPosix(entry.file))),
    listDetailScreens: (contract.listDetailScreens ?? []).map(toPosix),
    maxFixedWidth: contract.maxFixedWidth ?? DEFAULT_MAX_FIXED_WIDTH,
    appOrientation: contract.appOrientation,
    tablets: contract.tablets ?? true,
  };
}

function dependsOnReactNative(appRoot, repoRoot) {
  for (const dir of [appRoot, repoRoot]) {
    const path = join(dir, 'package.json');
    if (!existsSync(path)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      fail(`${toPosix(relative(repoRoot, path)) || 'package.json'} is not valid JSON: ${error.message}`, 'Fix package.json.');
    }
    const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
    return Object.hasOwn(deps, 'react-native');
  }
  return null;
}

const inAny = (rel, globs) => globs.some((glob) => matchGlob(rel, glob));

/** Matches in code only (not inside a comment or a string). */
function* codeMatches(source, masked, regex) {
  for (const match of masked.matchAll(regex)) {
    if (source[match.index] !== masked[match.index]) continue;
    yield match;
  }
}

function checkDeviceBranch(ctx) {
  for (const { re, what } of DEVICE_PATTERNS) {
    for (const match of codeMatches(ctx.source, ctx.masked, re)) {
      ctx.problem(match.index, 'device-branch', `${what} picks a layout by device: an iPad in Split View or Stage Manager, an unfolded foldable and an Android tablet in multi-window all lie to a device check.`, WINDOW_FIX);
    }
  }
}

function checkBreakpoints(ctx) {
  const seen = new Set();
  const report = (index, operand, shown, value = shown) => {
    if (seen.has(index) || Number(value) < BREAKPOINT_MIN || !SIZE_WORD.test(operand)) return;
    seen.add(index);
    ctx.problem(index, 'raw-breakpoint', `"${operand}" is compared with ${shown}: a breakpoint outside the window-class and pane modules drifts from every other screen's.`, 'Use useWindowClass().width (compact/regular at REGULAR_WIDTH_MIN), useListDetailLayout() or gridColumnsOf(); a new breakpoint goes into src/ui/adaptive/pane-layout.ts with its test at the window table.');
  };
  for (const match of codeMatches(ctx.source, ctx.masked, BREAKPOINT_LEFT)) report(match.index, match[1], match[3]);
  for (const match of codeMatches(ctx.source, ctx.masked, BREAKPOINT_RIGHT)) report(match.index, match[3], match[1]);
  const named = (index, operand, name) => {
    const value = ctx.constants.get(name);
    if (value !== undefined) report(index, operand, `${name} (${value})`, value);
  };
  for (const match of codeMatches(ctx.source, ctx.masked, BREAKPOINT_LEFT_NAME)) named(match.index, match[1], match[3]);
  for (const match of codeMatches(ctx.source, ctx.masked, BREAKPOINT_RIGHT_NAME)) named(match.index, match[3], match[1]);
}

/** File-local numeric constants (const TABLET = 768), so a breakpoint or a width behind a name is still read. */
function numericConstants(masked) {
  const constants = new Map();
  for (const match of masked.matchAll(NUMERIC_CONST)) constants.set(match[1], match[2]);
  return constants;
}

function checkFork(ctx, settings) {
  if (ctx.rel === settings.windowClassFile) return;
  for (const match of codeMatches(ctx.source, ctx.masked, FORK_PATTERN)) {
    ctx.problem(match.index, 'window-class-fork', `${match[1]} is defined outside ${settings.windowClassFile}: two classifiers disagree at the boundary and every screen must agree on what "regular" means.`, `Import it from ${settings.windowClassFile} (react-components-and-hooks owns it; ask that skill to extend it); pane and grid maths go in src/ui/adaptive/pane-layout.ts.`);
  }
}

function checkWidths(ctx, settings, isScreen) {
  const valueOf = (text) => {
    const word = text.trim();
    if (/^\d+(?:\.\d+)?$/.test(word)) return { value: word, shown: word };
    const value = ctx.constants.get(word);
    return value === undefined ? null : { value, shown: `${word} (${value})` };
  };
  const tooWide = (found) => found !== null && Number(found.value) > settings.maxFixedWidth;
  const fixedWidth = (index, key, found) => {
    ctx.problem(index, 'fixed-width', `${key} ${found.shown} is wider than the narrowest window allows (${settings.maxFixedWidth}: 320 pt minus the gutters); it overflows a split-screen pane or a small phone.`, 'Size by flex, a percentage, the pane layout (listWidth) or the measured container (useMeasuredWidth, gridCellWidthOf); cap reading width with maxWidth: CONTENT_MAX_WIDTH.');
  };
  for (const regex of [FIXED_WIDTH_KEY, FIXED_WIDTH_ATTR, FIXED_WIDTH_NAME]) {
    for (const match of codeMatches(ctx.source, ctx.masked, regex)) {
      const found = valueOf(match[2]);
      if (tooWide(found)) fixedWidth(match.index, match[1], found);
    }
  }
  for (const match of codeMatches(ctx.source, ctx.masked, FIXED_WIDTH_TERNARY)) {
    const found = [valueOf(match[2]), valueOf(match[3])].find(tooWide);
    if (found) fixedWidth(match.index, match[1], found);
  }
  for (const match of codeMatches(ctx.source, ctx.masked, MAX_WIDTH_KEY)) {
    if (Number(match[1]) < BREAKPOINT_MIN) continue;
    ctx.problem(match.index, 'readable-width-token', `maxWidth ${match[1]} is a hand-picked reading width${isScreen ? ' in a screen' : ''}: screens drift apart and the theme cannot change it.`, 'Use maxWidth: CONTENT_MAX_WIDTH from the theme tokens (design-system-structure owns its value).');
  }
}

function checkGrids(ctx) {
  if (!ctx.rel.endsWith('.tsx') && !ctx.rel.endsWith('.jsx')) return;
  for (const tag of findJsxTags(ctx.source, ctx.masked)) {
    if (!/^(?:FlatList|FlashList|Animated\.FlatList)$/.test(tag.name)) continue;
    const attrs = jsxAttributes(ctx.source, tag, ctx.masked);
    const columns = attrs.get('numColumns');
    if (!columns || columns.kind !== 'expr' || /^\d+$/.test(columns.value)) continue;
    if (!attrs.has('key')) {
      ctx.problem(tag.start, 'grid-columns-key', `${tag.name} computes numColumns (${columns.value}) without a key: React Native throws "Changing numColumns on the fly is not supported" the first time the window or pane is resized.`, `Add key={\`grid-\${${columns.value}}\`} so a new column count mounts a fresh list.`);
    }
    if (!/\bgridColumnsOf\b/.test(ctx.masked)) {
      ctx.problem(tag.start, 'grid-columns-source', `${tag.name} takes numColumns from ${columns.value}, not from gridColumnsOf(): columns follow the grid's own container (inside a pane the window is far wider than the grid).`, 'Measure the container with useMeasuredWidth() and pass gridColumnsOf({ width, minCellWidth, gap, maxColumns }).');
    }
  }
}

function checkOrientation(ctx, settings, isRoute, isLayoutCode) {
  const allowed = settings.locks.has(ctx.rel);
  for (const match of codeMatches(ctx.source, ctx.masked, LOCK_CALL)) {
    if (allowed) continue;
    ctx.problem(match.index, 'orientation-lock', `${match[1]}() locks the orientation: iPads with multitasking and Android displays 600 dp and wider (API 36) ignore it, and on phones it overrides the person's rotation.`, 'Lay the screen out for both shapes; a screen that truly needs a lock (camera capture, full-screen video) goes into contracts/adaptive-layout.json orientationLocks with its reason.');
  }
  if (allowed && /\blockAsync\s*\(/.test(ctx.masked) && !/\bunlockAsync\s*\(/.test(ctx.masked)) {
    const index = ctx.masked.search(/\blockAsync\s*\(/);
    ctx.problem(index, 'orientation-unlock', 'This screen locks the orientation and never unlocks it: every screen after it stays locked.', 'Call ScreenOrientation.unlockAsync() in the cleanup of the effect that locked (or when the screen loses focus).');
  }
  if (isRoute && !allowed) {
    for (const match of codeMatches(ctx.source, ctx.masked, ROUTE_ORIENTATION)) {
      const value = ctx.source.slice(match.index + match[0].length).match(/^\s*(['"])(\w*)\1/)?.[2];
      if (value !== undefined && UNLOCKED_ROUTE_ORIENTATIONS.has(value)) continue;
      ctx.problem(match.index, 'orientation-lock', 'A screen option locks this route\'s orientation: tablets and large Android displays ignore it, so the layout must handle both shapes anyway.', 'Remove the option, or list this file in contracts/adaptive-layout.json orientationLocks with its reason.');
    }
  }
  for (const match of codeMatches(ctx.source, ctx.masked, ORIENTATION_READ)) {
    if (allowed || !isLayoutCode) continue;
    ctx.problem(match.index, 'device-orientation', `${match[1]}() reads the device orientation, not the window: an iPad held in landscape gives a portrait-shaped Split View pane.`, 'Use useWindowClass().isLandscape (the window shape) for layout.');
  }
}

function checkReadable(ctx, settings) {
  const escaped = (word) => word.replace(/[.$]/g, '\\$&');
  // The cap token used anywhere in code, or a readable component rendered as a JSX tag (an import
  // alone renders nothing).
  const usesCap = new RegExp(`\\bCONTENT_MAX_WIDTH\\b`).test(ctx.masked);
  const rendersReadable = settings.readableComponents.some((name) => new RegExp(`<${escaped(name)}\\b`).test(ctx.masked));
  if (usesCap || rendersReadable) return;
  ctx.problem(0, 'readable-width', 'This screen never caps its content: on a 13-inch iPad in landscape a line of text runs 1,300 pt wide.', `Render it in ${settings.readableComponents.join(' or ')}, or cap the content (a list's contentContainerStyle) with width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center'; a canvas, map or camera screen goes into contracts/adaptive-layout.json fullBleedScreens with its reason.`);
}

function featureFolderOf(rel, layout) {
  const prefix = `${layout.featuresDir}/`;
  if (!rel.startsWith(prefix)) return dirname(rel);
  const feature = rel.slice(prefix.length).split('/')[0];
  return `${prefix}${feature}`;
}

/** True when the file imports anything inside `folder` (relative, or through a tsconfig alias). */
function importsFrom(rel, source, masked, folder, layout) {
  for (const match of source.matchAll(IMPORT_SPEC)) {
    if (masked[match.index] !== source[match.index]) continue;
    const spec = match[2];
    const candidates = spec.startsWith('.') ? [join(dirname(rel), spec)] : resolveAlias(spec, layout.aliases) ?? [];
    if (candidates.map((path) => toPosix(join(path))).some((path) => path === folder || path.startsWith(`${folder}/`))) return true;
  }
  return false;
}

function checkListDetail({ appRoot, layout, settings, sources, report, shown }) {
  const users = [...sources.entries()].filter(([rel, { masked, test }]) => !test && /<ListDetailLayout\b/.test(masked) && rel !== settings.kitFile);
  const folders = new Set(users.map(([rel]) => featureFolderOf(rel, layout)));
  for (const folder of folders) {
    const files = [...sources.entries()].filter(([rel, { test }]) => !test && rel.startsWith(`${folder}/`));
    let readsRoute = false;
    for (const [rel, { source, masked }] of files) {
      if (ROUTE_PARAMS.test(masked)) readsRoute = true;
      for (const match of codeMatches(source, masked, SELECTION_STATE)) {
        report.problem({ file: shown(rel), line: lineOf(source, match.index), rule: 'list-detail-selection', message: `"${match[1]}" holds the list-detail selection in component state: a rotation, a resize across the two-pane width or a link loses it, and the two layouts disagree.`, fix: 'Read the selection from the route: the list route\'s search param (useLocalSearchParams, router.setParams({ selected })) and the detail route\'s [id].' });
      }
    }
    // The feature may leave the params to its route files: a route file that imports from the feature
    // folder and reads them counts (any other route reading params proves nothing about this feature).
    if (!readsRoute) {
      const routeReads = [...sources.entries()].some(([rel, { source, masked, test }]) => !test && rel.startsWith(`${layout.routesDir}/`) && ROUTE_PARAMS.test(masked) && importsFrom(rel, source, masked, folder, layout));
      if (!routeReads) {
        const [firstRel] = users.find(([rel]) => featureFolderOf(rel, layout) === folder);
        report.problem({ file: shown(firstRel), line: 1, rule: 'list-detail-selection', message: 'This list-detail screen never reads its selection from the route: the selected item cannot survive a resize or open from a link.', fix: 'Read it with useLocalSearchParams() in the model hook (or the route file) and pass the id down.' });
      }
    }
  }
  if (settings.listDetailScreens.length > 0 && !existsSync(join(appRoot, settings.kitFile))) {
    report.problem({ file: shown(settings.kitFile), line: 1, rule: 'list-detail-screens', message: 'The contract lists list-detail screens but the pane kit is missing.', fix: 'Copy the skill\'s templates/src/ui/adaptive/ into src/ui/adaptive/ with their tests.' });
  }
  for (const rel of settings.listDetailScreens) {
    const entry = sources.get(rel);
    if (!entry) {
      report.problem({ file: shown(rel), line: 1, rule: 'list-detail-screens', message: 'contracts/adaptive-layout.json lists this list-detail screen, but the file does not exist.', fix: 'Fix the path in listDetailScreens, or remove the entry.' });
    } else if (!/<ListDetailLayout\b/.test(entry.masked)) {
      report.problem({ file: shown(rel), line: 1, rule: 'list-detail-screens', message: 'This list-detail screen does not render ListDetailLayout: on a wide window it stretches one list across the screen.', fix: 'Render <ListDetailLayout panes={model.panes} onePane={model.onePane} list={...} detail={...} emptyDetail={...} /> with panes from useListDetailLayout().' });
    }
  }
}

function findConfig(appRoot) {
  return CONFIG_FILES.find((file) => existsSync(join(appRoot, file))) ?? null;
}

function checkConfig({ appRoot, settings, report, shown, configRel, pluginFiles }) {
  if (!configRel) {
    const reason = notYetCreated(appRoot, { file: 'app.config.ts', owner: 'expo-project-bootstrap' });
    report.skip({ file: shown('app.config.ts'), rule: 'config-orientation', message: reason });
    return;
  }
  const source = readFileSync(join(appRoot, configRel), 'utf8');
  const code = maskComments(source);
  const problem = (index, rule, message, fix) => report.problem({ file: shown(configRel), line: lineOf(source, index), rule, message, fix });

  const orientations = [...code.matchAll(/["']?\borientation["']?\s*:\s*["'](\w+)["']/g)];
  const expected = settings.appOrientation;
  const allowed = expected ? [expected] : ['default', 'portrait'];
  for (const match of orientations) {
    if (allowed.includes(match[1])) continue;
    problem(match.index, 'config-orientation', expected
      ? `orientation is '${match[1]}' but contracts/adaptive-layout.json says '${expected}'.`
      : `orientation '${match[1]}' locks the whole app: tablets (iPad multitasking, Android 600 dp and wider on API 36) rotate it anyway, so the lock only removes the shape the phone layout was never tested in.`,
      expected ? 'Make the config and the contract agree.' : "Use 'portrait' (phones only, the Expo template default) or 'default'; a landscape-only app sets appOrientation: 'landscape' in contracts/adaptive-layout.json.");
  }
  if (expected && expected !== 'default' && orientations.length === 0) {
    problem(0, 'config-orientation', `contracts/adaptive-layout.json says appOrientation '${expected}' but the app config sets no orientation.`, `Set orientation: '${expected}' in the app config, or fix the contract.`);
  }
  for (const match of code.matchAll(INITIAL_ORIENTATION)) {
    const family = INITIAL_ORIENTATION_FAMILY[match[1]];
    if (!family || family === expected) continue;
    problem(match.index, 'config-orientation', `expo-screen-orientation's initialOrientation '${match[1]}' locks the app to ${family} at launch on iOS${expected ? `, but contracts/adaptive-layout.json says appOrientation '${expected}'` : ' and the contract names no appOrientation'}: iPads with multitasking and Android tablets rotate it anyway.`, `Remove the option (or use 'DEFAULT'), or record the deliberate profile: appOrientation: '${family}' in contracts/adaptive-layout.json and the same orientation in the app config.`);
  }

  for (const rel of [configRel, ...pluginFiles]) {
    const text = rel === configRel ? code : maskComments(readFileSync(join(appRoot, rel), 'utf8'));
    const original = rel === configRel ? source : readFileSync(join(appRoot, rel), 'utf8');
    const ignoredFrom = text.match(IGNORED_FROM)?.[1] ?? null;
    const keepsForOlderIos = ignoredFrom !== null && Number(ignoredFrom) <= IGNORED_FROM_MAX;
    const versionNote = ignoredFrom !== null && !keepsForOlderIos ? ` (UIRequiresFullScreenIgnoredStartingWithVersion '${ignoredFrom}' does not count: TN3192 needs ${IGNORED_FROM_MAX} or lower)` : '';
    for (const { re, what, why, ios, fix, redundantWhen, redundantWhy } of OPT_OUTS) {
      if (ios && keepsForOlderIos) continue;
      for (const match of text.matchAll(re)) {
        const value = KEY_VALUE.exec(text.slice(match.index + match[0].length))?.[2];
        const message = redundantWhen !== undefined && value === redundantWhen
          ? `${what} set to ${value} is redundant: ${redundantWhy}; remove it.`
          : `${what} opts out of resizing: ${why}${ios ? versionNote : ''}.`;
        report.problem({ file: shown(rel), line: lineOf(original, match.index), rule: 'full-screen-opt-out', message, fix: redundantWhen !== undefined && value === redundantWhen ? `Remove the key from the app config (or the config plugin that writes it); nothing else changes.` : fix });
      }
    }
  }

  const tabletOn = /\b(?:supportsTablet|isTabletOnly)["']?\s*:\s*true\b/.test(code);
  if (settings.tablets && !tabletOn) {
    const at = code.search(/\bsupportsTablet\b/);
    problem(at === -1 ? 0 : at, 'tablet-support', 'ios.supportsTablet is not true: the app runs on iPad as a scaled-up phone app in a compatibility frame, and the App Store shows it as iPhone-only.', 'Set ios: { supportsTablet: true } and give regular windows their layout; an app that deliberately ships no iPad layout sets "tablets": false with "tabletsReason" in contracts/adaptive-layout.json.');
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const repoRoot = requireDir(positionals[0] ?? '.', 'app repo root');
  const appRoot = options['app-dir'] ? requireDir(join(repoRoot, options['app-dir']), 'app folder') : repoRoot;
  const usesReactNative = dependsOnReactNative(appRoot, repoRoot);
  if (usesReactNative === null) fail('nothing to check: no package.json', 'Run from the app repo root, pass it (node check-adaptive-layout.mjs <repo-root>), or --app-dir <dir> when multi-package.');
  const report = createReporter({ name: 'check-adaptive-layout', json: options.json });
  if (!usesReactNative) return report.notApplicable('react-native is not in package.json');

  const layout = resolveLayout(appRoot);
  const contract = readContract(appRoot, layout, options.contract);
  const settings = settingsFrom(layout, contract);
  const testOnly = testOnlyFolders(appRoot, layout);
  const shown = (rel) => toPosix(relative(repoRoot, join(appRoot, rel))) || rel;
  const all = walkRepo(appRoot, { include: CODE_FILES, ignore: ['**/*.d.ts'] });
  const files = all.filter((rel) => rel.startsWith(`${layout.srcDir}/`) || rel.startsWith(`${layout.routesDir}/`));
  if (files.length === 0) fail(`nothing to check: no source file under ${layout.srcDir}/`, 'Run from the app repo root, or set "srcDir" in rn-skills.config.json when the source folder moved.');
  const pluginFiles = all.filter((rel) => rel.startsWith('plugins/') && !isTestFile(rel));

  const sources = new Map();
  for (const rel of files) {
    const source = readFileSync(join(appRoot, rel), 'utf8');
    sources.set(rel, { source, masked: maskCode(source), test: isTestFile(rel) });
  }

  for (const [rel, { source, masked, test }] of sources) {
    if (test) continue;
    const ctx = { rel, source, masked, constants: numericConstants(masked), problem: (index, rule, message, fix) => report.problem({ file: shown(rel), line: lineOf(source, index), rule, message, fix }) };
    const isBreakpointModule = inAny(rel, settings.breakpointModules);
    const isTheme = rel.startsWith(`${layout.themeDir}/`);
    const isScreen = inAny(rel, settings.screenGlobs);
    const isLayoutCode = inAny(rel, settings.layoutGlobs);
    if (isLayoutCode) {
      checkDeviceBranch(ctx);
      if (!isBreakpointModule) checkBreakpoints(ctx);
      if (!isBreakpointModule && !isTheme) checkWidths(ctx, settings, isScreen);
      checkGrids(ctx);
    }
    checkFork(ctx, settings);
    checkOrientation(ctx, settings, rel.startsWith(`${layout.routesDir}/`), isLayoutCode);
    // A test-only screen (the debug menu, a capture harness) never ships in a store build.
    if (isScreen && !settings.fullBleed.has(rel) && !testOnly.some((folder) => rel.startsWith(folder))) checkReadable(ctx, settings);
  }

  const missingWindowClass = notYetCreated(appRoot, { file: settings.windowClassFile, owner: 'react-components-and-hooks' });
  if (missingWindowClass) report.skip({ file: shown(settings.windowClassFile), rule: 'window-class-fork', message: missingWindowClass });

  checkListDetail({ appRoot, layout, settings, sources, report, shown });
  checkConfig({ appRoot, settings, report, shown, configRel: findConfig(appRoot), pluginFiles });

  return report.finish({ checked: files.length, unit: 'files' });
});
