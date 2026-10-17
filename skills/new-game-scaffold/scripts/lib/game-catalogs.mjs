// game-catalogs.mjs: the app's message catalogs as the games see them (one flat <locale>.json per
// language, keys sorted, each game's keys under its own <game-id>. namespace), the keys a new game
// starts with, and the approved copy in contracts/copy-source.json or the "copySource" path of
// rn-skills.config.json (i18n-strings-and-catalogs owns its format:
// { strings: { key: { locale: text } }, retired: { key: why } }). Not an entry point.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isDir, readJsonFile } from './games-contract.mjs';

/** The locales of a catalogs folder: every <locale>.json in it, sorted. */
export function catalogLocales(root, catalogsDir) {
  const abs = join(root, catalogsDir);
  if (!isDir(abs)) return [];
  return readdirSync(abs)
    .filter((name) => /^[a-z]{2,3}(-[A-Za-z0-9]+)*\.json$/.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

/**
 * Reads one catalog: { rel, exists, catalog (a flat string map, {} when unreadable), text, error }.
 */
export function readCatalog(root, catalogsDir, locale) {
  const rel = `${catalogsDir}/${locale}.json`;
  const abs = join(root, rel);
  if (!existsSync(abs)) return { rel, exists: false, catalog: {}, text: '', error: null };
  const text = readFileSync(abs, 'utf8');
  const { value, error } = readJsonFile(abs);
  if (error) return { rel, exists: true, catalog: {}, text, error: `is not valid JSON: ${error}` };
  const isFlat = value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'string');
  if (!isFlat) return { rel, exists: true, catalog: {}, text, error: 'is not a flat JSON object of strings' };
  return { rel, exists: true, catalog: value, text, error: null };
}

/** "out-of-moves" -> "Out of moves": a readable first draft of a lose text. */
export function sentenceOf(slug) {
  const words = slug.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The keys every game starts with: its name and one text per declared way of losing. */
export function frameKeys(entry) {
  return [
    { key: `${entry.id}.name`, text: entry.name },
    ...entry.loseReasons.map((reason) => ({ key: `${entry.id}.lose.${reason}`, text: sentenceOf(reason) })),
  ];
}

/** The approved copy (games.copySource: "copySource" in rn-skills.config.json, else <contractsDir>/copy-source.json): { exists, strings, retired, error }. */
export function readCopySource(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return { rel, exists: false, strings: {}, retired: {}, error: null };
  const { value, error } = readJsonFile(abs);
  if (error || value === null || typeof value !== 'object') return { rel, exists: true, strings: {}, retired: {}, error: error ?? 'is not a JSON object' };
  const strings = value.strings !== null && typeof value.strings === 'object' ? value.strings : {};
  const retired = value.retired !== null && typeof value.retired === 'object' ? value.retired : {};
  return { rel, exists: true, strings, retired, error: null, text: readFileSync(abs, 'utf8') };
}

/** The keys of a game's namespace in a catalog, sorted. */
export function namespaceKeys(catalog, gameId) {
  return Object.keys(catalog)
    .filter((key) => key.startsWith(`${gameId}.`))
    .sort();
}

/**
 * The texts a new game's catalogs get: the frame keys in every locale (the display name and the
 * lose drafts), every <id>.* text of the approved copy in its own locale (the copy wins), as
 * { locale: { key: text } }.
 */
export function plannedTexts(entry, locales, copy) {
  const out = {};
  for (const locale of locales) {
    const texts = {};
    for (const { key, text } of frameKeys(entry)) texts[key] = text;
    for (const [key, row] of Object.entries(copy.strings)) {
      if (key.startsWith(`${entry.id}.`) && row !== null && typeof row === 'object' && typeof row[locale] === 'string') texts[key] = row[locale];
    }
    out[locale] = texts;
  }
  return out;
}
