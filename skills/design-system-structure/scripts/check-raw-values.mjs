#!/usr/bin/env node
// check-raw-values.mjs: scans the app's visual code for values that belong in the theme: colour
// literals, raw font sizes, font weights on bundled families, letter spacing, raw radii, animation
// durations and spring numbers, rounded line heights, legacy platform shadows, palette or token
// imports that freeze a colour, and makeStyles factories that skip StyleSheet.create.
// Installed skills (.agents/skills, .claude/skills, skills/, any folder with a SKILL.md) are never scanned.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-raw-values.mjs [repo-root]

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, lineOf, matchGlob, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { aliasesOf, closingIndex, constInitializer, importsOf, inRanges, masked, normalDir, rawLiteralsIn, readSource, specifierNames, splitTopLevel, styleSheetRanges, valueExpression, within } from './lib/app-source.mjs';
import { SYSTEM_FONT, bundledFonts, modulePaths, otherStylingPackage, readContract, weightByOf } from './lib/design-contract.mjs';

const SPEC = {
  name: 'check-raw-values',
  summary: 'Scans visual code for raw design values (colours, font sizes and weights, tracking, radii, animation durations and springs, rounded line heights, legacy shadows), palette imports, and makeStyles factories without StyleSheet.create.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The contract (default: <contractsDir>/design-system.json)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Scans rawValues.scan (default: the src folder and the routes folder, minus src/core, src/data, src/api,',
    'src/stores, src/services, src/i18n and src/config, where nothing is drawn), minus tests and type declarations.',
    'With srcDir "." in rn-skills.config.json (an app without src/) the default is the repo root, minus those',
    'folders, test/, __mocks__/, scripts/, the e2e and contracts folders and root *.config.ts / *.setup.ts files.',
    'Rules:',
    '  no-color-literal         a hex, rgb(), hsl() or named colour outside rawValues.allowColors (default: the theme',
    '                           folder). A named colour (white, gray, red ...; transparent is allowed) counts as the',
    '                           value of a colour key or JSX attribute (color, *Color, fill, stroke, colors), as',
    '                           color="white", thumbColor={\'black\'}, trackColor={{ true: \'green\' }} or { color: \'gray\' }',
    '  no-palette-import        outside the theme folder, an import of a palette module, of the token file, or of',
    '                           APP_THEMES: a colour read there is frozen to one scheme (use makeStyles or useTheme);',
    '                           Expo Router\'s +html.tsx / +html.web.tsx (export time, both schemes) may read it',
    '  no-raw-font-size         a fontSize number outside the theme folder, also as a branch of a conditional',
    '                           (fontSize: isNarrow() ? 13 : 17); use an AppText variant',
    '  no-font-weight           fontWeight outside the theme folder while the app bundles fonts (the family is the',
    '                           weight; off with "fonts": "system" or fonts.weightBy "fontWeight")',
    '  no-letter-spacing        a letterSpacing number outside the theme folder, also in a conditional (track through type styles)',
    '  no-raw-radius            a border*Radius number above 0 outside the theme folder, also in a conditional (use RADII;',
    '                           RADII.md / 2 and SIZE / 2 stay silent: no-pill owns circles)',
    '  no-raw-duration          outside the theme folder, a duration or delay number in withTiming, withDelay,',
    '                           withRepeat, withSequence, Animated.timing, LayoutAnimation.configureNext or',
    '                           LayoutAnimation.create, a .duration(n) or .delay(n) layout-animation builder, or a CSS',
    '                           animation/transition duration (use MOTION_MS). The number may be inline, a same-file',
    '                           const (const FADE_MS = 250; { duration: FADE_MS }, .duration(SLIDE), withDelay(STAGGER)),',
    '                           or inside an expression (isSlow() ? 600 : 200, index * 50)',
    '  no-raw-spring            outside the theme folder, a spring number (damping, stiffness, mass, dampingRatio,',
    '                           duration ...) in withSpring or Animated.spring, or a .damping(n)-style builder (use SPRINGS)',
    '                           Both rules also read a config bound to a const in the same file and passed by name',
    '                           (const BOUNCE = { damping: 10 }; withSpring(1, BOUNCE)), or spread into the call.',
    '                           Not seen: a number imported from another module, or held in a let or a function.',
    '  no-rounded-line-height   lineHeight from Math.round/ceil/floor (line heights live on the pixel grid)',
    '  no-legacy-shadow         shadowColor/Offset/Opacity/Radius, or an elevation key in a StyleSheet',
    '  make-styles-factory      a makeStyles factory that does not build its styles with StyleSheet.create',
    '  no-gradient              (policy noGradients) a gradient import or Skia gradient in UI code',
    '  no-pill                  (policy maxRadius) a radius above the maximum, 50% or size / 2',
    '',
    'NOT APPLICABLE when package.json has another styling system and the theme folder does not exist.',
    'Example: node check-raw-values.mjs .',
  ].join('\n'),
};

const TEST_FILES = ['*.test.ts', '*.test.tsx', '*.d.ts', '__tests__', '__mocks__'];
const GRADIENT_PACKAGES = /from\s+['"](expo-linear-gradient|react-native-linear-gradient)['"]/g;
const SKIA_GRADIENTS = /<(LinearGradient|RadialGradient|SweepGradient|TwoPointConicalGradient)\b/g;
const REANIMATED = 'react-native-reanimated';
const TIMING_CALLS = /\b(withTiming|withDelay|withRepeat|withSequence|Animated\.timing|Animated\.delay|Animated\.stagger|LayoutAnimation\.configureNext|LayoutAnimation\.create)\s*\(/g;
const SPRING_CALLS = /\b(withSpring|Animated\.spring)\s*\(/g;
const SPRING_KEYS = /\b(damping|stiffness|mass|dampingRatio|duration|bounciness|speed|tension|friction)\s*:(?!:)/g;
const DURATION_KEYS = /\b(duration|delay)\s*:(?!:)/g;
const DURATION_SHORTHAND = /[{,]\s*(duration|delay)\s*(?=[,}])/g;
const SPRING_SHORTHAND = /[{,]\s*(damping|stiffness|mass|dampingRatio|duration)\s*(?=[,}])/g;
const CSS_TIMING_KEYS = /\b((?:transition|animation)(?:Duration|Delay))\s*:\s*['"`]?(\d+(?:\.\d+)?)/g;
const BUILDER_CALLS = /\.\s*(duration|delay|damping|stiffness|mass|dampingRatio)\s*\(/g;
const SPRING_BUILDERS = new Set(['damping', 'stiffness', 'mass', 'dampingRatio']);
const DURATION_FIX = 'Use a MOTION_MS token (with its reduce-motion alternative); add one to the token file when none fits.';
const SPRING_FIX = 'Use a SPRINGS token, complete with damping, stiffness and mass (spread it to add velocity: { ...SPRINGS.release, velocity }).';
const PALETTE_FIX = 'Read theme.colors through makeStyles or useTheme: the theme follows dark mode, the colour-blind variant and every palette flavour.';
const COLOR_FIX = 'Take it from theme.colors (add a role to the token file when no role fits).';
/** CSS Color Module Level 4 named colours, which React Native accepts on both platforms ('transparent' is allowed). */
const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
  + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray '
  + 'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue '
  + 'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite '
  + 'forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory '
  + 'khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen '
  + 'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime '
  + 'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue '
  + 'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive '
  + 'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum '
  + 'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue '
  + 'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke '
  + 'yellow yellowgreen').split(' '));
const COLOR_NAME = '(color|[A-Za-z_]\\w*Color|fill|stroke|colors)';
const COLOR_KEY = new RegExp(`\\b${COLOR_NAME}\\s*:(?!:)`, 'g');
const COLOR_ATTRIBUTE = new RegExp(`\\s${COLOR_NAME}\\s*=\\s*`, 'g');
/** The create-expo-app template's own theme files: values to migrate, not a system to keep. */
const TEMPLATE_THEME_FILES = ['constants/theme.ts', 'hooks/use-theme.ts'];
/** Layers that draw nothing: a number there is data (a task's duration), never a design value. */
const NON_VISUAL_DIRS = ['coreDir', 'dataDir', 'apiDir', 'storesDir', 'servicesDir', 'i18nDir', 'configDir'];
/** Folders outside the app's code: only excluded by name when srcDir is the repo root. */
const NOT_APP_DIRS = ['testDir', 'mocksDir', 'scriptsDir', 'e2eDir', 'contractsDir'];
/** Root tooling files (app.config.ts, jest.setup.ts): never app code, even with srcDir "." (App.tsx is). */
const ROOT_TOOLING_FILE = /^[^/]+\.(config|setup)\.(ts|tsx)$/;

function settingsOf(layout, contract) {
  const raw = contract?.rawValues ?? {};
  const given = Array.isArray(raw.scan) && raw.scan.length > 0;
  const paths = modulePaths(layout, contract);
  const isRootSrc = normalDir(layout.srcDir) === '.';
  const defaults = [layout.srcDir, layout.routesDir].map(normalDir).filter((dir, i, all) => all.indexOf(dir) === i && !(i > 0 && within(dir, all[0])));
  return {
    scan: given ? raw.scan.map(normalDir) : defaults,
    exclude: given ? [] : [...NON_VISUAL_DIRS, ...(isRootSrc ? NOT_APP_DIRS : [])].map((key) => normalDir(layout[key])).filter((dir) => dir !== '.'),
    isRootScan: (given ? raw.scan.map(normalDir) : defaults).includes('.'),
    allowColors: Array.isArray(raw.allowColors) ? raw.allowColors : [`${layout.themeDir}/**`],
    isWeightByFamily: bundledFonts(contract) !== null && weightByOf(contract) === 'family',
    policy: raw.policy ?? {},
    themeDir: layout.themeDir,
    uiDirs: [layout.uiDir, layout.featuresDir, layout.routesDir],
    aliases: aliasesOf(layout),
    frozen: [
      ...(contract?.palettes ?? [{ file: paths.palette }]).map((entry) => ({ file: entry.file, what: 'a palette' })),
      { file: contract?.tokens ?? 'design/tokens.json', what: 'the token file' },
    ],
    themeContext: paths.themeContext,
  };
}

function scanFiles(root, settings) {
  return walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: TEST_FILES })
    .filter((rel) => settings.scan.some((dir) => within(rel, dir)) && !settings.exclude.some((dir) => within(rel, dir)))
    .filter((rel) => !(settings.isRootScan && ROOT_TOOLING_FILE.test(rel)));
}

function scan(report, file, text, rule, pattern, { message, fix, when = () => true }) {
  for (const match of text.matchAll(pattern)) {
    if (when(match)) report.problem({ file, line: lineOf(text, match.index), rule, message: message(match), fix });
  }
}

function checkMakeStyles(report, file, text) {
  for (const match of text.matchAll(/\bmakeStyles\s*\(/g)) {
    if (/function\s+makeStyles\s*$/.test(text.slice(Math.max(0, match.index - 20), match.index + 'makeStyles'.length))) continue;
    const end = closingIndex(text, match.index + match[0].length - 1);
    const body = end < 0 ? '' : text.slice(match.index, end);
    if (!/StyleSheet\.create\s*\(/.test(body)) {
      report.problem({ file, line: lineOf(text, match.index), rule: 'make-styles-factory', message: 'the makeStyles factory returns styles that StyleSheet.create never saw', fix: 'Write the factory as const styles = StyleSheet.create({ ... }); return styles; (keeps the excess-property type check and the style lint rules).' });
    }
  }
}

function checkPolicy(report, file, text, settings) {
  const isUi = settings.uiDirs.some((dir) => within(file, dir));
  if (settings.policy.noGradients === true) {
    const fix = 'The app\'s policy paints flat (rawValues.policy.noGradients): use one theme colour.';
    scan(report, file, text, 'no-gradient', GRADIENT_PACKAGES, { message: (m) => `${m[1]} paints a gradient`, fix });
    if (isUi) scan(report, file, text, 'no-gradient', SKIA_GRADIENTS, { message: (m) => `${m[1]} in UI code`, fix });
  }
  const max = settings.policy.maxRadius;
  if (typeof max === 'number') {
    const isPill = (value) => /\/\s*2\b/.test(value) || /['"]\s*50%\s*['"]/.test(value) || (/^\d+(\.\d+)?$/.test(value.trim()) && Number(value) > max);
    scan(report, file, text, 'no-pill', /\bborder\w*Radius\s*:\s*([^,}\n]+)/g, { when: (m) => isPill(m[1]), message: (m) => `radius ${m[1].trim()} makes a pill or a circle (the policy allows at most ${max})`, fix: `Use a RADII token of at most ${max} (rawValues.policy.maxRadius).` });
  }
}

/** The index of the bracket that opens the one closing at `close`, or -1. */
function openingIndex(text, close) {
  const open = { ')': '(', ']': '[', '}': '{' }[text[close]];
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (text[i] === text[close]) depth += 1;
    else if (text[i] === open) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The identifier a member chain starts from (FadeIn in FadeIn.springify().duration(300)), or null. */
function chainRoot(text, dot) {
  let i = dot - 1;
  for (;;) {
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
    if (text[i] === ')') i = openingIndex(text, i) - 1;
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
    const end = i + 1;
    while (i >= 0 && /[\w$]/.test(text[i])) i -= 1;
    const name = text.slice(i + 1, end);
    if (name === '') return null;
    let j = i;
    while (j >= 0 && /\s/.test(text[j])) j -= 1;
    if (text[j] !== '.') return name;
    i = j - 1;
  }
}

/** The local names a file imports from Reanimated (FadeIn, Keyframe, LinearTransition ...). */
function reanimatedNames(text) {
  const names = new Set();
  for (const entry of importsOf(text)) {
    if (entry.spec !== REANIMATED) continue;
    for (const name of entry.names) names.add(name.local);
    if (entry.defaultName) names.add(entry.defaultName);
    if (entry.namespace) names.add(entry.namespace);
  }
  return names;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/** Calls whose first argument is itself a duration or a delay. */
const LEADING_NUMBER_CALLS = { withDelay: 'delay', 'Animated.delay': 'delay', 'Animated.stagger': 'delay', 'LayoutAnimation.create': 'duration' };
const short = (expr) => (expr.length > 48 ? `${expr.slice(0, 45)}...` : expr);

/**
 * The raw number a value expression holds, as a hit: a literal (`300`), a same-file const that holds
 * a number (`FADE_MS`, reported at the const), or the literals inside an expression
 * (`isSlow() ? 600 : 200`, `index * 50`). Member accesses (`MOTION_MS.fast`) and 0 never count.
 * Each index is reported once.
 */
function valueHits(text, { at, expr }, seen, { call, key, via = null }) {
  const direct = /^-?(\d+(?:\.\d+)?)$/.exec(expr);
  if (direct) {
    if (Number(direct[1]) === 0 || seen.has(at)) return [];
    seen.add(at);
    return [{ at, call, key, value: direct[1], via }];
  }
  if (IDENTIFIER.test(expr)) {
    const init = constInitializer(text, expr);
    if (init?.kind !== 'number' || Number(init.value) === 0 || seen.has(init.at)) return [];
    seen.add(init.at);
    return [{ at: init.at, call, key, value: init.value, via: expr }];
  }
  const literals = rawLiteralsIn(expr, { arithmetic: true });
  if (literals.length === 0 || seen.has(at)) return [];
  seen.add(at);
  return [{ at, call, key, value: literals.join(' or '), via, expr: short(expr) }];
}

/** Raw numbers of the `keys` (and their shorthand) in text[from, to); `via` names the const they came through. */
function keyHits(text, from, to, { keys, shorthand }, seen, call, via = null) {
  const found = [];
  for (const key of text.slice(from, to).matchAll(keys)) {
    const at = from + key.index;
    const value = valueExpression(text, at + key[0].length, to);
    found.push(...valueHits(text, { at, expr: value.text }, seen, { call, key: key[1], via }));
  }
  for (const key of text.slice(from, to).matchAll(shorthand)) {
    const at = from + key.index + key[0].indexOf(key[1]);
    found.push(...valueHits(text, { at, expr: key[1] }, seen, { call, key: key[1], via }));
  }
  return found;
}

/**
 * Problems inside the argument lists of the calls `pattern` finds, and inside a config the call
 * names: a bare identifier argument or a spread (`withSpring(1, BOUNCE)`, `{ ...BOUNCE, velocity }`)
 * bound to an object literal in the same file, and the leading duration or delay of withDelay,
 * Animated.delay/stagger and LayoutAnimation.create. Each index is reported once.
 */
function scanCallArguments(text, pattern, keys, seen) {
  const found = [];
  for (const call of text.matchAll(pattern)) {
    const open = call.index + call[0].length - 1;
    const end = closingIndex(text, open);
    const close = end < 0 ? text.length : end;
    const args = text.slice(open, close);
    found.push(...keyHits(text, open, close, keys, seen, call[1]));
    const parts = splitTopLevel(text.slice(open + 1, end < 0 ? text.length : end - 1));
    const named = [
      ...parts.map((part) => part.text.trim()).filter((part) => IDENTIFIER.test(part)),
      ...[...args.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)\b(?!\s*[.([])/g)].map((match) => match[1]),
    ];
    for (const name of new Set(named)) {
      const init = constInitializer(text, name);
      if (init?.kind === 'object') found.push(...keyHits(text, init.open, init.end, keys, seen, call[1], name));
    }
    const leadingKey = LEADING_NUMBER_CALLS[call[1].replace(/\s+/g, '')];
    if (leadingKey && parts.length > 0) {
      const first = parts[0];
      const at = open + 1 + first.at + (first.text.length - first.text.trimStart().length);
      found.push(...valueHits(text, { at, expr: first.text.trim() }, seen, { call: call[1], key: leadingKey }));
    }
  }
  return found;
}

function hitText(hit) {
  const where = hit.via === null ? `in ${hit.call}` : `in ${hit.via}, passed to ${hit.call}`;
  return `${hit.key} ${hit.value} ${where}${hit.expr ? ` (${hit.expr})` : ''}`;
}

/** .duration(n) / .damping(n) builders on a Reanimated layout animation (FadeIn, Keyframe ...). */
function checkBuilders(text, names, seen, { durationAt, springAt }) {
  for (const match of text.matchAll(BUILDER_CALLS)) {
    const root = chainRoot(text, match.index);
    if (root === null || !names.has(root)) continue;
    const open = match.index + match[0].length - 1;
    const end = closingIndex(text, open);
    const first = splitTopLevel(text.slice(open + 1, end < 0 ? text.length : end - 1))[0];
    if (!first) continue;
    const expr = first.text.trim();
    const [hit] = valueHits(text, { at: match.index, expr }, seen, { call: root, key: match[1] });
    if (!hit) continue;
    const isSpring = SPRING_BUILDERS.has(match[1]);
    const shown = hit.via !== null ? `.${match[1]}(${hit.via}) on ${root}: ${hit.via} is ${hit.value}` : hit.expr ? `.${match[1]}(${hit.expr}) on ${root} holds ${hit.value}` : `.${match[1]}(${hit.value}) on ${root}`;
    if (isSpring) springAt(hit.at, `raw spring ${shown}`);
    else durationAt(hit.at, `raw animation ${shown}`);
  }
}

function checkMotion(report, file, text) {
  const seen = new Set();
  const durationAt = (at, message) => report.problem({ file, line: lineOf(text, at), rule: 'no-raw-duration', message, fix: DURATION_FIX });
  const springAt = (at, message) => report.problem({ file, line: lineOf(text, at), rule: 'no-raw-spring', message, fix: SPRING_FIX });
  for (const hit of scanCallArguments(text, SPRING_CALLS, { keys: SPRING_KEYS, shorthand: SPRING_SHORTHAND }, seen)) springAt(hit.at, `raw spring ${hitText(hit)}`);
  for (const hit of scanCallArguments(text, TIMING_CALLS, { keys: DURATION_KEYS, shorthand: DURATION_SHORTHAND }, seen)) durationAt(hit.at, `raw animation ${hitText(hit)}`);
  for (const match of text.matchAll(CSS_TIMING_KEYS)) {
    if (Number(match[2]) !== 0) durationAt(match.index, `raw ${match[1]} ${match[2]}`);
  }
  const names = reanimatedNames(text);
  if (names.size > 0) checkBuilders(text, names, seen, { durationAt, springAt });
}

/**
 * Raw sizes: a number written as the value (`fontSize: 13`), or as a whole branch of a conditional or
 * logical operator (`fontSize: isNarrow() ? 13 : 17`); `RADII.md / 2` and `scale(14)` stay silent.
 */
function checkSizeKey(report, file, text, { key, rule, label, showsValue = false, counts = () => true, fix }) {
  for (const match of text.matchAll(key)) {
    const value = valueExpression(text, match.index + match[0].length);
    const direct = /^-?(\d+(?:\.\d+)?)\b/.exec(value.text);
    if (direct) {
      if (counts(Number(direct[1]))) report.problem({ file, line: lineOf(text, match.index), rule, message: showsValue ? `${label} ${direct[1]}` : label, fix });
      continue;
    }
    if (/(^|[^|])\|([^|]|$)/.test(value.text)) continue;
    const literals = rawLiteralsIn(value.text, { arithmetic: false });
    if (literals.length > 0) report.problem({ file, line: lineOf(text, match.index), rule, message: `${label} ${literals.join(' and ')} in a conditional (${short(value.text)})`, fix });
  }
}

/** Quoted strings in `expr` that are CSS named colours (not 'transparent'), with their offsets. */
function namedColorsIn(expr) {
  return [...expr.matchAll(/(["'`])([A-Za-z]+)\1/g)].filter((match) => NAMED_COLORS.has(match[2].toLowerCase())).map((match) => ({ index: match.index, name: match[2] }));
}

/**
 * Named colours where a colour goes: the value of a colour key ({ color: 'gray' }) or a colour JSX
 * attribute (color="white", thumbColor={'black'}, trackColor={{ true: 'green' }}, colors={['red']}).
 * Semantic props (variant="primary", tone="danger") are never colour attributes. A string-literal
 * union in a type (`color: 'red' | 'blue'`) is a type, not a value.
 */
function checkNamedColors(report, file, text) {
  const flag = (at, name) => report.problem({ file, line: lineOf(text, at), rule: 'no-color-literal', message: `named colour '${name}': it stays the same in dark mode and in every palette`, fix: COLOR_FIX });
  for (const match of text.matchAll(COLOR_KEY)) {
    const value = valueExpression(text, match.index + match[0].length);
    if (/(^|[^|])\|([^|]|$)/.test(value.text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, ''))) continue;
    for (const hit of namedColorsIn(value.text)) flag(value.at + hit.index, hit.name);
  }
  for (const match of text.matchAll(COLOR_ATTRIBUTE)) {
    const start = match.index + match[0].length;
    if (/["'`]/.test(text[start])) {
      const string = /^(["'`])([A-Za-z]+)\1/.exec(text.slice(start));
      if (string && NAMED_COLORS.has(string[2].toLowerCase())) flag(start, string[2]);
    } else if (text[start] === '{') {
      const end = closingIndex(text, start);
      const inner = text.slice(start + 1, end < 0 ? text.length : end - 1);
      for (const hit of namedColorsIn(inner)) flag(start + 1 + hit.index, hit.name);
    }
  }
}

/**
 * Expo Router's static HTML root (+html.tsx, +html.web.tsx) runs in Node at export time, outside every
 * provider, and paints both schemes' ground with prefers-color-scheme: reading the palette there
 * freezes nothing.
 */
const HTML_ROOT = /(^|\/)\+html(\.web)?\.tsx$/;

function checkPaletteImports(report, file, text, settings) {
  if (HTML_ROOT.test(file)) return;
  for (const entry of importsOf(text)) {
    const frozen = settings.frozen.find((target) => specifierNames(file, entry.spec, target.file, settings.aliases));
    const themes = specifierNames(file, entry.spec, settings.themeContext, settings.aliases) && (entry.isWhole || entry.names.some((name) => name.imported === 'APP_THEMES'));
    if (!frozen && !themes) continue;
    const what = frozen ? frozen.what : 'APP_THEMES';
    report.problem({ file, line: lineOf(text, entry.index), rule: 'no-palette-import', message: `imports ${what} (${entry.spec}): a colour read there is frozen to one scheme and one palette, so dark mode and every other palette miss it`, fix: PALETTE_FIX });
  }
}

const LEGACY_SHADOW = {
  shadowColor: 'shadowColor tints only Android\'s elevation shadow (API 28+) and iOS\'s legacy shadow',
  shadowOffset: 'shadowOffset is an iOS-only shadow prop',
  shadowOpacity: 'shadowOpacity is an iOS-only shadow prop',
  shadowRadius: 'shadowRadius is an iOS-only shadow prop',
};

function checkFile(report, file, source, settings) {
  const text = masked(source);
  const isTheme = within(file, settings.themeDir);
  const sheets = styleSheetRanges(text);
  if (!settings.allowColors.some((glob) => matchGlob(file, glob))) {
    scan(report, file, text, 'no-color-literal', /(['"`])(#[0-9A-Fa-f]{3,8}|(?:rgba?|hsla?)\([^'"`]*\))\1/g, { message: (m) => `colour literal ${m[2]}`, fix: COLOR_FIX });
    checkNamedColors(report, file, text);
  }
  scan(report, file, text, 'no-rounded-line-height', /\blineHeight\s*:\s*Math\.(round|ceil|floor)\s*\(/g, { message: (m) => `lineHeight uses Math.${m[1]}, so the text box leaves the device pixel grid`, fix: 'Use snapToPixels(fontSize * ratio) from use-text-style.ts (or an AppText variant).' });
  scan(report, file, text, 'no-legacy-shadow', /\b(shadowColor|shadowOffset|shadowOpacity|shadowRadius)\s*:/g, { message: (m) => `${LEGACY_SHADOW[m[1]]}: the same token renders differently on each platform`, fix: 'Use shadow() / ring() from shadow-styles.ts (boxShadow draws the same on both) or the press surface.' });
  scan(report, file, text, 'no-legacy-shadow', /\belevation\s*:/g, { when: (m) => inRanges(m.index, sheets), message: () => 'the elevation style key draws Android\'s own shadow, which iOS never draws', fix: 'Use shadow() from shadow-styles.ts; ELEVATION values are offsets, not style keys.' });
  if (!isTheme) {
    if (settings.isWeightByFamily) scan(report, file, text, 'no-font-weight', /\bfontWeight\s*:/g, { message: () => 'fontWeight with a bundled family: each weight is its own family, so there is no face to choose (Android fakes a bold, iOS keeps the face or swaps in another file of the family)', fix: 'Pick the weight through an AppText variant (fonts.ts maps each weight to its family).' });
    checkSizeKey(report, file, text, { key: /\bfontSize\s*:(?!:)/g, rule: 'no-raw-font-size', label: 'raw font size', fix: 'Use <AppText variant="..."> with a type role or style.' });
    checkSizeKey(report, file, text, { key: /\bletterSpacing\s*:(?!:)/g, rule: 'no-letter-spacing', label: 'raw letter spacing', fix: 'Track through a type style (letterSpacingEm), never in a component.' });
    checkSizeKey(report, file, text, { key: /\bborder\w*Radius\s*:(?!:)/g, rule: 'no-raw-radius', label: 'raw radius', showsValue: true, counts: (value) => value > 0, fix: 'Use a RADII token (add one to the token file when none fits).' });
    checkMotion(report, file, text);
    checkPaletteImports(report, file, text, settings);
  }
  checkMakeStyles(report, file, text);
  checkPolicy(report, file, text, settings);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root);
  const report = createReporter({ name: 'check-raw-values', json: options.json });
  if (!existsSync(join(root, layout.themeDir))) {
    const other = otherStylingPackage(root);
    if (other) return report.notApplicable(`${other} is in package.json and ${layout.themeDir} does not exist: the app styles through ${other}`);
  }
  const { contract } = readContract(root, layout, options.contract);
  const settings = settingsOf(layout, contract);
  const missing = settings.scan.filter((dir) => !existsSync(join(root, dir)));
  if (missing.length === settings.scan.length) fail(`nothing to check: ${missing.join(', ')} does not exist`, 'Run from the app repo root, or set rawValues.scan in contracts/design-system.json.');
  if (!settings.isWeightByFamily) report.note(`no-font-weight: not checked (${bundledFonts(contract) !== null ? 'fonts.weightBy is "fontWeight": one family name, weight by fontWeight' : `the contract says "fonts": "${SYSTEM_FONT}" (or has no contract yet), so fontWeight picks the system weight`})`);
  if (settings.exclude.length > 0) report.note(`scanned ${settings.scan.map((dir) => (dir === '.' ? 'the repo root' : dir)).join(', ')} minus ${settings.exclude.join(', ')} (nothing is drawn there)${settings.isRootScan ? ' and root *.config.ts / *.setup.ts files' : ''}`);
  const templateTheme = TEMPLATE_THEME_FILES.map((rel) => (normalDir(layout.srcDir) === '.' ? rel : `${normalDir(layout.srcDir)}/${rel}`)).filter((rel) => existsSync(join(root, rel)) && !within(rel, layout.themeDir));
  if (templateTheme.length > 0) report.note(`${templateTheme.join(' and ')}: the create-expo-app template's own theme. Migrate its values into the token file and delete it before fixing its colour literals one by one (references/tokens-and-contract.md, "Adopting the create-expo-app theme"); check-design-system fails on it (second-theme-system)`);
  const files = scanFiles(root, settings);
  for (const file of files) checkFile(report, file, readSource(join(root, file)) ?? '', settings);
  return report.finish({ checked: files.length, unit: 'files' });
});
