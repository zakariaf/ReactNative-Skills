// usage-strings.mjs: the permission usage descriptions a built iOS app must carry, in Info.plist and
// in every language the app is localized into (a helper, not an entry point).
//
// iOS terminates an app that uses a protected API (tracking, camera, photos, location, ...) without
// the matching NS*UsageDescription key; Apple's text for the tracking key: "This key is required.
// Your app crashes if it attempts to use the framework without including the key". Expo writes the
// base text into Info.plist (app.config.ts ios.infoPlist, or a config plugin's permission option)
// and each locale's text into <lang>.lproj/InfoPlist.strings (app.config.ts "locales": one JSON file
// per language with an "ios" object). A built app keeps .strings files as binary plists; a
// hand-written one may be XML or the old "key" = "value"; text form.
//
//   ATT_KEY                                  'NSUserTrackingUsageDescription'
//   USAGE_KEYS                               the common NS*UsageDescription keys, with what each protects
//   appLanguages(appDir, info)               the app's languages: Info.plist CFBundleLocalizations, else
//                                            the <lang>.lproj folders of the built app (Base left out)
//   localeFiles(root, dir)                   the language codes of a repo's locale folder (<dir>/<lang>.json)
//   stringsValue(path, key, readPlist)       one key of a .strings file, or null
//   usageStringProblems(appDir, info, { keys, languages, readPlist })
//                                            [{ file, key, message }]: each key missing or empty in
//                                            Info.plist or in a language's InfoPlist.strings
//   trackingTextProblems(appDir, info, readPlist, { languages })
//                                            the tracking key only (the older call), [{ file, message }]
//
// Changed from the older tracking-text helper: the languages are the app's own (CFBundleLocalizations
// or its .lproj folders, or a list the caller passes from the repo's locale files), never a fixed list.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ATT_KEY = 'NSUserTrackingUsageDescription';

/** Common usage-description keys and the API each protects (for messages). */
export const USAGE_KEYS = Object.freeze({
  NSUserTrackingUsageDescription: 'App Tracking Transparency (the tracking prompt)',
  NSCameraUsageDescription: 'the camera',
  NSMicrophoneUsageDescription: 'the microphone',
  NSPhotoLibraryUsageDescription: 'the photo library',
  NSPhotoLibraryAddUsageDescription: 'saving to the photo library',
  NSLocationWhenInUseUsageDescription: 'location while the app is in use',
  NSLocationAlwaysAndWhenInUseUsageDescription: 'location in the background',
  NSContactsUsageDescription: 'contacts',
  NSCalendarsUsageDescription: 'calendars',
  NSRemindersUsageDescription: 'reminders',
  NSFaceIDUsageDescription: 'Face ID',
  NSBluetoothAlwaysUsageDescription: 'Bluetooth',
  NSMotionUsageDescription: 'motion and fitness data',
  NSSpeechRecognitionUsageDescription: 'speech recognition',
  NSHealthShareUsageDescription: 'reading Health data',
  NSHealthUpdateUsageDescription: 'writing Health data',
  NSLocalNetworkUsageDescription: 'the local network',
});

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

/**
 * The languages a built .app is localized into: Info.plist CFBundleLocalizations when it lists any,
 * else the <lang>.lproj folders at the app root (Base.lproj left out), sorted. [] for an app with
 * neither (then only Info.plist is checked).
 */
export function appLanguages(appDir, info = null) {
  const declared = Array.isArray(info?.CFBundleLocalizations) ? info.CFBundleLocalizations.filter((lang) => typeof lang === 'string' && lang.trim() !== '') : [];
  if (declared.length > 0) return [...new Set(declared)].sort();
  if (!isDir(appDir)) return [];
  return readdirSync(appDir)
    .filter((name) => name.endsWith('.lproj') && name !== 'Base.lproj' && isDir(join(appDir, name)))
    .map((name) => name.slice(0, -'.lproj'.length))
    .sort();
}

/** The language codes of a repo's locale folder: <dir>/<lang>.json (for example locales/ or src/i18n/catalogs/). */
export function localeFiles(root, dir) {
  const folder = join(root, dir);
  if (!isDir(folder)) return [];
  return readdirSync(folder)
    .filter((name) => /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*\.json$/.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

/** The value of `key` in a .strings file (binary or XML plist, or "key" = "value"; text), or null. */
export function stringsValue(path, key, readPlist) {
  if (!existsSync(path)) return null;
  const buffer = readFileSync(path);
  const head = buffer.subarray(0, 8).toString('latin1');
  if (head.startsWith('bplist') || head.startsWith('<?xml')) {
    const value = readPlist(path)?.[key];
    return typeof value === 'string' ? value : null;
  }
  const isUtf16 = (buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff);
  const text = isUtf16 && buffer[0] === 0xfe ? Buffer.from(buffer).swap16().toString('utf16le') : buffer.toString(isUtf16 ? 'utf16le' : 'utf8');
  const match = new RegExp(`"?${key}"?\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*;`).exec(text);
  return match ? match[1] : null;
}

/**
 * Where a usage description is missing: Info.plist (every build) and each language's
 * InfoPlist.strings. Returns [{ file, key, message }] with file relative to the .app.
 * options.keys: the keys the app needs (default [ATT_KEY]); options.languages: default
 * appLanguages(appDir, info); options.readPlist: the plist reader (lib/plist.mjs readPlist).
 */
export function usageStringProblems(appDir, info, { keys = [ATT_KEY], languages = null, readPlist } = {}) {
  if (typeof readPlist !== 'function') throw new Error('usageStringProblems needs readPlist (from lib/plist.mjs)');
  const problems = [];
  const langs = languages ?? appLanguages(appDir, info);
  for (const key of keys) {
    const what = USAGE_KEYS[key] ?? key;
    const text = info?.[key];
    if (typeof text !== 'string' || text.trim() === '') problems.push({ file: 'Info.plist', key, message: `${key} is missing or empty, so using ${what} would crash the app` });
    for (const lang of langs) {
      const file = `${lang}.lproj/InfoPlist.strings`;
      const path = join(appDir, file);
      const value = stringsValue(path, key, readPlist);
      if (value === null || value.trim() === '') problems.push({ file, key, message: existsSync(path) ? `has no ${key} (the ${lang} text for ${what})` : `is missing, so there is no ${lang} text for ${what} (${key})` });
    }
  }
  return problems;
}

/**
 * The tracking text only (the older call): Info.plist and each language's InfoPlist.strings.
 * Returns [{ file, message }]. options.languages: default appLanguages(appDir, info).
 */
export function trackingTextProblems(appDir, info, readPlist, { languages = null } = {}) {
  const problems = [];
  const text = info?.[ATT_KEY];
  if (typeof text !== 'string' || text.trim() === '') problems.push({ file: 'Info.plist', message: `${ATT_KEY} is missing or empty, so the tracking prompt would crash the app` });
  for (const lang of languages ?? appLanguages(appDir, info)) {
    const file = `${lang}.lproj/InfoPlist.strings`;
    const path = join(appDir, file);
    const value = stringsValue(path, ATT_KEY, readPlist);
    if (value === null || value.trim() === '') problems.push({ file, message: existsSync(path) ? `has no ${ATT_KEY} (the ${lang} tracking prompt text)` : `is missing, so there is no ${lang} tracking prompt text (${ATT_KEY})` });
  }
  return problems;
}
