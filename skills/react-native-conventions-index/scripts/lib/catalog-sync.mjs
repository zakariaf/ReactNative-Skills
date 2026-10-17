// catalog-sync.mjs: the index keeps a snapshot of the library catalogue (categories, and each skill's
// category, plugin and manual flag) in assets/index.json, so an installed copy works without the
// library. In the library, the catalogue file is the one source: these helpers
// read it and list every difference from the snapshot. Not an entry point.

import { readFileSync } from 'node:fs';

import { fail } from '../check-lib.mjs';
import { catalogSnapshot } from './index-model.mjs';

/** The catalogue file reduced to the snapshot shape; a malformed file is bad input (exit 2). */
export function readCatalogFile(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`catalogue ${path} is not valid JSON (${error.message})`, 'Fix the catalogue file.');
  }
  const ok = Array.isArray(raw?.categories) && raw.categories.every((c) => typeof c?.key === 'string' && typeof c?.label === 'string') && Array.isArray(raw?.skills) && raw.skills.every((s) => typeof s?.name === 'string' && typeof s?.category === 'string' && typeof s?.plugin === 'string');
  if (!ok) fail(`catalogue ${path} needs "categories" [{ key, label }] and "skills" [{ name, category, plugin, manual? }]`, 'Pass the library catalogue file.');
  return catalogSnapshot(raw);
}

/** Every difference between the snapshot in the index data and the catalogue, one sentence each. */
export function catalogDrift(data, catalog) {
  const out = [];
  const snapshot = catalogSnapshot(data.catalog);
  const labels = (list) => list.map((category) => `${category.key}=${category.label}`).join(', ');
  if (labels(snapshot.categories) !== labels(catalog.categories)) out.push(`the categories differ: the index has [${labels(snapshot.categories)}], the catalogue [${labels(catalog.categories)}]`);
  const mine = new Map(snapshot.skills.map((skill) => [skill.name, skill]));
  const theirs = new Map(catalog.skills.map((skill) => [skill.name, skill]));
  for (const skill of catalog.skills) {
    const entry = mine.get(skill.name);
    if (!entry) out.push(`the catalogue lists ${skill.name}, the index snapshot does not`);
    else for (const key of ['category', 'plugin', 'manual']) if (entry[key] !== skill[key]) out.push(`${skill.name}: ${key} is ${JSON.stringify(entry[key])} in the index, ${JSON.stringify(skill[key])} in the catalogue`);
  }
  for (const skill of snapshot.skills) if (!theirs.has(skill.name)) out.push(`the index snapshot lists ${skill.name}, the catalogue does not`);
  const order = (list) => list.filter((skill) => mine.has(skill.name) && theirs.has(skill.name)).map((skill) => skill.name).join(' ');
  if (out.length === 0 && order(snapshot.skills) !== order(catalog.skills)) out.push('the skills are in a different order than in the catalogue');
  const pluginKeys = new Set(data.plugins.map((plugin) => plugin.key));
  for (const key of new Set(catalog.skills.map((skill) => skill.plugin))) if (!pluginKeys.has(key)) out.push(`the catalogue uses the plugin "${key}", which the index's plugins list does not name`);
  return out;
}
