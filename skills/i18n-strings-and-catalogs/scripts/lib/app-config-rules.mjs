// app-config-rules.mjs: the app.config rules of check-i18n-code.mjs (system texts and declared
// languages). Not an entry point. Every function takes the config's text with comments masked
// (check-lib maskComments: strings kept) and returns plain findings; the checker reports them.
//
//   literalPurposeTexts(masked) -> [{ index, name, value }]
//       an Info.plist purpose key (NS…UsageDescription) or a config plugin's *Permission /
//       *UsageDescription option
//       whose value is a string literal with letters: one language for every person
//   uncoveredPurposeKeys(masked) -> [{ index, plistKey, via }]
//       a purpose key the config sets (directly, or through a known plugin option) with a value read
//       from elsewhere, that NATIVE_TEXT_KEYS.usageDescriptions does not list: only the base text
//       reaches iOS, so every other language shows it untranslated
//   defaultPurposeTexts(masked, installed) -> [{ index, pkg, listed, plistKeys }]
//       a permission plugin that runs (named in the config, or an installed package prebuild applies
//       on its own) and writes a purpose key the config neither names nor passes an option for: the
//       plugin's English default reaches every language
//   missingVariantName(masked) -> null | { index }
//       the config builds variants (APP_VARIANT, resolveAppVariant, variantIdentity) but calls
//       nativeLocales() without options: every variant then shows the store name in every language
//   supportedLocalesProblem(masked, languages) -> null | { index, message }
//       the ['expo-localization', options] entry passes supportedLocales whose value (followed through
//       same-file const declarations) comes from readAppLanguages(), or literal lists equal to LANGUAGES
//   configCatalogKeys(masked) -> [{ index, key, via }]
//       every catalog key the config names: the values of NATIVE_TEXT_KEYS (or of the object literal
//       passed to nativeLocales) and the key of each sourceText(projectRoot, '<key>') call; the
//       checker looks each up in the source catalog (npx expo config throws on a missing one)

import { findClosing } from './source-scan.mjs';

const LETTER = /\p{L}/u;
const QUOTED = `(['"\`])((?:(?!\\2)[^\\\\\\n]|\\\\.)*)\\2`;
const PURPOSE_NAME = '\\w*UsageDescription|\\w+Permission';
const LITERAL_PURPOSE = new RegExp(`\\b(${PURPOSE_NAME})\\s*:\\s*${QUOTED}`, 'gu');

/**
 * Config plugin options that set Info.plist purpose strings (Expo SDK 57 plugin sources, read on
 * 2026-10-03: expo-camera, expo-image-picker, expo-audio, expo-media-library, expo-location,
 * expo-sensors, expo-contacts, expo-calendar, expo-local-authentication, expo-tracking-transparency,
 * react-native-google-mobile-ads).
 */
export const PERMISSION_OPTION_KEYS = Object.freeze({
  cameraPermission: ['NSCameraUsageDescription'],
  microphonePermission: ['NSMicrophoneUsageDescription'],
  photosPermission: ['NSPhotoLibraryUsageDescription'],
  savePhotosPermission: ['NSPhotoLibraryAddUsageDescription'],
  locationWhenInUsePermission: ['NSLocationWhenInUseUsageDescription'],
  locationAlwaysPermission: ['NSLocationAlwaysUsageDescription'],
  locationAlwaysAndWhenInUsePermission: ['NSLocationAlwaysAndWhenInUseUsageDescription'],
  motionUsagePermission: ['NSMotionUsageDescription'],
  motionPermission: ['NSMotionUsageDescription'],
  contactsPermission: ['NSContactsUsageDescription'],
  calendarPermission: ['NSCalendarsUsageDescription', 'NSCalendarsFullAccessUsageDescription'],
  writeOnlyCalendarPermission: ['NSCalendarsWriteOnlyAccessUsageDescription'],
  remindersPermission: ['NSRemindersUsageDescription', 'NSRemindersFullAccessUsageDescription'],
  faceIDPermission: ['NSFaceIDUsageDescription'],
  userTrackingPermission: ['NSUserTrackingUsageDescription'],
  userTrackingUsageDescription: ['NSUserTrackingUsageDescription'], // react-native-google-mobile-ads
});

/**
 * Permission plugins and the purpose keys they write with an English default ('Allow $(PRODUCT_NAME)
 * to access your camera') unless an option or the config sets them (SDK 57 plugin sources, read on
 * 2026-10-10). `auto`: @expo/prebuild-config 57 applies the plugin of an installed package on its own
 * (withLegacyExpoPlugins, withVersionedExpoSDKPlugins), even when app.config does not list it.
 * `writeOnly`: with the option `writeOnlyAccess: true`, expo-calendar 57 writes
 * NSCalendarsWriteOnlyAccessUsageDescription in place of NSCalendarsFullAccessUsageDescription.
 */
export const PERMISSION_PLUGINS = Object.freeze({
  'expo-image-picker': { auto: true, keys: ['NSPhotoLibraryUsageDescription', 'NSCameraUsageDescription', 'NSMicrophoneUsageDescription'] },
  'expo-camera': { auto: true, keys: ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription'] },
  'expo-media-library': { auto: true, keys: ['NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription'] },
  'expo-location': { auto: true, keys: ['NSLocationAlwaysAndWhenInUseUsageDescription', 'NSLocationAlwaysUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSMotionUsageDescription'] },
  'expo-sensors': { auto: true, keys: ['NSMotionUsageDescription'] },
  'expo-local-authentication': { auto: true, keys: ['NSFaceIDUsageDescription'] },
  'expo-contacts': { auto: true, keys: ['NSContactsUsageDescription'] },
  'expo-calendar': { auto: true, keys: ['NSCalendarsUsageDescription', 'NSCalendarsFullAccessUsageDescription', 'NSRemindersUsageDescription', 'NSRemindersFullAccessUsageDescription'], writeOnly: { NSCalendarsFullAccessUsageDescription: 'NSCalendarsWriteOnlyAccessUsageDescription' } },
  'expo-audio': { auto: false, keys: ['NSMicrophoneUsageDescription'] },
  'expo-tracking-transparency': { auto: false, keys: ['NSUserTrackingUsageDescription'] },
});

/**
 * Purpose keys a permission plugin fills with its English default: the plugin runs (an installed
 * `auto` package, or one the config names) and nothing in the config names the key (NATIVE_TEXT_KEYS,
 * infoPlist) or passes an option for it (a value or `false`). Heuristic: an option counts for every
 * plugin that shares its name (cameraPermission on expo-camera and expo-image-picker alike).
 */
export function defaultPurposeTexts(masked, installed) {
  const options = new Set([...masked.matchAll(/\b(\w+Permission|\w*UsageDescription)\s*:/g)].map((m) => m[1]));
  const covered = (plistKey) => new RegExp(`\\b${plistKey}\\b`).test(masked) || [...options].some((name) => (PERMISSION_OPTION_KEYS[name] ?? []).includes(plistKey));
  const found = [];
  const isWriteOnly = /\bwriteOnlyAccess\s*:\s*true\b/.test(masked);
  for (const [pkg, { auto, keys, writeOnly }] of Object.entries(PERMISSION_PLUGINS)) {
    const named = masked.search(new RegExp(`(['"\`])${escapeRegExp(pkg)}\\1`));
    if (named === -1 && !(auto && installed.has(pkg))) continue;
    const written = isWriteOnly && writeOnly ? keys.map((key) => writeOnly[key] ?? key) : keys;
    const plistKeys = written.filter((key) => !covered(key));
    if (plistKeys.length > 0) found.push({ index: named !== -1 ? named : Math.max(masked.search(/\bplugins\s*:/), 0), pkg, listed: named !== -1, plistKeys });
  }
  return found;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A catalog key ('permissions.camera.usage-description'), which names a text instead of being one. */
const CATALOG_KEY = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){1,4}$/;

export function literalPurposeTexts(masked) {
  const found = [];
  for (const match of masked.matchAll(LITERAL_PURPOSE)) {
    if (LETTER.test(match[3]) && !CATALOG_KEY.test(match[3])) found.push({ index: match.index, name: match[1], value: match[3] });
  }
  return found;
}

/** The span of the usageDescriptions object literal (NATIVE_TEXT_KEYS), or null. */
function usageDescriptionsSpan(masked) {
  const match = /\busageDescriptions\s*:\s*\{/.exec(masked);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = findClosing(masked, open);
  return close === -1 ? null : { from: open, to: close };
}

export function uncoveredPurposeKeys(masked) {
  const span = usageDescriptionsSpan(masked);
  const inside = (index) => span !== null && index > span.from && index < span.to;
  const listed = new Set(span ? [...masked.slice(span.from, span.to).matchAll(/\b(NS\w+UsageDescription)\s*:/g)].map((m) => m[1]) : []);
  const set = [];
  for (const match of masked.matchAll(new RegExp(`\\b(${PURPOSE_NAME})\\s*:\\s*([^\\s,}])`, 'g'))) {
    const value = /^[\w$.]*/.exec(masked.slice(match.index + match[0].length - 1))[0];
    // A literal (reported by literalPurposeTexts), `false` (the plugin removes the key), or a type annotation.
    if (inside(match.index) || /['"`]/.test(match[2]) || /^(false|true|string|boolean|undefined|null)$/.test(value)) continue;
    const plistKeys = /^NS\w+UsageDescription$/.test(match[1]) ? [match[1]] : (PERMISSION_OPTION_KEYS[match[1]] ?? []);
    for (const plistKey of plistKeys.filter((key) => !listed.has(key))) {
      set.push({ index: match.index, plistKey, via: match[1] });
    }
  }
  return set;
}

/** The number of top-level arguments of the call whose "(" is at `open`. */
function argumentCount(masked, open) {
  const close = findClosing(masked, open);
  const inner = masked.slice(open + 1, close === -1 ? masked.length : close);
  if (inner.trim() === '') return 0;
  let depth = 0;
  let count = 1;
  for (const ch of inner) {
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) count += 1;
  }
  return inner.trim().endsWith(',') ? count - 1 : count;
}

export function missingVariantName(masked) {
  if (!/\b(APP_VARIANT|resolveAppVariant|variantIdentity)\b/.test(masked)) return null;
  const call = /\bnativeLocales\s*\(/.exec(masked);
  if (!call) return null;
  return argumentCount(masked, call.index + call[0].length - 1) < 3 ? { index: call.index } : null;
}

/** The text of the expression after `from`, up to a top-level , ; or closing bracket. */
function valueAt(masked, from) {
  let depth = 0;
  for (let i = from; i < masked.length; i += 1) {
    const ch = masked[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return masked.slice(from, i);
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return masked.slice(from, i);
  }
  return masked.slice(from);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The local names a declaration binds from readAppLanguages(): `const { languages } = …` ->
 * languages, `const { languages: list } = …` -> list, `const app = …` -> app (read as app.languages).
 */
function readAppLanguagesBindings(masked) {
  const names = new Set();
  for (const m of masked.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*readAppLanguages\s*\(/g)) {
    const parts = m[1].startsWith('{') ? m[1].slice(1, -1).split(',') : [m[1]];
    for (const part of parts) {
      const local = part.split('=')[0].split(':').at(-1).trim().replace(/^\.\.\./, '');
      if (IDENTIFIER.test(local)) names.add(local);
    }
  }
  return names;
}

/** `const name = <value>` (or let/var, a type annotation allowed): { index, text } of the value, or null. */
function declaredValue(masked, name) {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\b\\s*(?::[^=;]+)?=\\s*`).exec(masked);
  return m ? { index: m.index, text: valueAt(masked, m.index + m[0].length) } : null;
}

/** An expression that is a bare name: followed to its declaration (a few hops), unless it is one of `stop`. */
function followName(masked, value, stop) {
  let current = value;
  for (let hop = 0; hop < 4 && IDENTIFIER.test(current.text.trim()) && !stop.has(current.text.trim()); hop += 1) {
    const next = declaredValue(masked, current.text.trim());
    if (!next) break;
    current = next;
  }
  return current;
}

/** The options of the ['expo-localization', options] entry ({ index, text }; text '' when it has none). */
function localizationOptions(masked, plugin) {
  const entry = /\[\s*(['"])expo-localization\1\s*,\s*/.exec(masked);
  if (!entry) return { index: plugin, text: '' };
  const from = entry.index + entry[0].length;
  return { index: from, text: valueAt(masked, from) };
}

/** Arrays that hold only quoted strings (['en', 'ar'], []), as lists of their items. */
function literalLists(text) {
  return [...text.matchAll(/\[\s*((?:(['"])[^'"\n]*\2\s*,?\s*)*)\]/g)].map((m) => [...m[1].matchAll(/(['"])([^'"\n]*)\1/g)].map((item) => item[2]));
}

/**
 * supported-locales: the value expo-localization's supportedLocales gets must come from
 * readAppLanguages() (a call, or a name bound from one, followed through const declarations), or be
 * literal lists equal to LANGUAGES. A readAppLanguages() call elsewhere in the file proves nothing:
 * `const supportedLocales = { ios: ['en'] }` next to it, or an entry without { supportedLocales },
 * still declares the wrong languages.
 */
export function supportedLocalesProblem(masked, languages) {
  const plugin = masked.search(/['"]expo-localization['"]/);
  const fix = { index: Math.max(plugin, 0) };
  if (plugin === -1) return { ...fix, message: 'the config does not list the expo-localization plugin, so iOS Settings and Android 13+ offer no per-app language' };
  const bindings = readAppLanguagesBindings(masked);
  const options = followName(masked, localizationOptions(masked, plugin), new Set());
  const key = /(?:^|[{,\s])(['"]?)supportedLocales\1\s*(:\s*|(?=[,}]))/.exec(options.text);
  if (!key) return { ...fix, message: 'the expo-localization plugin entry has no supportedLocales option, so iOS Settings and Android 13+ offer no per-app language' };
  const keyIndex = options.index + key.index + key[0].indexOf('supportedLocales');
  const start = key.index + key[0].length;
  const inline = key[2].startsWith(':') ? { index: keyIndex, text: valueAt(options.text, start) } : { index: keyIndex, text: 'supportedLocales' };
  const value = followName(masked, inline, bindings);
  // Strings blanked, a spread's dots too ([...languages]), so `x.languages` is the one dotted name left out.
  const code = value.text.replace(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g, '""').replace(/\.\.\./g, '   ');
  const fromLanguages = /\breadAppLanguages\s*\(/.test(code) || [...bindings].some((name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(code));
  const want = [...languages].sort().join(',');
  const wrong = literalLists(value.text).find((list) => [...list].sort().join(',') !== want);
  if (wrong) return { index: value.index, message: `supportedLocales lists ${JSON.stringify(wrong)}, but LANGUAGES is ${JSON.stringify(languages)}` };
  if (fromLanguages || literalLists(value.text).length > 0) return null;
  return { index: value.index, message: `supportedLocales (${value.text.trim().replace(/\s+/g, ' ').slice(0, 60)}) is neither read from LANGUAGES (readAppLanguages) nor a literal list` };
}

/** Quoted catalog keys that are property values (`displayName: 'app.name'`) inside masked[from, to). */
function keyValuesIn(masked, from, to, via) {
  const found = [];
  for (const m of masked.slice(from, to).matchAll(/:\s*(['"])([^'"\n]+)\1/g)) {
    if (CATALOG_KEY.test(m[2])) found.push({ index: from + m.index + m[0].indexOf(m[1]), key: m[2], via });
  }
  return found;
}

export function configCatalogKeys(masked) {
  const found = [];
  const declared = /\bNATIVE_TEXT_KEYS\b[^=;{]*=\s*\{/.exec(masked);
  if (declared) {
    const open = declared.index + declared[0].length - 1;
    const close = findClosing(masked, open);
    if (close !== -1) found.push(...keyValuesIn(masked, open, close, 'NATIVE_TEXT_KEYS'));
  }
  for (const call of masked.matchAll(/\bnativeLocales\s*\(/g)) {
    const open = call.index + call[0].length - 1;
    const close = findClosing(masked, open);
    const second = close === -1 ? null : /^[^,]*,\s*\{/.exec(masked.slice(open + 1, close));
    if (second) {
      const objectOpen = open + 1 + second[0].length - 1;
      found.push(...keyValuesIn(masked, objectOpen, findClosing(masked, objectOpen), 'nativeLocales()'));
    }
  }
  for (const m of masked.matchAll(/\bsourceText\s*\(\s*[^,()]+,\s*(['"])([^'"\n]+)\1/g)) {
    found.push({ index: m.index, key: m[2], via: 'sourceText()' });
  }
  return found;
}
