// scaffold-plan.mjs: what the generator would write for a new game, file by file, and how each file
// compares with the repo: new (absent), same (already identical), edit (only additions: a new
// declaration entry, catalog keys the files lack) or conflict (an existing value differs). The
// generator writes additions only, so --add-missing can never change an existing value. Not an entry
// point.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { maskComments, readText } from '../check-lib.mjs';
import { PLACEHOLDER_ENTRY, renderAppSkeleton } from './app-skeleton.mjs';
import { catalogLocales, plannedTexts, readCatalog } from './game-catalogs.mjs';
import { isDir, readJsonFile } from './games-contract.mjs';
import { catalogText, jsonText } from './json-text.mjs';

/** The contract file a repo starts with (the skill's template, no game yet). */
export function startContract(template) {
  return { ...template, games: [] };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The declaration entry, keys in the documented order (the schema's). */
export function orderedEntry(entry) {
  const ordered = { id: entry.id, name: entry.name, class: entry.class, panMode: entry.panMode, levels: entry.levels, daily: entry.daily, endless: entry.endless, hints: entry.hints, continue: entry.continue, loseReasons: entry.loseReasons };
  if (entry.app !== undefined) ordered.app = entry.app;
  return ordered;
}

/** contracts/games.json with the entry added: { status, content, conflicts }. */
function contractItem(games, contract, entry, template) {
  const rel = games.contract;
  if (!contract.exists) return { rel, status: 'new', content: jsonText({ ...startContract(template), games: [orderedEntry(entry)] }), conflicts: [] };
  const data = contract.data;
  const list = Array.isArray(data.games) ? data.games : [];
  const current = list.find((item) => item?.id === entry.id);
  if (current === undefined) return { rel, status: 'edit', added: `+ ${entry.id}`, content: jsonText({ ...data, games: [...list, orderedEntry(entry)] }), conflicts: [] };
  if (sameJson(orderedEntry(current), orderedEntry(entry))) return { rel, status: 'same', conflicts: [] };
  const fields = Object.keys(orderedEntry(entry)).filter((key) => !sameJson(current[key], entry[key]));
  return { rel, status: 'conflict', conflicts: [`the ${entry.id} entry differs (${fields.join(', ')})`] };
}

/** One catalog with the game's texts added: { status, content, conflicts, drafts }. */
function catalogItem(root, catalogsDir, locale, texts, drafts) {
  const read = readCatalog(root, catalogsDir, locale);
  if (read.error) return { rel: read.rel, status: 'conflict', conflicts: [`${read.error}; fix the file first`] };
  const added = {};
  const conflicts = [];
  for (const [key, text] of Object.entries(texts)) {
    if (!(key in read.catalog)) added[key] = text;
    else if (read.catalog[key] !== text) conflicts.push(`${key} has other text`);
  }
  const count = Object.keys(added).length;
  const drafted = Object.keys(added).filter((key) => drafts.has(key));
  if (!read.exists) return { rel: read.rel, status: 'new', content: catalogText(added), conflicts, drafted };
  const content = count > 0 ? catalogText({ ...read.catalog, ...added }) : null;
  return { rel: read.rel, status: count > 0 ? 'edit' : conflicts.length > 0 ? 'conflict' : 'same', added: `+ ${count} keys`, content, conflicts, drafted };
}

/** A whole file the plan writes: new, same or conflict. */
function fileItem(root, rel, content) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return { rel, status: 'new', content, conflicts: [] };
  const current = readFileSync(abs);
  const same = Buffer.isBuffer(content) ? current.equals(content) : current.toString('utf8') === content;
  return { rel, status: same ? 'same' : 'conflict', conflicts: same ? [] : ['exists with other content'] };
}

/** Dependencies of every existing app in the apps folder except `skip`, sorted by app. */
export function existingApps(root, appsDir, skip) {
  const abs = join(root, appsDir);
  if (!isDir(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((item) => item.isDirectory() && item.name !== skip && existsSync(join(abs, item.name, 'package.json')))
    .map((item) => {
      const { value } = readJsonFile(join(abs, item.name, 'package.json'));
      const dependencies = value?.dependencies ?? {};
      return { dir: `${appsDir}/${item.name}`, dependencies: Object.fromEntries(Object.keys(dependencies).sort().map((name) => [name, dependencies[name]])) };
    })
    .sort((a, b) => (a.dir < b.dir ? -1 : 1));
}

/** The shared font files of the white-label apps: [{ name, content }] from apps.fontsDir. */
export function sharedFonts(root, apps) {
  if (typeof apps.fontsDir !== 'string') return [];
  const abs = join(root, apps.fontsDir);
  if (!isDir(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((item) => item.isFile() && !item.name.startsWith('.'))
    .map((item) => ({ name: item.name, content: readFileSync(join(abs, item.name)) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * The source locale of a set of catalogs: the --source-locale option, else "en" when present, else
 * the first. The name and lose texts are written in it; every other locale gets them as drafts.
 */
export function sourceLocaleOf(locales, option) {
  if (option !== undefined) return option;
  return locales.includes('en') ? 'en' : locales[0];
}

/** Keys of one locale whose planned text is a source-language draft (not the approved copy's). */
function draftKeys(entry, locale, source, copy) {
  if (locale === source) return new Set();
  return new Set(Object.keys(plannedTexts(entry, [locale], { strings: {} })[locale]).filter((key) => typeof copy.strings[key]?.[locale] !== 'string'));
}

/**
 * The plan for one game: [{ rel, status, content?, added?, conflicts, drafted? }]. A catalog item's
 * `drafted` lists the keys it receives in the source language (translations for the review queue).
 * input = { games, contract, entry, copy, schemaText, contractTemplate, sourceLocale, appMode: { apps, appDir, appCatalogsDir, dependencies, names } | null }
 */
export function buildPlan(input) {
  const { games, contract, entry, copy, appMode } = input;
  const items = [contractItem(games, contract, entry, input.contractTemplate)];
  const schemaRel = `${games.contract.replace(/[^/]+$/, '')}games.schema.json`;
  items.push(fileItem(games.root, schemaRel, input.schemaText));
  if (appMode === null) {
    const locales = catalogLocales(games.root, games.catalogsDir);
    const texts = plannedTexts(entry, locales, copy);
    const source = sourceLocaleOf(locales, input.sourceLocale);
    for (const locale of locales) items.push(catalogItem(games.root, games.catalogsDir, locale, texts[locale], draftKeys(entry, locale, source, copy)));
    return items;
  }
  const { apps, appDir, appCatalogsDir, dependencies, names } = appMode;
  // An app already on its real root ("main": "expo-router/entry", or an index.ts that imports
  // expo-router/entry after the polyfills) never gets the placeholder entry back or listed as kept.
  const { value: manifest } = existsSync(join(games.root, appDir, 'package.json')) ? readJsonFile(join(games.root, appDir, 'package.json')) : { value: null };
  const entryPath = join(games.root, appDir, PLACEHOLDER_ENTRY);
  const entryCode = existsSync(entryPath) ? maskComments(readText(entryPath) ?? '') : '';
  const onRealRoot = manifest?.main === 'expo-router/entry' || (/\bimport\s+['"]expo-router\/entry['"]/.test(entryCode) && !/\bPlaceholderApp\b/.test(entryCode));
  for (const file of renderAppSkeleton({ entry, apps, appDir, names, dependencies })) {
    if (onRealRoot && file.rel === `${appDir}/${PLACEHOLDER_ENTRY}`) continue;
    items.push(fileItem(games.root, file.rel, file.content));
  }
  const texts = plannedTexts(entry, apps.locales, copy);
  const source = sourceLocaleOf(apps.locales, input.sourceLocale);
  for (const locale of apps.locales) items.push(catalogItem(games.root, appCatalogsDir, locale, texts[locale], draftKeys(entry, locale, source, copy)));
  for (const font of sharedFonts(games.root, apps)) items.push(fileItem(games.root, `${appDir}/assets/fonts/${font.name}`, font.content));
  return items;
}
