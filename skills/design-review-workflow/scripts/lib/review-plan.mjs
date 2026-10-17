// review-plan.mjs: the design-review plan (contracts/design-review.json), the repo facts it must
// follow (app config, languages, screen contract, motion catalog, debug-link contract) and the cells
// and videos it expands to. Not an entry point; imported by check-review-plan.mjs, check-review.mjs,
// check-signoff.mjs and new-review.mjs. This skill's own helper (not synced): the cell grammar here
// and in the shipped templates/scripts/design-review/review-cells.ts must stay the same (selftest.mjs
// compares both on the same plan).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseJsonc, sha256, toPosix, UsageError } from '../check-lib.mjs';
import { findConstInitializer, parseObjectEntries, parseValue } from './ts-literal.mjs';

export const PLAN_FILE = 'design-review.json';
export const DEFAULT_REVIEWS_DIR = 'design-review';
export const DEFAULT_CAPTURES_DIR = 'reports/design-review';
export const DEFAULT_MOTION_CATALOG = 'src/ui/motion/motion-moments.ts';

export const THEMES = ['light', 'dark'];
export const PLATFORMS = ['ios', 'android', 'web'];
export const DEVICE_ROLES = ['smallest-phone', 'phone', 'tablet', 'foldable', 'desktop'];
export const ORIENTATIONS = ['portrait', 'landscape'];
/** The sweep runs on the preview build: Release JavaScript that keeps the debug link the capture needs. */
export const VARIANTS = ['preview'];
export const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const DEVICE_NAME = /^[a-z0-9]+(-[a-z0-9]+)+$/;
/** Parameters every combination sets itself; a state's open link never carries them. */
export const COMBINATION_PARAMS = ['lang', 'theme', 'motion'];
/** Right-to-left scripts by primary language subtag (used when the app has no languages.ts). */
export const KNOWN_RTL = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ks', 'ps', 'sd', 'ug', 'ur', 'yi']);
export const MIN_WHY = 20;

/** iOS content-size categories `xcrun simctl ui <udid> content_size` accepts (Xcode 26.6). */
export const IOS_CONTENT_SIZES = [
  'extra-small', 'small', 'medium', 'large', 'extra-large', 'extra-extra-large', 'extra-extra-extra-large',
  'accessibility-medium', 'accessibility-large', 'accessibility-extra-large', 'accessibility-extra-extra-large',
  'accessibility-extra-extra-extra-large',
];
/** The two text sizes every plan sweeps: the platform default and the largest a person can pick. */
export const REQUIRED_TEXT_SIZES = {
  default: { ios: 'large', android: 1 },
  largest: { ios: 'accessibility-extra-extra-extra-large', android: 2 },
};

/**
 * The on-device steps every plan keeps (an app may add its own). Destructive steps destroy the state
 * the others need, so they run last. A failed `blocker` step is always a BLOCKER finding.
 */
export const CORE_STEPS = [
  { id: 'real-state', destructive: false, blocker: false },
  { id: 'screen-reader', destructive: false, blocker: true },
  { id: 'switch-access', destructive: false, blocker: true },
  { id: 'largest-text', destructive: false, blocker: true },
  { id: 'reduce-motion', destructive: false, blocker: true },
  { id: 'audio-haptics', destructive: false, blocker: false },
  { id: 'interruptions', destructive: false, blocker: false },
  { id: 'upgrade-in-place', destructive: true, blocker: true },
  { id: 'backup-restore', destructive: true, blocker: true },
  { id: 'crash-log', destructive: true, blocker: true },
  { id: 'fresh-install', destructive: true, blocker: true },
];

const PLAN_KEYS = new Set(['$schema', '$comment', 'version', 'reviewsDir', 'capturesDir', 'screens', 'themes', 'locales', 'textSizes', 'devices', 'motion', 'build', 'signoff', 'devicePass']);
const SIGNOFF_KEYS = new Set(['watch', 'ignore']);
const SCREENS_KEYS = new Set(['contract', 'exclude', 'open', 'invariant']);
const AXES = ['theme', 'locale', 'text'];

/** Line of the first `needle` after the previous ones (each a plain substring), or 1. */
export function jsonLine(text, ...needles) {
  let from = 0;
  let found = -1;
  for (const needle of needles) {
    const at = text.indexOf(needle, from);
    if (at === -1) break;
    found = at;
    from = at + needle.length;
  }
  if (found === -1) return 1;
  return text.slice(0, found).split('\n').length;
}

export function readJsonFile(path, what) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { error: `${what} cannot be read` };
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch (error) {
    return { text, error: `${what} is not valid JSON (${error.message})` };
  }
}

export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function isRepoRel(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.split('/').includes('..');
}

/** The plan file of the repo, or a UsageError (exit 2: nothing to check). */
export function loadPlan(root, layout, given) {
  const rel = toPosix(given ?? join(layout.contractsDir, PLAN_FILE));
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    throw new UsageError(`nothing to check: ${rel} not found`, `Copy this skill's templates/contracts/design-review.json (and its schema) to ${toPosix(layout.contractsDir)}/ and fill it from the app (references/sweep-matrix.md).`);
  }
  const read = readJsonFile(abs, rel);
  if (read.error) throw new UsageError(read.error, `Fix ${rel}; templates/contracts/design-review.json shows the shape.`);
  const plan = read.value ?? {};
  return {
    rel,
    text: read.text,
    sha256: sha256(read.text),
    plan,
    reviewsDir: isRepoRel(plan.reviewsDir) ? plan.reviewsDir : DEFAULT_REVIEWS_DIR,
    capturesDir: isRepoRel(plan.capturesDir) ? plan.capturesDir : DEFAULT_CAPTURES_DIR,
    screensContract: isRepoRel(plan.screens?.contract) ? plan.screens.contract : toPosix(join(layout.contractsDir, 'screens.json')),
    motionCatalog: isRepoRel(plan.motion?.catalog) ? plan.motion.catalog : DEFAULT_MOTION_CATALOG,
  };
}

function textSizeProblems(plan, add) {
  if (!Array.isArray(plan.textSizes) || plan.textSizes.length === 0) {
    add('"textSizes" must list { id, ios, android }', '"textSizes"');
    return;
  }
  const ids = new Set();
  for (const size of plan.textSizes) {
    if (!isObject(size) || typeof size.id !== 'string' || !KEBAB.test(size.id)) {
      add(`text size ${JSON.stringify(size)} needs a kebab-case "id"`, '"textSizes"');
      continue;
    }
    if (ids.has(size.id)) add(`text size "${size.id}" is listed twice`, `"id": "${size.id}"`);
    ids.add(size.id);
    if (size.ios !== undefined && !IOS_CONTENT_SIZES.includes(size.ios)) add(`text size "${size.id}": "${size.ios}" is not an iOS content-size category`, `"id": "${size.id}"`);
    if (size.android !== undefined && !(typeof size.android === 'number' && size.android > 0 && size.android <= 3)) add(`text size "${size.id}": android must be a font_scale number (1 = default)`, `"id": "${size.id}"`);
    if (size.devices !== undefined && !(Array.isArray(size.devices) && size.devices.length > 0 && size.devices.every((d) => typeof d === 'string'))) {
      add(`text size "${size.id}": "devices" must list device ids (leave it out to sweep every device)`, `"id": "${size.id}"`);
    }
  }
}

function deviceProblems(plan, add) {
  if (!Array.isArray(plan.devices) || plan.devices.length === 0) {
    add('"devices" must list { id, platform, role, model, name }', '"devices"');
    return;
  }
  const ids = new Set();
  for (const device of plan.devices) {
    if (!isObject(device) || typeof device.id !== 'string' || !KEBAB.test(device.id) || !PLATFORMS.includes(device.platform) || !DEVICE_ROLES.includes(device.role) || typeof device.model !== 'string' || device.model.length === 0) {
      add(`device ${JSON.stringify(device?.id ?? device)} needs a kebab-case "id", "platform" (${PLATFORMS.join(', ')}), "role" (${DEVICE_ROLES.join(', ')}) and "model"`, device?.id ? `"id": "${device.id}"` : '"devices"');
      continue;
    }
    if (ids.has(device.id)) add(`device "${device.id}" is listed twice`, `"id": "${device.id}"`);
    ids.add(device.id);
    if (device.orientation !== undefined && !ORIENTATIONS.includes(device.orientation)) add(`device "${device.id}": "orientation" must be portrait or landscape`, `"id": "${device.id}"`);
    if (device.size !== undefined && !(Array.isArray(device.size) && device.size.length === 2 && device.size.every((n) => Number.isInteger(n) && n > 0))) {
      add(`device "${device.id}": "size" must be [width, height] in pixels`, `"id": "${device.id}"`);
    }
  }
}

function localeProblems(plan, add) {
  if (!Array.isArray(plan.locales) || plan.locales.length === 0) {
    add('"locales" must list { tag, direction }', '"locales"');
    return;
  }
  const tags = new Set();
  for (const locale of plan.locales) {
    if (!isObject(locale) || typeof locale.tag !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(locale.tag) || !['ltr', 'rtl'].includes(locale.direction)) {
      add(`locale ${JSON.stringify(locale)} needs a language tag and "direction": "ltr" or "rtl"`, '"locales"');
    } else if (tags.has(locale.tag)) add(`locale "${locale.tag}" is listed twice`, `"tag": "${locale.tag}"`);
    else tags.add(locale.tag);
  }
}

function screensProblems(plan, add) {
  if (!isObject(plan.screens)) {
    add('"screens" must be an object: the screen contract, the open link of every state, the exclusions', '"screens"');
    return;
  }
  for (const key of Object.keys(plan.screens)) if (!SCREENS_KEYS.has(key)) add(`unknown key "screens.${key}"`, `"${key}"`);
  if (plan.screens.contract !== undefined && !isRepoRel(plan.screens.contract)) add('"screens.contract" must be a repo-relative file', '"contract"');
  if (plan.screens.exclude !== undefined && !Array.isArray(plan.screens.exclude)) add('"screens.exclude" must be a list of { id, why }', '"exclude"');
  if (!isObject(plan.screens.open)) add('"screens.open" must map every "<screen>.<state>" to the link that opens it', '"screens"');
  else {
    for (const [key, value] of Object.entries(plan.screens.open)) {
      if (typeof value !== 'string' || value.trim() === '') add(`"screens.open" entry "${key}" must be a debug-link query or an app path`, `"${key}"`);
    }
  }
  if (plan.screens.invariant !== undefined) {
    const ok = Array.isArray(plan.screens.invariant) && plan.screens.invariant.every((e) => isObject(e) && typeof e.screen === 'string' && AXES.includes(e.axis));
    if (!ok) add(`"screens.invariant" must be a list of { screen, axis (${AXES.join(', ')}), why }`, '"invariant"');
  }
}

function signoffProblems(plan, add) {
  if (plan.signoff === undefined) return;
  if (!isObject(plan.signoff)) {
    add('"signoff" must be an object: { "watch": [globs], "ignore": [globs] }', '"signoff"');
    return;
  }
  for (const key of Object.keys(plan.signoff)) if (!SIGNOFF_KEYS.has(key)) add(`unknown key "signoff.${key}"`, `"${key}"`);
  for (const key of SIGNOFF_KEYS) {
    const list = plan.signoff[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.some((g) => !isRepoRel(g) || g.trim() !== g)) add(`"signoff.${key}" must list repo-relative path globs (src/**, native/, *.lock)`, `"${key}"`);
  }
}

/**
 * A repo-path glob as a RegExp: `**` crosses folders, `*` and `?` stay inside one, a trailing `/`
 * means everything under that folder.
 */
export function globToRegExp(glob) {
  const body = glob.endsWith('/') ? `${glob}**` : glob;
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '*' && body[i + 1] === '*') {
      out += body[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += body[i + 2] === '/' ? 2 : 1;
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Shape problems of the plan (rule plan-invalid); an empty list means the other rules can read it. */
export function planShapeProblems(loaded) {
  const { plan, text, rel } = loaded;
  const problems = [];
  const add = (message, needle, fix = 'Follow templates/contracts/design-review.json and references/sweep-matrix.md.') =>
    problems.push({ file: rel, line: needle ? jsonLine(text, needle) : 1, rule: 'plan-invalid', message, fix });
  if (!isObject(plan)) {
    add('the plan is not a JSON object');
    return problems;
  }
  for (const key of Object.keys(plan)) if (!PLAN_KEYS.has(key)) add(`unknown key "${key}"`, `"${key}"`);
  if (plan.version !== 1) add('"version" must be 1', '"version"');
  for (const key of ['reviewsDir', 'capturesDir']) {
    if (plan[key] !== undefined && !isRepoRel(plan[key])) add(`"${key}" must be a repo-relative folder`, `"${key}"`);
  }
  screensProblems(plan, add);
  if (!Array.isArray(plan.themes) || plan.themes.length === 0 || plan.themes.some((t) => !THEMES.includes(t)) || new Set(plan.themes).size !== plan.themes.length) {
    add('"themes" must list "light" and/or "dark", each once', '"themes"');
  }
  localeProblems(plan, add);
  textSizeProblems(plan, add);
  deviceProblems(plan, add);
  if (plan.motion !== undefined && !isObject(plan.motion)) add('"motion" must be an object', '"motion"');
  if (!isObject(plan.build)) add('"build" must name the "variant" the sweep runs on', '"build"');
  signoffProblems(plan, add);
  if (!isObject(plan.devicePass) || !Array.isArray(plan.devicePass.steps) || !Array.isArray(plan.devicePass.hardware)) {
    add('"devicePass" must list the "hardware" and the on-device "steps"', '"devicePass"');
  }
  return problems;
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * Every `key: <value>` of a JS/TS app config, as { value, index }: a string or boolean literal, or a
 * top-level `const NAME = <literal>;` of the same file named by the value (`version: APP_VERSION`, the
 * shape the release lanes keep). `value` is undefined when the value is computed (`pkg.version`, a
 * call, a condition): such a key is read as absent and listed in the facts' `computed`.
 */
export function configValues(text, key) {
  const out = [];
  const re = new RegExp(`(?<![\\w$.])${key}\\s*:\\s*([^,}\\n]+)`, 'g');
  for (const match of text.matchAll(re)) {
    out.push({ value: literalValue(text, match[1].trim()), index: match.index });
  }
  return out;
}

function literalValue(text, raw) {
  const literal = /^(?:(['"])([^'"]*)\1|(true|false))$/.exec(raw);
  if (literal) return literal[3] !== undefined ? literal[3] === 'true' : literal[2];
  if (!IDENT.test(raw) || raw === 'undefined') return undefined;
  const decl = new RegExp(`^(?:export\\s+)?const\\s+${raw.replace(/\$/g, '\\$')}\\s*(?::[^=\\n]+)?=\\s*(?:(['"])([^'"]*)\\1|(true|false))\\s*(?:as\\s+const\\s*)?;?\\s*$`, 'm').exec(text);
  if (!decl) return undefined;
  return decl[3] !== undefined ? decl[3] === 'true' : decl[2];
}

/** The app's facts from app.config.ts / app.config.js / app.json, or null when none exists. */
export function appFacts(root) {
  for (const file of ['app.config.ts', 'app.config.js', 'app.config.mjs']) {
    const abs = join(root, file);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const computed = new Set();
    const read = (key) => {
      const values = configValues(text, key);
      for (const v of values) if (v.value === undefined) computed.add(key);
      return values.filter((v) => v.value !== undefined);
    };
    const styles = read('userInterfaceStyle').filter((v) => typeof v.value === 'string');
    const platforms = /\bplatforms\s*:\s*\[([^\]]*)\]/.exec(text);
    const orientation = read('orientation').find((v) => typeof v.value === 'string');
    const version = read('version').find((v) => typeof v.value === 'string');
    return {
      file,
      text,
      userInterfaceStyles: styles.map((v) => v.value),
      userInterfaceStyleLine: styles.length > 0 ? lineAt(text, styles[0].index) : 1,
      supportsTablet: [...read('supportsTablet'), ...read('isTabletOnly')].some((v) => v.value === true),
      requireFullScreen: read('requireFullScreen').some((v) => v.value === true),
      platforms: platforms ? [...platforms[1].matchAll(/['"](\w+)['"]/g)].map((m) => m[1]) : null,
      orientation: orientation ? orientation.value : 'default',
      version: version ? version.value : null,
      computed: [...computed],
    };
  }
  const json = join(root, 'app.json');
  if (!existsSync(json)) return null;
  const text = readFileSync(json, 'utf8');
  let expo;
  try {
    const data = parseJsonc(text);
    expo = data.expo ?? data;
  } catch {
    throw new UsageError('app.json is not valid JSON', 'Fix app.json.');
  }
  const styles = [expo.userInterfaceStyle, expo.ios?.userInterfaceStyle, expo.android?.userInterfaceStyle].filter((s) => typeof s === 'string');
  return {
    file: 'app.json',
    text,
    userInterfaceStyles: styles,
    userInterfaceStyleLine: 1,
    supportsTablet: expo.ios?.supportsTablet === true || expo.ios?.isTabletOnly === true,
    requireFullScreen: expo.ios?.requireFullScreen === true,
    platforms: Array.isArray(expo.platforms) ? expo.platforms : null,
    orientation: typeof expo.orientation === 'string' ? expo.orientation : 'default',
    version: typeof expo.version === 'string' ? expo.version : null,
    computed: [],
  };
}

/** The themes a person can see: light unless some userInterfaceStyle says dark or automatic. */
export function appThemes(facts) {
  const styles = facts.userInterfaceStyles.length > 0 ? facts.userInterfaceStyles : ['light'];
  const themes = new Set();
  for (const style of styles) {
    if (style === 'automatic') {
      themes.add('light');
      themes.add('dark');
    } else if (style === 'dark') themes.add('dark');
    else themes.add('light');
  }
  return THEMES.filter((t) => themes.has(t));
}

/** The platforms the app ships: an explicit `platforms` list, else iOS and Android (Expo's default). */
export function shippedPlatforms(facts) {
  if (facts?.platforms) return PLATFORMS.filter((p) => facts.platforms.includes(p));
  return ['ios', 'android'];
}

/**
 * The app's languages and which are right to left, from <i18nDir>/languages.ts: { rel, languages,
 * rtl }, or { rel, missing: true } when the file is absent, or { rel, error } when its `LANGUAGES`
 * literal cannot be read.
 */
export function appLanguages(root, layout) {
  const rel = toPosix(join(layout.i18nDir, 'languages.ts'));
  const abs = join(root, rel);
  if (!existsSync(abs)) return { rel, missing: true };
  const text = readFileSync(abs, 'utf8');
  const start = findConstInitializer(text, 'LANGUAGES');
  if (start === -1) return { rel, error: `${rel} has no \`LANGUAGES\` constant` };
  let languages;
  try {
    languages = parseValue(text, start).value;
  } catch (error) {
    return { rel, error: `the \`LANGUAGES\` literal of ${rel} cannot be read (${error.message})` };
  }
  if (!Array.isArray(languages) || languages.length === 0 || languages.some((tag) => typeof tag !== 'string')) {
    return { rel, error: `\`LANGUAGES\` in ${rel} is not a literal list of language tags` };
  }
  const rtlMatch = /\bRTL_LANGUAGES\b[^=]*=\s*new\s+Set\s*(?:<[^>]*>)?\s*\(\s*\[/.exec(text);
  let rtl = languages.filter((tag) => KNOWN_RTL.has(String(tag).toLowerCase().split('-')[0]));
  if (rtlMatch) {
    try {
      rtl = parseValue(text, rtlMatch.index + rtlMatch[0].length - 1).value;
    } catch {
      // keep the known list
    }
  }
  return { rel, languages, rtl: new Set(rtl) };
}

/** Moment ids of the motion catalog (`MOTION_MOMENTS`), or null when the file is absent. */
export function momentIds(root, catalog) {
  const abs = join(root, catalog);
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, 'utf8');
  const start = findConstInitializer(text, 'MOTION_MOMENTS');
  if (start === -1) return [];
  try {
    return parseObjectEntries(text, start).map((entry) => entry.key);
  } catch {
    return [];
  }
}

/** The debug-link contract's repo path: <contractsDir>/debug-links.json (the plan's own folder). */
export const debugLinksRel = (layout) => toPosix(join(layout?.contractsDir ?? 'contracts', 'debug-links.json'));

/**
 * The debug-link contract's parameters ({ rel, params: { name: { values? } } }), { rel, error }, or
 * { rel, missing: true } when the file is absent.
 */
export function debugLinkParams(root, layout) {
  const rel = debugLinksRel(layout);
  const abs = join(root, rel);
  if (!existsSync(abs)) return { rel, missing: true };
  const read = readJsonFile(abs, rel);
  if (read.error || !isObject(read.value?.params)) return { rel, error: read.error ?? `${rel} has no "params" object` };
  return { rel, params: read.value.params };
}

/**
 * The screens and states the sweep covers, from the screen contract: every entry except `embedded`
 * parts and the plan's exclusions, each with its states (the default first). Returns { missing }
 * or { error } when the contract cannot be read.
 */
export function sweptScreens(root, loaded) {
  const rel = loaded.screensContract;
  const abs = join(root, rel);
  if (!existsSync(abs)) return { missing: true, rel };
  const read = readJsonFile(abs, rel);
  if (read.error) return { error: read.error, rel };
  const screens = Array.isArray(read.value?.screens) ? read.value.screens : null;
  if (!screens) return { error: `${rel} has no "screens" list`, rel };
  const excluded = new Set((Array.isArray(loaded.plan.screens?.exclude) ? loaded.plan.screens.exclude : []).map((e) => e?.id));
  const out = [];
  for (const screen of screens) {
    if (!isObject(screen) || typeof screen.id !== 'string') continue;
    if (screen.presentation === 'embedded' || excluded.has(screen.id)) continue;
    const states = Array.isArray(screen.states) && screen.states.length > 0
      ? screen.states.map((s) => (typeof s === 'string' ? s : s?.id)).filter((s) => typeof s === 'string')
      : ['default'];
    out.push({ id: screen.id, states });
  }
  return { rel, sha256: sha256(read.text), screens: out, all: screens };
}

/** The file name of one cell: <screen>.<state>--<theme>--<locale>--<text size>--<device> */
export function cellName({ screen, state, theme, locale, text, device }) {
  return `${screen}.${state}--${theme}--${locale}--${text}--${device}`;
}

/** The devices a text size is swept on: its `devices` list, or every device. */
export function textSizeDevices(plan, size) {
  const all = plan.devices.map((d) => d.id);
  return Array.isArray(size.devices) ? all.filter((id) => size.devices.includes(id)) : all;
}

/** Every cell of the plan: screen x state x theme x locale x text size x device, sorted by name. */
export function planCells(plan, screens) {
  const cells = [];
  for (const { id: screen, states } of screens) {
    for (const state of states) {
      for (const theme of plan.themes) {
        for (const { tag: locale } of plan.locales) {
          for (const size of plan.textSizes) {
            for (const device of textSizeDevices(plan, size)) {
              const cell = { screen, state, theme, locale, text: size.id, device };
              cells.push({ ...cell, name: cellName(cell) });
            }
          }
        }
      }
    }
  }
  return cells.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The motion videos the plan asks for: each recorded moment x platform x full/reduced, sorted. */
export function planVideos(plan) {
  const record = Array.isArray(plan.motion?.record) ? plan.motion.record.filter((m) => typeof m === 'string') : [];
  const platforms = [...new Set(plan.devices.map((d) => d.platform))].filter((p) => p !== 'web');
  const videos = [];
  for (const moment of record) {
    for (const platform of platforms) {
      for (const motion of ['full', 'reduced']) videos.push(`${moment}--${platform}--${motion}`);
    }
  }
  return videos.sort();
}

/** Local calendar day YYYY-MM-DD (the day a person would write on the record). */
export function localToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isIsoDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
