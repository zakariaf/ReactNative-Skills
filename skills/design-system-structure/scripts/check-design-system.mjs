#!/usr/bin/env node
// check-design-system.mjs: proves the app's design system holds together: the theme modules equal
// the token file, every palette passes the app's contrast table, text sits on the pixel grid with
// tall scripts guarded, the press surface sinks by layout, the bundled fonts are the pinned files
// with matching names, dark mode is configured on both platforms, and the providers are mounted.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-design-system.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, lineOf, notYetCreated, parseArgs, requireDir, resolveLayout, run, sha256, walkRepo } from './check-lib.mjs';
import { enableAppImports, errorText, lineOfExport } from './lib/app-modules.mjs';
import { aliasesOf, closingIndex, constExpression, constInitializer, diffObject, functionRange, importsOf, inRanges, jsxAttribute, lineOfPattern, masked, normalDir, openingTagEnd, readSource, sameValue, show, specifierNames, splitTopLevel, typeRange, valueExpression, within } from './lib/app-source.mjs';
import { SYSTEM_FONT, bundledFonts, modulePaths, otherStylingPackage, readContract, weightByOf } from './lib/design-contract.mjs';
import { FontTableError, readFontFile } from './lib/font-tables.mjs';
import { CORE_FIELDS, applyExceptions, readContrastContract, schemeProblems, tableFor } from './lib/palette-rules.mjs';
import { getPath, resolveTokens } from './lib/token-file.mjs';

const SPEC = {
  name: 'check-design-system',
  summary: 'Checks that the theme modules equal the token file, palettes pass the contrast pairs, text metrics and tall-script guards hold, fonts are the pinned files, dark mode is configured and the providers are mounted.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The contract (default: <contractsDir>/design-system.json from resolveLayout)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  contract-missing            contracts/design-system.json is missing',
    '  theme-file-missing          a theme or ui module of the design system is missing',
    '  theme-module-load           a theme data module does not load as pure TypeScript (it imports React Native or runs code)',
    '  token-file                  the token file is missing or not JSON, an alias points nowhere, or a mapped token path is absent',
    '  theme-mismatch              an export (SPACING, TYPE_STYLES, MOTION_MS, PALETTE.light ...) differs from its token path',
    '  color-tokens-fields         ColorTokens lacks a core role (background, surface, text, textMuted, primary, onPrimary, border, focus, danger)',
    '  palette-missing / palette-shape / palette-hex / palette-contrast / palette-fill',
    '                              a palette is missing, malformed, not uppercase hex, fails a text (4.5:1) or graphics',
    '                              (3:1) pair, or a filled shape has no 3:1 ground or edge. The pairs come from',
    '                              contracts/contrast.json (accessibility-as-code) when it exists, else the default pairs;',
    '                              the core pairs are checked either way; translucent colours are painted over their ground',
    '  palette-colorblind          a colour-blind variant changes no primary or status colour (a setting that changes nothing)',
    '  palette-invariant           an invariant role (danger, focus ...) differs between palettes',
    '  line-height-grid            line heights are not on the device pixel grid at the current font scale',
    '                              (lineHeight: snapToPixels(fontSize * ratio * fontScale) / fontScale; snapToGrid)',
    '  no-glyph-nudge              the text-style hook or AppText moves glyphs with translateY, top, padding or margin',
    '                              (the overflow guard is the one exception)',
    '  tall-script-overflow-guard  a tall script lacks metrics, the metrics differ from the font file (hhea), or AppText',
    '                              lacks the guard (pads from the metrics, negative margins, a wrapper View with the',
    '                              testID; the guard function multiplies size and line height by useFontScale())',
    '  tall-script-line-height     a style gives a tall script a tighter box than Latin, or is below the contract minimum',
    '  balanced-display            AppText does not balance display text, or the balance hook sets state from a closure',
    '  tabular-digits              a contract tabular style lacks isTabular, or AppText does not map it to tabular-nums',
    '  spring-config-complete      a spring token leaves damping, stiffness or mass to the library default',
    '  pressed-by-layout           (when PRESS.kind is sink or the surface supports it) a pushed-in key sinks by a',
    '                              transform instead of top: elevation',
    '  font-family                 a family in fonts.ts has no bundled file of that name, or its PostScript name differs',
    '                              (fonts.weightBy "fontWeight": the family is a fontFamily of the expo-font entry); fonts.ts',
    '                              names a family while the contract says "fonts": "system"; or the contract bundles files',
    '                              while fonts.ts draws every script with the system font',
    '  font-files                  (bundled fonts) a contract font is missing, differs from its sha256, or its family has',
    '                              no licence file',
    '  font-plugin                 (bundled fonts) the expo-font config plugin entry is missing or misses a contract font',
  '  font-script-coverage        (a bundled Latin family) a language of <i18nDir>/languages.ts written in another script',
  '                              by default (ja, ru, hi ...) has no LANGUAGE_SCRIPTS entry, so its text draws with the',
  '                              Latin family and the platform fills the missing glyphs from a fallback font',
    '  color-scheme-config         a userInterfaceStyle (top level, ios or android) is not "automatic", a platform is left',
    '                              to Expo\'s light default, or expo-system-ui (Android) is not installed. A same-file const',
    '                              is followed (userInterfaceStyle: UI_STYLE); app.json is the base an app.config.* that',
    '                              spreads ...config overrides',
    '  theme-provider-behaviour    the provider does not mirror the preference to Appearance.setColorScheme or paint the',
    '                              root view with SystemUI.setBackgroundColorAsync',
    '  theme-provider-mounted      no runtime file renders the app\'s provider imported from <themeDir>/theme-provider',
    '                              (the navigation ThemeProvider of expo-router does not count). The mount target is the',
    '                              routes layout with expo-router, else App.tsx or the package.json "main" file (React',
    '                              Navigation); SKIP only while that target does not exist',
    '  navigation-theme-mapped     (expo-router or @react-navigation/native in package.json) no navigation ThemeProvider,',
    '                              NavigationContainer or static <Navigation theme> takes its colours from the app theme:',
    '                              a bare DarkTheme / DefaultTheme (or a ternary of them), a missing value, a theme built',
    '                              without the theme folder, a mapping that neither the routes nor the app entry',
    '                              renders (directly or through components of other files), or one rendered outside',
    '                              AppThemeProvider (followed through those components) leaves headers, the tab bar',
    '                              and screen backgrounds on React Navigation\'s own light theme',
    '  second-theme-system         outside the theme folder, a second theme: the create-expo-app template\'s',
    '                              constants/theme.ts (Colors light/dark) or a use-theme.ts / useTheme export',
    '  text-locale-provided        a multi-script app mounts no TextLocaleProvider (SKIP until src/i18n exists)',
    '',
    'Folders come from the canonical layout: src/ (rn-skills.config.json "srcDir"; "." for an app without src/),',
    'routes in src/app or app/ at the root; the contract "files" key moves single modules.',
    'NOT APPLICABLE when package.json has another styling system (nativewind, tamagui, restyle, unistyles,',
    'styled-components) and the theme folder does not exist.',
    'Example: node check-design-system.mjs .   (from the app repo root)',
  ].join('\n'),
};

/** Text line heights at 3x (14 x 1.3, 17 x 1.32, 17 x 1.5): pure grid arithmetic, any app. */
const GRID_CASES = [[18.2, 55 / 3], [22.44, 67 / 3], [25.5, 77 / 3]];
const GRID_FIX = 'Copy use-text-style.ts and type-styles.ts from the templates: lineHeight = snapToPixels(fontSize * ratio * fontScale) / fontScale, never whole points and never the raw fraction.';
const STATUS_FIELDS = ['primary', 'danger', 'success', 'warning'];
const fixCopy = (file) => `Copy templates/${file} into the app (or point contracts/design-system.json "files" at your module).`;

function createContext(root, options, report) {
  const layout = resolveLayout(root);
  const { rel: contractRel, contract } = readContract(root, layout, options.contract);
  const app = enableAppImports(root);
  const loaded = new Map();
  let manifest = {};
  try {
    manifest = JSON.parse(readSource(join(root, 'package.json')) ?? '{}') ?? {};
  } catch {
    manifest = {};
  }
  const ctx = { root, layout, report, contract, contractRel, manifest, deps: { ...manifest.dependencies, ...manifest.devDependencies }, paths: modulePaths(layout, contract), contrast: readContrastContract(root, layout), checked: 0 };
  ctx.exists = (rel) => existsSync(join(root, rel));
  ctx.source = (rel) => readSource(join(root, rel));
  ctx.load = async (rel) => {
    if (loaded.has(rel)) return loaded.get(rel);
    let module = null;
    if (ctx.exists(rel) && /\.(m?ts)$/.test(rel)) {
      try {
        module = await app.load(rel);
      } catch (error) {
        report.problem({ file: rel, line: 1, rule: 'theme-module-load', message: `does not load as pure data: ${errorText(error)}`, fix: 'Keep theme data modules free of React Native, Expo and side effects (type imports only, plain objects), as the templates are.' });
      }
    }
    loaded.set(rel, module);
    return module;
  };
  return ctx;
}

/** The module that exports `name` per the contract, else the default module for `key`. */
function fileOfExport(ctx, name, key) {
  return ctx.contract?.exports?.find((entry) => entry.name === name)?.file ?? ctx.paths[key];
}

function checkRequiredFiles(ctx) {
  for (const rel of Object.values(ctx.paths)) {
    ctx.checked += 1;
    if (!ctx.exists(rel)) ctx.report.problem({ file: rel, rule: 'theme-file-missing', message: 'a module of the design system is missing', fix: fixCopy(rel) });
  }
}

function loadTokenFile(ctx) {
  const rel = ctx.contract.tokens;
  const text = ctx.source(rel);
  const problem = (message, line = 1) => ctx.report.problem({ file: rel, line, rule: 'token-file', message, fix: 'Fix the token file: every alias names an existing token as {group.name}; the theme modules copy it.' });
  if (text === null) {
    problem('the token file named by the contract does not exist');
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    problem(`not valid JSON: ${error.message}`);
    return null;
  }
  ctx.checked += 1;
  const { tree, problems } = resolveTokens(raw);
  for (const entry of problems) problem(entry.message, lineOf(text, Math.max(0, text.indexOf(`{${entry.alias}}`))));
  return { rel, raw, tree, problem };
}

function checkColorTokens(ctx) {
  const file = ctx.paths.themeTypes;
  const source = ctx.source(file);
  if (source === null) return;
  const text = masked(source);
  const range = typeRange(text, 'ColorTokens');
  const fields = new Set(range ? [...text.slice(range[0], range[1]).matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]) : []);
  const missing = CORE_FIELDS.filter((field) => !fields.has(field));
  ctx.checked += 1;
  if (missing.length > 0) {
    ctx.report.problem({ file, line: lineOfPattern(text, /type ColorTokens/), rule: 'color-tokens-fields', message: `ColorTokens lacks the core role${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`, fix: 'Add the role to ColorTokens and to every scheme of the token file, then rerun write-palette.mjs.' });
  }
}

function reportDiffs(ctx, { file, name, actual, expected, line }) {
  const fix = 'Copy the value from the token file (or regenerate the palette with write-palette.mjs); change the token file first when the design changes.';
  if (actual === undefined) {
    ctx.report.problem({ file, line, rule: 'theme-mismatch', message: `${name} is not exported`, fix });
    return;
  }
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const diffs = isObject(actual) && isObject(expected) ? diffObject(actual, expected) : sameValue(actual, expected) ? [] : [{ key: '', actual, expected }];
  for (const diff of diffs.slice(0, 12)) {
    const where = diff.key === '' ? name : `${name}.${diff.key}`;
    ctx.report.problem({ file, line, rule: 'theme-mismatch', message: `${where} is ${show(diff.actual)}, the token file says ${show(diff.expected)}`, fix });
  }
}

async function checkExports(ctx, tokens) {
  for (const entry of ctx.contract.exports) {
    ctx.checked += 1;
    if (!ctx.exists(entry.file)) {
      if (!Object.values(ctx.paths).includes(entry.file)) ctx.report.problem({ file: entry.file, rule: 'theme-file-missing', message: `the contract maps ${entry.name} to a file that does not exist`, fix: 'Create the module or fix "exports" in the contract.' });
      continue;
    }
    const expected = getPath(tokens.tree, entry.token);
    if (expected === undefined) {
      tokens.problem(`the contract maps ${entry.name} to "${entry.token}", which the token file does not hold`);
      continue;
    }
    const module = await ctx.load(entry.file);
    if (module === null) continue;
    const line = lineOfExport(ctx.source(entry.file), entry.name);
    reportDiffs(ctx, { file: entry.file, name: entry.name, actual: module[entry.name], expected, line });
  }
}

function schemesOf(palette) {
  const schemes = [['light', palette.light], ['dark', palette.dark]];
  if (palette.colorBlind) schemes.push(['colorBlind.light', palette.colorBlind.light], ['colorBlind.dark', palette.colorBlind.dark]);
  return schemes;
}

function isSchemeSet(value) {
  return value !== null && typeof value === 'object' && typeof value.light === 'object' && value.light !== null && typeof value.dark === 'object' && value.dark !== null;
}

function checkColorBlind(ctx, entry, palette, line) {
  if (palette.colorBlind === undefined) return;
  if (!isSchemeSet(palette.colorBlind)) {
    ctx.report.problem({ file: entry.file, line, rule: 'palette-shape', message: `${entry.export}.colorBlind must hold { light, dark }`, fix: 'Regenerate the palette with write-palette.mjs.' });
    return;
  }
  const changes = ['light', 'dark'].some((scheme) => STATUS_FIELDS.some((field) => palette.colorBlind[scheme][field] !== palette[scheme][field]));
  if (!changes) {
    ctx.report.problem({ file: entry.file, line, rule: 'palette-colorblind', message: `${entry.export}.colorBlind changes no primary or status colour, so the colour-blind setting changes nothing`, fix: 'Give the variant distinguishable status colours in the token file ("colorBlind"), or drop it and carry meaning by shape and text (accessibility-as-code).' });
  }
}

function noteTable(ctx, entry, table) {
  const pairs = table.text.length + table.graphics.length + table.shapes.length;
  const from = table.source ? `${table.source} (palette "${table.name ?? entry.file}") plus the core pairs` : `the default pairs (no ${ctx.contrast.rel} entry for ${entry.file}; accessibility-as-code adds the contract)`;
  ctx.report.note(`palette-contrast: ${entry.export} is judged by ${pairs} pairs from ${from}`);
}

async function checkPalette(ctx, entry, { tokens }) {
  ctx.checked += 1;
  if (!ctx.exists(entry.file)) {
    if (entry.file !== ctx.paths.palette) ctx.report.problem({ file: entry.file, rule: 'palette-missing', message: `the contract lists palette ${entry.export}, but the file does not exist`, fix: 'Run: node ${CLAUDE_SKILL_DIR}/scripts/write-palette.mjs . (with --out and --token for a second palette).' });
    return null;
  }
  const module = await ctx.load(entry.file);
  if (module === null) return null;
  const palette = module[entry.export];
  const line = lineOfExport(ctx.source(entry.file), entry.export);
  if (!isSchemeSet(palette)) {
    ctx.report.problem({ file: entry.file, line, rule: 'palette-shape', message: `${entry.export} must export { light, dark } (and optionally colorBlind)`, fix: 'Regenerate the palette with write-palette.mjs.' });
    return null;
  }
  const table = tableFor(ctx.contrast, { file: entry.file, exportName: entry.export });
  noteTable(ctx, entry, table);
  for (const [label, colors] of schemesOf(palette)) {
    const { accepted, left } = applyExceptions(label, schemeProblems(`${entry.export}.${label}`, colors, table), table);
    for (const text of accepted) ctx.report.note(`note: ${text}`);
    for (const problem of left) {
      ctx.report.problem({ file: entry.file, line, rule: problem.rule, message: problem.message, fix: 'Change the colour in the token file (keep the hue, move the lightness), then rerun write-palette.mjs; never drop the pair.' });
    }
  }
  checkColorBlind(ctx, entry, palette, line);
  const expected = tokens ? getPath(tokens.tree, entry.token) : undefined;
  if (tokens && !isSchemeSet(expected)) tokens.problem(`the contract maps ${entry.export} to "${entry.token}", which holds no { light, dark } colours`);
  else if (tokens) {
    for (const [label, colors] of schemesOf(palette)) reportDiffs(ctx, { file: entry.file, name: `${entry.export}.${label}`, actual: colors, expected: getPath(expected, label), line });
  }
  return { entry, palette, line };
}

async function checkPalettes(ctx, tokens) {
  const entries = ctx.contract?.palettes ?? [{ file: ctx.paths.palette, export: 'PALETTE', token: 'color' }];
  const found = [];
  for (const entry of entries) {
    const result = await checkPalette(ctx, entry, { tokens });
    if (result) found.push(result);
  }
  for (const field of ctx.contract?.invariantFields ?? []) {
    for (const scheme of ['light', 'dark']) {
      const first = found[0];
      const other = found.find((item) => item.palette[scheme][field] !== first.palette[scheme][field]);
      if (other) {
        ctx.report.problem({ file: other.entry.file, line: other.line, rule: 'palette-invariant', message: `${other.entry.export}.${scheme}.${field} is ${other.palette[scheme][field]}, but ${field} is the same in every palette (${first.entry.export}: ${first.palette[scheme][field]})`, fix: 'Keep invariant roles identical in every palette of the token file, or remove the role from "invariantFields".' });
      }
    }
  }
}

/** Whether the identifier `id` holds the font scale in `text` (useFontScale(), a .fontScale read, or { fontScale } = useWindowDimensions()). */
function boundToFontScale(text, id) {
  if (!/^[A-Za-z_$][\w$]*$/.test(id)) return false;
  return new RegExp(`\\b(?:const|let)\\s+${id}\\s*(?::[^=;]+)?=\\s*[^;]*(?:useFontScale\\s*\\(|\\.fontScale\\b)`).test(text)
    || (id === 'fontScale' && /\{[^}]*\bfontScale\b[^}]*\}\s*=\s*useWindowDimensions\s*\(/.test(text));
}

/** Whether an argument expression is the font scale. */
function isFontScaleExpr(text, arg) {
  return /\buseFontScale\s*\(\s*\)/.test(arg) || /\.fontScale\b/.test(arg) || boundToFontScale(text, arg.trim());
}

/** Whether `body` multiplies `field` (fontSize, lineHeight) by the identifier `id`. */
function multipliesBy(body, field, id) {
  return new RegExp(`\\b${field}\\b[^,;]*?\\*\\s*${id}\\b|\\b${id}\\s*\\*[^,;]*?\\b${field}\\b`).test(body);
}

/**
 * The line height must be snapped where React Native draws it: the style's box times the font
 * scale, snapped, divided back (lineHeight: snapToPixels(fontSize * ratio * fontScale) / fontScale).
 * Returns the problem text, or null.
 */
function lineHeightGridGap(text) {
  if (!/PixelRatio\.get\s*\(\s*\)/.test(text)) return 'the line height is not snapped to the device pixel grid (snapToPixels with PixelRatio.get())';
  const head = /\blineHeight\s*:\s*snapToPixels\s*\(/.exec(text);
  if (head === null) return 'the line height is not snapped to the device pixel grid (lineHeight: snapToPixels(...) with PixelRatio.get())';
  const open = head.index + head[0].length - 1;
  const close = closingIndex(text, open);
  const inner = close < 0 ? '' : text.slice(open + 1, close - 1);
  const divisor = close < 0 ? null : /^\s*\/\s*([A-Za-z_$][\w$]*)\b/.exec(text.slice(close))?.[1] ?? null;
  const isScaled = divisor !== null && new RegExp(`\\*\\s*${divisor}\\b|\\b${divisor}\\s*\\*`).test(inner) && boundToFontScale(text, divisor);
  return isScaled ? null : 'the line height is snapped at the unscaled size: React Native multiplies lineHeight by the font scale, so at every text size but 100 % the drawn box leaves the grid (lineHeight: snapToPixels(fontSize * ratio * fontScale) / fontScale, fontScale from useFontScale())';
}

function checkTextMetrics(ctx, typeStyles) {
  const hookFile = ctx.paths.textStyle;
  const hook = ctx.source(hookFile);
  if (hook !== null) {
    const text = masked(hook);
    ctx.checked += 1;
    const gap = lineHeightGridGap(text);
    if (gap !== null) ctx.report.problem({ file: hookFile, line: lineOfPattern(text, /\blineHeight\s*:/), rule: 'line-height-grid', message: gap, fix: GRID_FIX });
  }
  if (typeStyles) {
    const file = fileOfExport(ctx, 'TYPE_STYLES', 'typeStyles');
    if (typeof typeStyles.snapToGrid !== 'function') {
      ctx.report.problem({ file, line: 1, rule: 'line-height-grid', message: 'type-styles.ts does not export snapToGrid(points, pixelRatio)', fix: GRID_FIX });
    } else {
      for (const [points, want] of GRID_CASES) {
        const got = typeStyles.snapToGrid(points, 3);
        if (!sameValue(got, want)) ctx.report.problem({ file, line: lineOfExport(ctx.source(file), 'snapToGrid'), rule: 'line-height-grid', message: `snapToGrid(${points}, 3) is ${show(got)}, the 3x pixel grid says ${Math.round(want * 3)}/3`, fix: GRID_FIX });
      }
    }
  }
  for (const file of [hookFile, ctx.paths.appText]) {
    const source = ctx.source(file);
    if (source === null) continue;
    const text = masked(source);
    const guard = file === ctx.paths.appText ? [functionRange(text, 'overflowGuardOf'), typeRange(text, 'OverflowGuard')].filter(Boolean) : [];
    for (const match of text.matchAll(/\b(translateY|top|paddingTop|paddingBottom|paddingBlock|paddingVertical|marginTop|marginBottom|marginBlock|marginVertical)\s*:/g)) {
      if (inRanges(match.index, guard)) continue;
      ctx.report.problem({ file, line: lineOf(text, match.index), rule: 'no-glyph-nudge', message: `${match[1]} moves the text box to nudge its glyphs`, fix: 'Remove it: line boxes are exact on the pixel grid, and a per-size nudge breaks every height built on them (only overflowGuardOf pads tall-script text, from the font metrics).' });
    }
  }
}

function checkBalance(ctx) {
  const appText = ctx.source(ctx.paths.appText);
  const fix = 'Copy app-text.tsx and use-balanced-wrap.ts from the templates: display text runs useBalancedWrap(style.face === \'display\', ...), and the hook updates its state functionally (references/text-and-fonts.md, "Balanced display text").';
  if (appText !== null) {
    ctx.checked += 1;
    if (!/\buseBalancedWrap\s*\(\s*style\.face\s*===\s*['"]display['"]/.test(masked(appText))) {
      ctx.report.problem({ file: ctx.paths.appText, line: lineOfPattern(appText, /useBalancedWrap/), rule: 'balanced-display', message: 'AppText wraps display text greedily, so a two-line heading leaves one word alone on its last line', fix });
    }
  }
  const hook = ctx.source(ctx.paths.balancedWrap);
  if (hook !== null) {
    const text = masked(hook);
    ctx.checked += 1;
    if ([...text.matchAll(/\bset\w*\(\s*\(\s*\w+\s*\)\s*=>/g)].length < 2) {
      ctx.report.problem({ file: ctx.paths.balancedWrap, line: lineOfPattern(text, /\bonTextLayout\b/), rule: 'balanced-display', message: 'the balance search sets its state from a closure: iOS sends onTextLayout and onLayout in one batch, so one update is lost and the search never starts on a device', fix });
    }
  }
}

function styleOf(scale, styles, name) {
  return scale?.[name] ?? styles?.[name];
}

function checkTabular(ctx, scale, styles) {
  const names = ctx.contract?.text?.tabularStyles ?? ['number'];
  const fix = 'Give the style isTabular: true in the token file and the theme module; AppText maps it to fontVariant [\'tabular-nums\'].';
  for (const name of names) {
    ctx.checked += 1;
    const style = styleOf(scale, styles, name);
    if (!style && (scale || styles)) ctx.report.problem({ file: ctx.contractRel, rule: 'tabular-digits', message: `text.tabularStyles names "${name}", which is no type role or style`, fix: 'Name a TYPE_SCALE role or a TYPE_STYLES entry.' });
    else if (style && style.isTabular !== true) ctx.report.problem({ file: fileOfExport(ctx, scale?.[name] ? 'TYPE_SCALE' : 'TYPE_STYLES', scale?.[name] ? 'tokens' : 'typeStyles'), line: 1, rule: 'tabular-digits', message: `${name} has no isTabular: true, so its digits are proportional and a changing count jitters`, fix });
  }
  const appText = ctx.source(ctx.paths.appText);
  if (appText !== null && !(/\bisTabular\b/.test(appText) && /\bfontVariant\s*:\s*\[\s*['"]tabular-nums['"]\s*\]/.test(masked(appText)))) {
    ctx.report.problem({ file: ctx.paths.appText, line: lineOfPattern(appText, /fontVariant|isTabular/), rule: 'tabular-digits', message: 'AppText does not map isTabular to fontVariant [\'tabular-nums\']', fix });
  }
}

function checkTallLineHeights(ctx, scale, styles) {
  for (const [exportName, table] of [['TYPE_SCALE', scale], ['TYPE_STYLES', styles]]) {
    for (const [name, style] of Object.entries(table ?? {})) {
      const ratios = style?.lineHeight;
      if (typeof ratios?.tall === 'number' && typeof ratios?.base === 'number' && ratios.tall < ratios.base) {
        ctx.report.problem({ file: fileOfExport(ctx, exportName, exportName === 'TYPE_SCALE' ? 'tokens' : 'typeStyles'), line: 1, rule: 'tall-script-line-height', message: `${exportName}.${name} gives tall scripts ${ratios.tall}, tighter than its base ${ratios.base}: tall glyphs need at least the Latin box`, fix: 'Raise the tall ratio in the token file and the theme module.' });
      }
    }
  }
  for (const [name, min] of Object.entries(ctx.contract?.text?.minTallLineHeight ?? {})) {
    ctx.checked += 1;
    const style = styleOf(scale, styles, name);
    if (!style) ctx.report.problem({ file: ctx.contractRel, rule: 'tall-script-line-height', message: `text.minTallLineHeight names "${name}", which is no type role or style`, fix: 'Name a TYPE_SCALE role or a TYPE_STYLES entry.' });
    else if (style.lineHeight?.tall < min) ctx.report.problem({ file: fileOfExport(ctx, scale?.[name] ? 'TYPE_SCALE' : 'TYPE_STYLES', scale?.[name] ? 'tokens' : 'typeStyles'), line: 1, rule: 'tall-script-line-height', message: `${name} gives tall scripts ${style.lineHeight.tall}, below the ${min} the contract records (tall digits lose their tops below it)`, fix: `Write ${name} with a tall ratio of at least ${min} in the token file and the theme module.` });
  }
}

function fontFileOf(ctx, family) {
  const dir = bundledFonts(ctx.contract)?.dir;
  if (!dir) return null;
  for (const ext of ['.ttf', '.otf']) if (ctx.exists(posix.join(dir, `${family}${ext}`))) return posix.join(dir, `${family}${ext}`);
  return null;
}

/** Parameter names of the function at `range` (masked text). */
function paramNames(text, range) {
  const open = text.indexOf('(', range[0]);
  const close = closingIndex(text, open);
  if (open < 0 || close < 0) return [];
  return splitTopLevel(text.slice(open + 1, close - 1)).map((part) => /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)/.exec(part.text)?.[1]).filter(Boolean);
}

/**
 * The guard is computed on the drawn sizes: the function that calls overflowGuardOf multiplies both
 * the font size and the line height by the font scale, and a scale that arrives as a parameter is
 * the font scale at every call (guardFor(textStyle, 1) is the unscaled guard in disguise).
 */
function guardScaleGaps(text) {
  const functions = [...text.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => ({ name: match[1], range: functionRange(text, match[1]) })).filter((fn) => fn.range !== null);
  const guardFn = functions.find((fn) => fn.name !== 'overflowGuardOf' && /\boverflowGuardOf\s*\(/.test(text.slice(...fn.range)));
  if (!guardFn) return ['a function that calls overflowGuardOf with the drawn sizes'];
  const body = text.slice(...guardFn.range);
  const params = paramNames(text, guardFn.range);
  const locals = [...body.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]).filter((id) => boundToFontScale(body, id));
  const scaleBy = (field) => [...params, ...locals].find((id) => multipliesBy(body, field, id)) ?? null;
  const sizeBy = scaleBy('fontSize');
  const lineBy = scaleBy('lineHeight');
  const gaps = [];
  if (sizeBy === null) gaps.push(`the drawn font size in ${guardFn.name} (fontSize x the font scale)`);
  if (lineBy === null) gaps.push(`the drawn line height in ${guardFn.name} (lineHeight x the font scale)`);
  for (const id of new Set([sizeBy, lineBy].filter((name) => name !== null && params.includes(name)))) {
    const position = params.indexOf(id);
    for (const call of text.matchAll(new RegExp(`\\b${guardFn.name}\\s*\\(`, 'g'))) {
      if (inRanges(call.index, [guardFn.range])) continue;
      const open = call.index + call[0].length - 1;
      const close = closingIndex(text, open);
      const arg = (splitTopLevel(text.slice(open + 1, close < 0 ? text.length : close - 1))[position]?.text ?? '').trim();
      if (!isFontScaleExpr(text, arg)) gaps.push(`the font scale in ${guardFn.name}(...) (its ${id} argument is ${arg === '' ? 'missing' : arg}, not useFontScale())`);
    }
  }
  return gaps;
}

function checkGuardShape(ctx) {
  const source = ctx.source(ctx.paths.appText);
  if (source === null) return;
  const text = masked(source);
  const range = functionRange(text, 'overflowGuardOf');
  const guard = range === null ? '' : text.slice(range[0], range[1]);
  const missing = [
    !/\bTALL_SCRIPT_METRICS\b/.test(text) && 'the font metrics (TALL_SCRIPT_METRICS from fonts.ts)',
    !(/\bpaddingTop\s*:/.test(guard) && /\bpaddingBottom\s*:/.test(guard) && /\bmarginVertical\s*:\s*-/.test(guard) && /Math\.ceil\s*\(/.test(guard)) && 'overflowGuardOf (pads of ceil(h) with the iOS shift, marginVertical -ceil(h))',
    !/<View\b[^>]*\btestID\b/.test(text) && 'a wrapper View that carries the testID',
    !/\buse(FontScale|WindowDimensions)\s*\(/.test(text) && 'the font scale (useFontScale), so the pads cover the drawn overflow at large text sizes',
    ...guardScaleGaps(text),
  ].filter(Boolean);
  if (missing.length > 0) {
    ctx.report.problem({ file: ctx.paths.appText, line: lineOfPattern(text, /function AppText/), rule: 'tall-script-overflow-guard', message: `AppText has no overflow guard for tall scripts (missing ${missing.join(', ')}): iOS lays a tall line's overflow above its box and clips the Text, so tall glyphs lose their tops`, fix: 'Copy app-text.tsx from the templates (references/text-and-fonts.md, "The tall-script overflow guard").' });
  }
}

/** { tall: every tall script, bundled: those with bundled families (the guard needs their metrics) }. */
function tallScriptsOf(fonts) {
  const tall = fonts.TALL_SCRIPTS instanceof Set ? [...fonts.TALL_SCRIPTS] : Array.isArray(fonts.TALL_SCRIPTS) ? fonts.TALL_SCRIPTS : [];
  return { tall, bundled: tall.filter((script) => fonts.SCRIPT_FONTS?.[script] !== null && fonts.SCRIPT_FONTS?.[script] !== undefined) };
}

function checkTallMetrics(ctx, fonts) {
  const file = ctx.paths.fonts;
  const source = ctx.source(file) ?? '';
  const { tall, bundled } = tallScriptsOf(fonts);
  const metrics = fonts.TALL_SCRIPT_METRICS ?? {};
  const onSystemFont = tall.filter((script) => !bundled.includes(script));
  if (onSystemFont.length > 0) ctx.report.note(`tall-script-overflow-guard: ${onSystemFont.join(', ')} use${onSystemFont.length === 1 ? 's' : ''} the system font, which has no font file to read metrics from, so no guard is computed for it; its tall line heights are still checked`);
  for (const script of bundled) {
    for (const family of Object.values(fonts.SCRIPT_FONTS[script])) {
      if (!metrics[family]) ctx.report.problem({ file, line: lineOfPattern(source, /TALL_SCRIPT_METRICS/), rule: 'tall-script-overflow-guard', message: `the tall script ${script} uses ${family}, which has no TALL_SCRIPT_METRICS entry`, fix: 'Add its hhea unitsPerEm, ascender and descender (check-design-system reads them from the font file).' });
    }
  }
  for (const [family, want] of Object.entries(metrics)) {
    ctx.checked += 1;
    const rel = fontFileOf(ctx, family);
    if (rel === null) continue;
    let font;
    try {
      font = readFontFile(join(ctx.root, rel));
    } catch (error) {
      if (error instanceof FontTableError) continue;
      throw error;
    }
    for (const key of ['unitsPerEm', 'ascender', 'descender']) {
      if (want?.[key] !== font[key]) ctx.report.problem({ file, line: lineOfPattern(source, new RegExp(`['"]${family}['"]`)), rule: 'tall-script-overflow-guard', message: `TALL_SCRIPT_METRICS['${family}'].${key} is ${show(want?.[key])}, the font file says ${font[key]}`, fix: `Copy the hhea values of ${rel} (unitsPerEm ${font.unitsPerEm}, ascender ${font.ascender}, descender ${font.descender}).` });
    }
  }
  return { hasTall: tall.length > 0, hasBundledTall: bundled.length > 0 };
}

async function checkText(ctx) {
  const scale = (await ctx.load(fileOfExport(ctx, 'TYPE_SCALE', 'tokens')))?.TYPE_SCALE;
  const typeStyles = await ctx.load(fileOfExport(ctx, 'TYPE_STYLES', 'typeStyles'));
  const fonts = await ctx.load(ctx.paths.fonts);
  checkTextMetrics(ctx, typeStyles);
  checkBalance(ctx);
  checkTabular(ctx, scale, typeStyles?.TYPE_STYLES);
  const { hasTall, hasBundledTall } = fonts ? checkTallMetrics(ctx, fonts) : { hasTall: false, hasBundledTall: false };
  if (hasBundledTall) checkGuardShape(ctx);
  if (hasTall) {
    checkTallLineHeights(ctx, scale, typeStyles?.TYPE_STYLES);
  } else if (fonts) {
    ctx.report.note('tall-script rules: fonts.ts declares no tall script, so the overflow guard and tall line heights are not checked');
  }
  return fonts;
}

function isCompleteSpring(value) {
  const has = (key) => typeof value?.[key] === 'number';
  return (has('damping') && has('stiffness') && has('mass')) || (has('duration') && has('dampingRatio'));
}

async function checkSprings(ctx) {
  const file = fileOfExport(ctx, 'SPRINGS', 'motion');
  const motion = await ctx.load(file);
  if (motion === null) return;
  const looksLikeSpring = (value) => value && typeof value === 'object' && ['damping', 'stiffness', 'mass', 'dampingRatio', 'duration'].some((key) => key in value);
  for (const [name, value] of Object.entries(motion).filter(([key]) => /SPRING/.test(key))) {
    const springs = looksLikeSpring(value) ? [[name, value]] : Object.entries(value ?? {}).map(([key, spring]) => [`${name}.${key}`, spring]);
    for (const [label, spring] of springs) {
      ctx.checked += 1;
      if (!isCompleteSpring(spring)) ctx.report.problem({ file, line: lineOfExport(ctx.source(file), name), rule: 'spring-config-complete', message: `${label} leaves ${['damping', 'stiffness', 'mass'].filter((key) => typeof spring?.[key] !== 'number').join(', ')} to the library default (Reanimated 4.5.1 defaults mass to 4: a slow, bouncy release)`, fix: 'Write damping, stiffness and mass (or duration and dampingRatio) in the token file and motion.ts.' });
    }
  }
}

/**
 * The sink look (PRESS.kind 'sink', or a surface that supports it for a keypad) is the only one
 * with a pushed-in place, and that place must be reached by layout.
 */
async function checkPressSurface(ctx) {
  const file = ctx.paths.pressSurface;
  const source = ctx.source(file);
  if (source === null) return;
  ctx.checked += 1;
  const text = masked(source);
  const press = (await ctx.load(fileOfExport(ctx, 'PRESS', 'tokens')))?.PRESS;
  if (press?.kind !== 'sink' && !/['"]sink['"]/.test(text)) {
    ctx.report.note('pressed-by-layout: PRESS.kind is not sink and the press surface has no sink look, so no state sits pushed in');
    return;
  }
  if (!/\btop\s*:\s*elevation\b/.test(text)) {
    ctx.report.problem({ file, line: lineOfPattern(text, /\bisSunk\b/), rule: 'pressed-by-layout', message: 'a pushed-in key is sunk by a transform, so its layout frame (what VoiceOver, TalkBack and Maestro report) stays `elevation` above where it is drawn', fix: 'Give the Pressable style isSunk && { top: elevation } and keep translateY for the transient press only (copy pressable-surface.tsx).' });
  }
}

function appConfigFile(ctx) {
  return ['app.config.ts', 'app.config.js', 'app.json'].find((rel) => ctx.exists(rel)) ?? null;
}

function checkFontFiles(ctx, fontsSpec) {
  const fix = `Copy the design's font file into the folder and record its sha256 in the contract (references/text-and-fonts.md names the worked example's source), or, when the design names no typeface, write "fonts": "${SYSTEM_FONT}" in ${ctx.contractRel} and drop the files.`;
  for (const entry of fontsSpec.files) {
    ctx.checked += 1;
    const rel = posix.join(fontsSpec.dir, entry.file);
    if (!ctx.exists(rel)) ctx.report.problem({ file: rel, rule: 'font-files', message: 'a font the contract bundles is missing', fix });
    else if (!/^[0-9a-f]{64}$/i.test(entry.sha256)) ctx.report.problem({ file: ctx.contractRel, rule: 'font-files', message: `${entry.file} has no recorded sha256 (${JSON.stringify(entry.sha256)})`, fix: `Record it: shasum -a 256 ${rel}` });
    else if (sha256(readFileSync(join(ctx.root, rel))) !== entry.sha256.toLowerCase()) ctx.report.problem({ file: rel, rule: 'font-files', message: 'the font file differs from the one the contract pins (sha256)', fix: 'Restore the pinned file, or record the new file\'s sha256 after checking its licence and metrics.' });
  }
  for (const family of new Set(fontsSpec.files.map((entry) => entry.family))) {
    const licence = fontsSpec.licences?.[family];
    if (!licence || !ctx.exists(posix.join(fontsSpec.dir, licence))) ctx.report.problem({ file: fontsSpec.dir, rule: 'font-files', message: `no licence text for ${family}${licence ? ` (${licence})` : ''}`, fix: 'Ship the font licence (for example the OFL text) next to the files and name it in "licences"; the licences screen lists it.' });
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** fonts.weightBy "fontWeight" (Expo's object syntax): each family is a fontFamily of the expo-font entry. */
function checkFamilyNames(ctx, families) {
  const config = appConfigFile(ctx);
  if (config === null) return;
  const text = config.endsWith('.json') ? ctx.source(config) : masked(ctx.source(config));
  const source = ctx.source(ctx.paths.fonts) ?? '';
  for (const family of families) {
    ctx.checked += 1;
    if (new RegExp(`["']?fontFamily["']?\\s*:\\s*["'\`]${escapeRegExp(family)}["'\`]`).test(text)) continue;
    ctx.report.problem({ file: ctx.paths.fonts, line: lineOfPattern(source, new RegExp(`['"]${escapeRegExp(family)}['"]`)), rule: 'font-family', message: `fonts.ts names '${family}', but no expo-font entry declares fontFamily '${family}' (with fonts.weightBy "fontWeight" Android finds the face by family name and weight)`, fix: `Add { fontFamily: '${family}', fontDefinitions: [{ path, weight }] } to the expo-font android.fonts list (references/text-and-fonts.md, "One family name with fontWeight").` });
  }
}

function checkFontFamilies(ctx, fontsSpec, families) {
  if (weightByOf(ctx.contract) === 'fontWeight') {
    checkFamilyNames(ctx, families);
    return;
  }
  const file = ctx.paths.fonts;
  const source = ctx.source(file) ?? '';
  for (const family of families) {
    ctx.checked += 1;
    const line = lineOfPattern(source, new RegExp(`['"]${escapeRegExp(family)}['"]`));
    const entry = fontsSpec.files.find((item) => item.file.replace(/\.(ttf|otf)$/, '') === family);
    if (!entry) {
      ctx.report.problem({ file, line, rule: 'font-family', message: `fonts.ts names '${family}', but no bundled font file is called ${family}.ttf (Android finds a font by its file name)`, fix: 'Name each family exactly like its file, and the file like its PostScript name.' });
      continue;
    }
    const rel = posix.join(fontsSpec.dir, entry.file);
    if (!ctx.exists(rel)) continue;
    try {
      const { postScriptName } = readFontFile(join(ctx.root, rel));
      if (postScriptName !== family) ctx.report.problem({ file: rel, line: 1, rule: 'font-family', message: `the PostScript name inside the file is ${JSON.stringify(postScriptName)}, not '${family}' (iOS finds a font by that name)`, fix: 'Rename the file and the family to the PostScript name, so one string works on both platforms.' });
    } catch (error) {
      if (!(error instanceof FontTableError)) throw error;
      ctx.report.problem({ file: rel, line: 1, rule: 'font-files', message: `not a usable font file: ${error.message}`, fix: 'Replace it with the pinned TTF or OTF.' });
    }
  }
}

function checkFontPlugin(ctx, fontsSpec) {
  const config = appConfigFile(ctx);
  if (config === null) {
    ctx.report.skip({ file: 'app.config.ts', rule: 'font-plugin', message: notYetCreated(ctx.root, { file: 'app.config.ts', owner: 'expo-project-bootstrap' }) });
    return;
  }
  ctx.checked += 1;
  const text = config.endsWith('.json') ? ctx.source(config) : masked(ctx.source(config));
  const at = text.search(/['"]expo-font['"]/);
  if (at < 0) {
    ctx.report.problem({ file: config, rule: 'font-plugin', message: 'no expo-font config plugin entry embeds the fonts, so every text falls back to the system font in a build', fix: `Add ['expo-font', { fonts: [${fontsSpec.files.map((entry) => `'./${posix.join(fontsSpec.dir, entry.file)}'`).join(', ')}] }] to plugins.` });
    return;
  }
  const missing = fontsSpec.files.filter((entry) => !new RegExp(`[/'"\`]${entry.file.replace(/\./g, '\\.')}['"\`]`).test(text));
  if (missing.length > 0) ctx.report.problem({ file: config, line: lineOf(text, at), rule: 'font-plugin', message: `the expo-font entry does not embed ${missing.map((entry) => entry.file).join(', ')}`, fix: 'List every contract font in the entry (paths from the project root).' });
}

/**
 * The contract bundles files but fonts.ts draws every script with the system font: the build embeds
 * fonts no text uses, and the contract no longer says what the app draws with. Either half is the
 * mistake, so the fix names both ways out.
 */
function checkFontsDrawn(ctx, fonts, fontsSpec) {
  ctx.checked += 1;
  const drawn = Object.values(fonts.SCRIPT_FONTS ?? {}).some((byWeight) => byWeight !== null && typeof byWeight === 'object' && Object.keys(byWeight).length > 0);
  if (drawn) return;
  const source = ctx.source(ctx.paths.fonts) ?? '';
  ctx.report.problem({ file: ctx.paths.fonts, line: lineOfExport(source, 'SCRIPT_FONTS'), rule: 'font-family', message: `the contract bundles ${fontsSpec.files.map((entry) => entry.file).join(', ')}, but every script of SCRIPT_FONTS is null, so no text draws with them and the build embeds fonts nobody sees`, fix: `Name a family per weight in SCRIPT_FONTS (file name = PostScript name), or keep the system font: write "fonts": "${SYSTEM_FONT}" in ${ctx.contractRel} and remove the files and the expo-font entry (references/text-and-fonts.md, "System font").` });
}

/**
 * Languages written in another script than Latin by default (CLDR likely subtags), for
 * font-script-coverage. A BCP 47 script subtag in the tag wins (sr-Latn is Latin, sr Cyrillic).
 */
const DEFAULT_SCRIPTS = {
  ar: 'Arabic', fa: 'Arabic', ur: 'Arabic', ps: 'Arabic', sd: 'Arabic', ug: 'Arabic', ckb: 'Arabic',
  he: 'Hebrew', yi: 'Hebrew', el: 'Greek', hy: 'Armenian', ka: 'Georgian',
  ru: 'Cyrillic', uk: 'Cyrillic', be: 'Cyrillic', bg: 'Cyrillic', mk: 'Cyrillic', sr: 'Cyrillic', kk: 'Cyrillic', ky: 'Cyrillic', tg: 'Cyrillic', mn: 'Cyrillic',
  hi: 'Devanagari', mr: 'Devanagari', ne: 'Devanagari', bn: 'Bengali', as: 'Bengali', pa: 'Gurmukhi', gu: 'Gujarati', or: 'Oriya',
  ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', si: 'Sinhala',
  th: 'Thai', lo: 'Lao', km: 'Khmer', my: 'Myanmar', am: 'Ethiopic', ti: 'Ethiopic', bo: 'Tibetan', dv: 'Thaana',
  ja: 'Japanese', zh: 'Han', ko: 'Hangul',
};

/** The script a language tag is written in, or null for Latin ('ja' -> Japanese, 'sr-Latn' -> null). */
function defaultScriptOf(tag) {
  const parts = tag.split(/[-_]/);
  const script = parts.slice(1).find((part) => /^[A-Za-z]{4}$/.test(part));
  if (script) return script.toLowerCase() === 'latn' ? null : script[0].toUpperCase() + script.slice(1).toLowerCase();
  return DEFAULT_SCRIPTS[parts[0].toLowerCase()] ?? null;
}

/** The literal LANGUAGES array of the i18n folder's languages.ts (i18n-strings-and-catalogs), or null. */
function appLanguages(ctx) {
  const rel = posix.join(ctx.layout.i18nDir, 'languages.ts');
  const text = ctx.source(rel);
  if (text === null) return { rel, languages: null };
  const match = /\bexport\s+const\s+LANGUAGES\b[^=]*=\s*\[([^\]]*)\]/.exec(masked(text));
  if (!match) return { rel, languages: null };
  return { rel, languages: [...match[1].matchAll(/['"]([\w-]+)['"]/g)].map((entry) => entry[1]) };
}

/**
 * With a bundled Latin family, a language the app ships whose script LANGUAGE_SCRIPTS does not name
 * falls back to that family (scriptOf): the platform then fills every missing glyph from a fallback
 * font, with its own weights and metrics, and no line height was chosen for it. Each script needs a
 * decision: a ScriptKey with a family per weight, or null for the system font.
 */
function checkScriptCoverage(ctx, fonts) {
  const latin = fonts.SCRIPT_FONTS?.latin;
  if (latin === null || typeof latin !== 'object') return;
  const { rel, languages } = appLanguages(ctx);
  if (languages === null) {
    ctx.report.note(`font-script-coverage: no literal LANGUAGES in ${rel}, so the app's languages were not checked against SCRIPT_FONTS`);
    return;
  }
  ctx.checked += 1;
  const mapped = fonts.LANGUAGE_SCRIPTS ?? {};
  const source = ctx.source(ctx.paths.fonts) ?? '';
  for (const tag of languages) {
    const subtag = tag.split(/[-_]/)[0].toLowerCase();
    const script = defaultScriptOf(tag);
    if (script === null || Object.hasOwn(mapped, subtag)) continue;
    ctx.report.problem({ file: ctx.paths.fonts, line: lineOfExport(source, 'LANGUAGE_SCRIPTS'), rule: 'font-script-coverage', message: `${rel} lists '${tag}' (${script} script), but LANGUAGE_SCRIPTS has no '${subtag}', so its text draws with the bundled Latin family (${latin.regular}) and the platform fills the missing glyphs from a fallback font with other weights and metrics`, fix: `Add '${subtag}' to LANGUAGE_SCRIPTS with a ScriptKey for ${script}, and give that script a family per weight in SCRIPT_FONTS (bundled and pinned) or null for the system font (references/text-and-fonts.md, "Every script of the app's languages").` });
  }
}

function checkFonts(ctx, fonts) {
  if (!ctx.contract) return;
  const families = fonts ? [...new Set([...Object.values(fonts.SCRIPT_FONTS ?? {}).flatMap((byWeight) => Object.values(byWeight ?? {})), ...Object.keys(fonts.TALL_SCRIPT_METRICS ?? {})])] : [];
  const fontsSpec = bundledFonts(ctx.contract);
  if (fontsSpec === null) {
    ctx.report.note(`font rules: the contract says "fonts": "${SYSTEM_FONT}", so no file, pin, licence or expo-font entry is checked`);
    if (families.length > 0) ctx.report.problem({ file: ctx.paths.fonts, line: 1, rule: 'font-family', message: `fonts.ts names ${families.join(', ')}, but the contract says "fonts": "${SYSTEM_FONT}" and bundles no file, so a build draws the platform font instead`, fix: `Bundle them (list the files, their sha256 and licences in the contract "fonts", and add the expo-font entry), or keep the system font: set each script of SCRIPT_FONTS to null and empty TALL_SCRIPT_METRICS (references/text-and-fonts.md, "System font").` });
    return;
  }
  checkFontFiles(ctx, fontsSpec);
  if (fonts) checkFontsDrawn(ctx, fonts, fontsSpec);
  if (fonts) checkScriptCoverage(ctx, fonts);
  checkFontFamilies(ctx, fontsSpec, families);
  checkFontPlugin(ctx, fontsSpec);
}

/** The key of the object literal around `index` (ios in `ios: { userInterfaceStyle }`), or null at the top. */
function enclosingKey(text, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1;
    else if (text[i] === '{') {
      if (depth === 0) return /["']?([\w$]+)["']?\s*:\s*$/.exec(text.slice(Math.max(0, i - 80), i))?.[1] ?? null;
      depth -= 1;
    }
  }
  return null;
}

/** The userInterfaceStyle entries of one config file: [{ file, index, value, platform, text }]. */
function interfaceStyles(ctx, file) {
  const text = file.endsWith('.json') ? ctx.source(file) : masked(ctx.source(file));
  return [...text.matchAll(/["']?userInterfaceStyle["']?\s*:\s*(?:(["'`])([^"'`]*)\1|([^,}\n]+))/g)].map((match) => {
    const bare = match[3]?.trim();
    const bound = bare && /^[A-Za-z_$][\w$]*$/.test(bare) ? constInitializer(text, bare) : null;
    const platform = enclosingKey(text, match.index);
    return { file, index: match.index, value: match[2] ?? (bound?.kind === 'string' ? bound.value : bare), platform: platform === 'ios' || platform === 'android' ? platform : 'top', text };
  });
}

/**
 * The effective userInterfaceStyle entries: the dynamic config's, plus app.json's for each scope
 * (top level, ios, android) the dynamic config leaves alone when it spreads the static config
 * (`({ config }) => ({ ...config, ... })`, Expo's documented way to extend app.json).
 */
function effectiveStyles(ctx, config) {
  const own = interfaceStyles(ctx, config);
  if (config === 'app.json' || !ctx.exists('app.json')) return own;
  if (!/\.\.\.\s*(?:config|[\w$]+\.config)\b/.test(masked(ctx.source(config)))) return own;
  return [...own, ...interfaceStyles(ctx, 'app.json').filter((entry) => !own.some((mine) => mine.platform === entry.platform))];
}

function checkColorSchemeConfig(ctx) {
  const config = appConfigFile(ctx);
  if (config === null) {
    ctx.report.skip({ file: 'app.config.ts', rule: 'color-scheme-config', message: notYetCreated(ctx.root, { file: 'app.config.ts', owner: 'expo-project-bootstrap' }) });
    return;
  }
  ctx.checked += 1;
  const fix = "Set userInterfaceStyle: 'automatic' in the app config, and drop or align the ios / android overrides.";
  const styles = effectiveStyles(ctx, config);
  const wrong = styles.filter((entry) => entry.value !== 'automatic');
  for (const entry of wrong) {
    const where = entry.platform === 'top' ? 'userInterfaceStyle' : `${entry.platform}.userInterfaceStyle`;
    ctx.report.problem({ file: entry.file, line: lineOf(entry.text, entry.index), rule: 'color-scheme-config', message: `${where} is ${JSON.stringify(entry.value)}, not "automatic", so the dark palette never follows the phone ${entry.platform === 'android' ? 'on Android' : entry.platform === 'ios' ? 'on iOS (it reports light forever)' : '(iOS reports light, Android ignores the setting)'}`, fix });
  }
  const covers = (platform) => styles.some((entry) => entry.platform === platform || entry.platform === 'top');
  if (wrong.length === 0 && !(covers('ios') && covers('android'))) {
    const missing = ['ios', 'android'].filter((platform) => !covers(platform));
    const text = config.endsWith('.json') ? ctx.source(config) : masked(ctx.source(config));
    ctx.report.problem({ file: config, line: lineOfPattern(text, /userInterfaceStyle/), rule: 'color-scheme-config', message: `userInterfaceStyle is not "automatic" for ${missing.join(' and ')} (Expo's default is light), so the dark palette never follows the phone there`, fix });
  }
  if (!Object.hasOwn({ ...ctx.manifest.dependencies }, 'expo-system-ui')) {
    ctx.report.problem({ file: 'package.json', rule: 'color-scheme-config', message: 'expo-system-ui is not a dependency, so Android ignores userInterfaceStyle in a development or release build', fix: 'Run: npx expo install expo-system-ui' });
  }
}

/** The React Navigation entry files of an app without expo-router: App.tsx and the package.json "main" file. */
function appEntryFiles(ctx) {
  const main = typeof ctx.manifest.main === 'string' ? posix.normalize(ctx.manifest.main.replace(/^\.\//, '')) : null;
  const local = main !== null && !main.startsWith('..') && !main.startsWith('node_modules/') && /\.(t|j)sx?$/.test(main) ? [main] : [];
  return [...new Set(['App.tsx', 'App.jsx', 'App.js', posix.join(normalDir(ctx.layout.srcDir), 'App.tsx'), ...local])].filter((rel) => ctx.exists(rel));
}

/**
 * Where the providers must be mounted: the routes layout with expo-router, else (React Navigation)
 * App.tsx or the package.json "main" file. { file, exists }: a missing target is a SKIP only while it
 * does not exist.
 */
function mountTarget(ctx) {
  if (Object.hasOwn(ctx.deps, 'expo-router')) {
    const file = posix.join(ctx.layout.routesDir, '_layout.tsx');
    return { file, exists: ctx.exists(file) };
  }
  const entries = appEntryFiles(ctx);
  return entries.length > 0 ? { file: entries[0], exists: true } : { file: 'App.tsx', exists: false };
}

/**
 * The app's runtime files: the src folder and the routes folder (Expo Router also reads app/ at the
 * repo root next to src/), plus App.tsx and the "main" file at the root, minus the theme folder. With
 * srcDir "." (an app without src/) that is the whole repo walk, minus test helpers, mocks, Node
 * tooling and root *.config.ts / *.setup.ts files, which may render a provider without mounting it in
 * the app. `withTheme` keeps the theme folder (where the navigation theme mapping may live).
 */
function runtimeSources(ctx, { withTheme = false } = {}) {
  const { layout } = ctx;
  const roots = [layout.srcDir, layout.routesDir].map(normalDir).filter((dir) => ctx.exists(dir));
  const entries = appEntryFiles(ctx);
  if (roots.length === 0 && entries.length === 0) return [];
  const notApp = [...(withTheme ? [] : [layout.themeDir]), layout.testDir, layout.mocksDir, layout.scriptsDir, layout.e2eDir].map(normalDir).filter((dir) => dir !== '.');
  return walkRepo(ctx.root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx'], ignore: ['*.test.ts', '*.test.tsx', '*.d.ts', '__tests__'] })
    .filter((rel) => entries.includes(rel) || (/\.tsx?$/.test(rel) && roots.some((dir) => within(rel, dir)) && !notApp.some((dir) => within(rel, dir)) && !/^[^/]+\.(config|setup)\.(ts|tsx)$/.test(rel)));
}

/**
 * Whether a file renders a value it imports from the module `target` (by name, default or through a
 * namespace). Matching the import, not the tag name, keeps expo-router's ThemeProvider (the
 * navigation theme the Expo template mounts) from counting as the app's provider.
 */
function rendersImportFrom(ctx, { rel, text }, target) {
  return importsOf(text).some((entry) => {
    if (!specifierNames(rel, entry.spec, target, aliasesOf(ctx.layout))) return false;
    const locals = [...entry.names.map((name) => name.local), entry.defaultName].filter(Boolean);
    if (locals.some((name) => new RegExp(`<${escapeRegExp(name)}\\b`).test(text))) return true;
    return entry.namespace !== null && new RegExp(`<${escapeRegExp(entry.namespace)}\\.\\w+\\b`).test(text);
  });
}

/**
 * What the provider must do besides providing the theme: mirror the chosen scheme to Appearance (so
 * native UI and the system bars follow the in-app choice) and paint the root view (no white flash
 * behind sheets, transitions and Android's transparent system bars).
 */
function checkProviderBehaviour(ctx) {
  const file = ctx.paths.themeProvider;
  const source = ctx.source(file);
  if (source === null) return;
  ctx.checked += 1;
  const text = masked(source);
  const missing = [
    !/\bAppearance\.setColorScheme\s*\(/.test(text) && ['Appearance.setColorScheme(...)', 'native UI (alerts, pickers, the keyboard, the system bars) keeps the phone\'s scheme when the person picks another one in the app'],
    !/\bsetBackgroundColorAsync\s*\(/.test(text) && ['SystemUI.setBackgroundColorAsync(...)', 'the root view keeps its build-time colour, so a dark theme flashes white behind sheets, transitions and Android\'s edge-to-edge system bars'],
  ].filter(Boolean);
  for (const [call, effect] of missing) {
    ctx.report.problem({ file, line: lineOfPattern(text, /function AppThemeProvider/), rule: 'theme-provider-behaviour', message: `AppThemeProvider never calls ${call}: ${effect}`, fix: 'Copy theme-provider.tsx from the templates: one effect mirrors the preference to Appearance, one paints the root view with theme.colors.background.' });
  }
}

const NAVIGATION_MODULES = ['expo-router', '@react-navigation/native'];
const BARE_NAVIGATION_THEME = /^\(*\s*(?:[\w$]+\.)?(?:DarkTheme|DefaultTheme)\s*\)*$/;
const NAVIGATION_FIX = 'Mount NavigationThemeProvider (templates/src/theme/navigation-theme.tsx) inside AppThemeProvider around the root Stack, in the root layout or in a component the layout renders there (a RootStack in its own file when the providers reach the lint\'s JSX depth); it passes toNavigationTheme(useTheme()) to the navigation ThemeProvider (React Navigation: <Navigation theme={toNavigationTheme(theme)} />).';

/** The branches of a top-level ternary (`a ? B : C` gives [B, C]), else [expr]. */
function branchesOf(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === '?' && depth === 0 && expr[i + 1] !== '.' && expr[i + 1] !== '?') {
      const rest = expr.slice(i + 1);
      const parts = splitTopLevel(rest.replace(/:/g, ','));
      return parts.length === 2 ? parts.map((part) => part.text.trim()) : [rest.trim()];
    }
  }
  return [expr.trim()];
}

/** The navigation theme tags of one file: [{ index, name, attribute, expr }] (expr null when the theme is not passed). */
function navigationTags({ text }) {
  const imports = importsOf(text).filter((entry) => NAVIGATION_MODULES.includes(entry.spec));
  if (imports.length === 0) return [];
  const named = (imported) => imports.flatMap((entry) => entry.names.filter((name) => name.imported === imported).map((name) => name.local));
  const namespaces = imports.map((entry) => entry.namespace).filter(Boolean);
  const factories = [...named('createStaticNavigation'), ...namespaces.map((ns) => `${ns}.createStaticNavigation`)];
  const statics = factories.flatMap((factory) => [...text.matchAll(new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escapeRegExp(factory)}\\s*\\(`, 'g'))].map((match) => match[1]));
  const kinds = [
    ...[...named('ThemeProvider'), ...namespaces.map((ns) => `${ns}.ThemeProvider`)].map((name) => [name, 'value']),
    ...[...named('NavigationContainer'), ...namespaces.map((ns) => `${ns}.NavigationContainer`)].map((name) => [name, 'theme']),
    ...statics.map((name) => [name, 'theme']),
  ];
  const tags = [];
  for (const [name, attribute] of kinds) {
    for (const match of text.matchAll(new RegExp(`<${escapeRegExp(name)}(?=[\\s/>])`, 'g'))) {
      const end = openingTagEnd(text, match.index);
      tags.push({ index: match.index, name, attribute, expr: jsxAttribute(text.slice(match.index, end < 0 ? text.length : end), attribute) });
    }
  }
  return tags;
}

/** Why a navigation theme value does not come from the app theme, or null when it does. */
function unmappedReason(ctx, source, tag) {
  if (tag.expr === null || tag.expr === '') return `<${tag.name}> gets no ${tag.attribute}, so React Navigation paints with its own light DefaultTheme`;
  const bound = /^[A-Za-z_$][\w$]*$/.test(tag.expr) ? constExpression(source.text, tag.expr) : null;
  const expr = bound ?? tag.expr;
  if (branchesOf(expr).every((branch) => BARE_NAVIGATION_THEME.test(branch))) return `<${tag.name}> gets ${tag.expr}${bound ? ` (${bound})` : ''}, React Navigation's own light and dark themes`;
  const readsTheme = importsOf(source.text).some((entry) => [...walkTheme(ctx)].some((rel) => specifierNames(source.rel, entry.spec, rel, aliasesOf(ctx.layout))));
  return readsTheme ? null : `<${tag.name}> builds its theme without the app theme (nothing in ${source.rel} comes from ${ctx.layout.themeDir})`;
}

function walkTheme(ctx) {
  if (!ctx.themeFiles) ctx.themeFiles = walkRepo(ctx.root, { include: ['*.ts', '*.tsx'] }).filter((rel) => within(rel, ctx.layout.themeDir));
  return ctx.themeFiles;
}

/**
 * The navigator paints headers, the tab bar and every screen container from its own theme. It must
 * get the app theme's colours (a mapped value from a file that reads the theme folder), that mapping
 * must be rendered, and it must sit inside AppThemeProvider (else useTheme reads the light default).
 */
function checkNavigationTheme(ctx, sources, target) {
  const navigator = NAVIGATION_MODULES.find((name) => Object.hasOwn(ctx.deps, name));
  if (!navigator) {
    ctx.report.note('navigation-theme-mapped: neither expo-router nor @react-navigation/native is in package.json, so no navigation theme is checked');
    return;
  }
  ctx.checked += 1;
  const problem = (file, line, message) => ctx.report.problem({ file, line, rule: 'navigation-theme-mapped', message: `${message}: headers, the tab bar and screen backgrounds ignore the app's palette and stay light when the app is dark`, fix: NAVIGATION_FIX });
  const mapped = [];
  for (const source of sources) {
    for (const tag of navigationTags(source)) {
      const reason = unmappedReason(ctx, source, tag);
      if (reason) problem(source.rel, lineOf(source.text, tag.index), reason);
      else mapped.push({ source, tag });
    }
  }
  if (mapped.length === 0) {
    if (sources.some((source) => navigationTags(source).length > 0)) return;
    if (!target.exists) ctx.report.skip({ file: target.file, rule: 'navigation-theme-mapped', message: notYetCreated(ctx.root, { file: target.file, owner: 'expo-project-bootstrap' }) });
    else problem(target.file, 1, `no runtime file gives the navigator (${navigator}) the app theme's colours`);
    return;
  }
  const routes = normalDir(ctx.layout.routesDir);
  const mappingRels = [...new Set(mapped.map(({ source }) => source.rel))];
  const carriers = navigationCarriers(ctx, sources, mappingRels);
  const isMountRoot = (rel) => within(rel, routes) || appEntryFiles(ctx).includes(rel);
  if (![...carriers.all].some(isMountRoot)) {
    const renderers = [...carriers.all].filter((rel) => !mappingRels.includes(rel));
    if (!target.exists) ctx.report.skip({ file: target.file, rule: 'navigation-theme-mapped', message: notYetCreated(ctx.root, { file: target.file, owner: 'expo-project-bootstrap' }) });
    else for (const { source, tag } of mapped) problem(source.rel, lineOf(source.text, tag.index), renderers.length === 0 ? `${source.rel} maps the navigation theme, but no runtime file renders what it exports` : `${source.rel} maps the navigation theme and ${renderers.join(', ')} render${renderers.length === 1 ? 's' : ''} it, but neither the routes nor the app entry renders ${renderers.length === 1 ? 'that file' : 'those files'}`);
    return;
  }
  for (const source of sources) {
    if (!/<AppThemeProvider\b/.test(source.text)) continue;
    for (const { name, index, from } of carrierTags(ctx, source, carriers.open)) {
      if (isInsideAppTheme(source.text, index)) continue;
      const through = mappingRels.includes(from) ? '' : ` (it renders the navigation theme through ${from})`;
      problem(source.rel, lineOf(source.text, index), `<${name}>${through} sits outside AppThemeProvider, so it reads the theme context's default (the light theme)`);
    }
  }
}

/**
 * The files that render the navigation theme: the mapping files, then every file that renders a
 * component of one of them, followed a few levels (a root layout that renders a RootStack component
 * that renders NavigationThemeProvider). { all, open }: `open` drops a file whose navigation theme
 * already sits inside an AppThemeProvider of its own, since whoever renders that file needs no theme.
 */
function navigationCarriers(ctx, sources, mappingRels) {
  const all = new Set(mappingRels);
  const open = new Set(mappingRels);
  for (let round = 0; round < 4; round += 1) {
    const added = sources.filter((source) => !all.has(source.rel) && carrierTags(ctx, source, all).length > 0);
    for (const source of added) {
      all.add(source.rel);
      if (carrierTags(ctx, source, open).some(({ index }) => !isInsideAppTheme(source.text, index))) open.add(source.rel);
    }
    if (added.length === 0) break;
  }
  return { all, open };
}

/** The JSX tags in `source` that render a component imported from one of `rels`: [{ name, index, from }]. */
function carrierTags(ctx, source, rels) {
  const out = [];
  for (const imported of importsOf(source.text)) {
    const from = [...rels].find((rel) => rel !== source.rel && specifierNames(source.rel, imported.spec, rel, aliasesOf(ctx.layout)));
    if (!from) continue;
    for (const name of [...imported.names.map((entry) => entry.local), imported.defaultName].filter(Boolean)) {
      for (const tag of source.text.matchAll(new RegExp(`<${escapeRegExp(name)}\\b`, 'g'))) out.push({ name, index: tag.index, from });
    }
  }
  return out;
}

/** [start, end) of every `<name ...>...</name>` element (a self-closing one holds nothing) in masked source. */
function elementRanges(text, name) {
  const ranges = [];
  for (const match of text.matchAll(new RegExp(`<${escapeRegExp(name)}\\b`, 'g'))) {
    const tagEnd = openingTagEnd(text, match.index);
    if (tagEnd < 0) continue;
    if (text[tagEnd - 2] === '/') continue;
    const close = text.indexOf(`</${name}>`, tagEnd);
    ranges.push([match.index, close < 0 ? text.length : close + name.length + 3]);
  }
  return ranges;
}

/** Components declared in masked source (`function Name(...) {...}`, `const Name = (...) => ...`): [{ name, range }]. */
function componentRanges(text) {
  const out = [];
  for (const match of text.matchAll(/\bfunction\s+([A-Z]\w*)\s*\(/g)) {
    const range = functionRange(text, match[1]);
    if (range) out.push({ name: match[1], range });
  }
  for (const match of text.matchAll(/\bconst\s+([A-Z]\w*)\s*(?::[^=;]+)?=\s*/g)) {
    const value = valueExpression(text, match.index + match[0].length);
    if (/=>|\bfunction\b/.test(value.text)) out.push({ name: match[1], range: [match.index, value.at + value.text.length] });
  }
  return out;
}

/**
 * True when the JSX tag at `index` renders inside AppThemeProvider: within one of its elements, or
 * inside a component of the same file that is itself rendered there (a helper split off the root
 * layout to keep the JSX shallow, as the jsx-max-depth lint asks), followed a few levels deep.
 * Text order alone is not nesting: a helper declared above the layout still renders inside it.
 */
function isInsideAppTheme(text, index, depth = 0) {
  if (inRanges(index, elementRanges(text, 'AppThemeProvider'))) return true;
  if (depth >= 3) return false;
  const owner = componentRanges(text)
    .filter(({ range }) => range[0] <= index && index < range[1])
    .sort((a, b) => a.range[1] - a.range[0] - (b.range[1] - b.range[0]))[0];
  if (!owner) return false;
  return [...text.matchAll(new RegExp(`<${owner.name}\\b`, 'g'))].some((use) => !inRanges(use.index, [owner.range]) && isInsideAppTheme(text, use.index, depth + 1));
}

/**
 * One theme system: the create-expo-app template's constants/theme.ts (Colors light/dark) and its
 * use-theme.ts are values to migrate into the token file, never a second system beside src/theme.
 */
function checkSecondTheme(ctx, sources) {
  ctx.checked += 1;
  for (const { rel, text } of sources) {
    const isTemplateTheme = /(^|\/)constants\/theme\.tsx?$/.test(rel);
    const hook = /\bexport\s+(?:function\s+useTheme\b|const\s+useTheme\b)/.exec(text);
    const colors = /\bexport\s+const\s+Colors\s*=\s*\{[\s\S]{0,200}?\blight\s*:/.exec(text);
    if (!isTemplateTheme && !hook && !colors && !/(^|\/)use-theme\.tsx?$/.test(rel)) continue;
    const at = (hook ?? colors)?.index ?? 0;
    ctx.report.problem({ file: rel, line: lineOf(text, at), rule: 'second-theme-system', message: `a second theme system beside ${ctx.layout.themeDir} (the create-expo-app template's Colors / useTheme): its colours skip the contrast pairs and ignore the in-app theme setting`, fix: 'Migrate it: copy its values into design/tokens.json (references/tokens-and-contract.md, "Adopting the create-expo-app theme"), point its readers at useTheme / makeStyles / AppText from the theme, then delete it.' });
  }
}

function checkProviders(ctx, fonts) {
  checkProviderBehaviour(ctx);
  const sources = runtimeSources(ctx).map((rel) => ({ rel, text: masked(ctx.source(rel)) }));
  const target = mountTarget(ctx);
  const providerFile = ctx.paths.themeProvider;
  ctx.checked += 1;
  if (!sources.some((source) => rendersImportFrom(ctx, source, providerFile))) {
    if (!target.exists) ctx.report.skip({ file: target.file, rule: 'theme-provider-mounted', message: notYetCreated(ctx.root, { file: target.file, owner: 'expo-project-bootstrap' }) });
    else ctx.report.problem({ file: target.file, rule: 'theme-provider-mounted', message: `no runtime file renders AppThemeProvider from ${providerFile}, so the app never follows the dark-mode setting or the phone (expo-router's ThemeProvider is the navigation theme, not this one)`, fix: 'Mount <AppThemeProvider preference={...}> once around the root Stack (or the React Navigation root), with the navigation theme inside it taking its colours from the app theme (examples/root-layout.tsx).' });
  }
  const withTheme = runtimeSources(ctx, { withTheme: true }).map((rel) => ({ rel, text: masked(ctx.source(rel)) }));
  checkNavigationTheme(ctx, withTheme, target);
  checkSecondTheme(ctx, sources);
  if (Object.keys(fonts?.LANGUAGE_SCRIPTS ?? {}).length === 0) return;
  ctx.checked += 1;
  if (!sources.some((source) => rendersImportFrom(ctx, source, ctx.paths.textLocale))) {
    const reason = notYetCreated(ctx.root, { file: ctx.layout.i18nDir, owner: 'i18n-strings-and-catalogs' });
    if (reason) ctx.report.skip({ file: ctx.layout.i18nDir, rule: 'text-locale-provided', message: reason });
    else ctx.report.problem({ file: target.file, rule: 'text-locale-provided', message: `the app has several scripts but no runtime file renders TextLocaleProvider from ${ctx.paths.textLocale}, so every text uses the default language's font and direction`, fix: 'Mount <TextLocaleProvider value={{ language, direction }}> in the i18n root (examples/root-layout.tsx).' });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const report = createReporter({ name: 'check-design-system', json: options.json });
  const themeDir = resolveLayout(root).themeDir;
  if (!existsSync(join(root, themeDir))) {
    const other = otherStylingPackage(root);
    if (other) return report.notApplicable(`${other} is in package.json and ${themeDir} does not exist: the app styles through ${other}`);
    fail(`nothing to check: ${themeDir} does not exist`, 'Copy the templates (templates/src/theme, templates/src/ui, templates/contracts, templates/design) into the app, or pass the repo root as the argument.');
  }
  const ctx = createContext(root, options, report);
  if (!ctx.contract) report.problem({ file: ctx.contractRel, rule: 'contract-missing', message: 'the design-system contract is missing, so no theme value is compared with the token file', fix: 'Copy templates/contracts/design-system.json into the app and point it at the token file.' });
  checkRequiredFiles(ctx);
  const tokens = ctx.contract ? loadTokenFile(ctx) : null;
  checkColorTokens(ctx);
  if (tokens) await checkExports(ctx, tokens);
  await checkPalettes(ctx, tokens);
  const fonts = await checkText(ctx);
  await checkSprings(ctx);
  await checkPressSurface(ctx);
  checkFonts(ctx, fonts);
  checkColorSchemeConfig(ctx);
  checkProviders(ctx, fonts);
  return report.finish({ checked: ctx.checked, unit: 'modules and facts' });
});
