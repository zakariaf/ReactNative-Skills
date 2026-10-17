// lib/feature-app.mjs: facts about the app that both scaffold-feature.mjs and check-feature.mjs read:
// the starter screen a freshly bootstrapped app ships (expo-project-bootstrap), and the app's source
// language (i18n-strings-and-catalogs' languages.ts). Zero dependencies (node: built-ins only).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { walk } from '../check-lib.mjs';

/**
 * expo-project-bootstrap's starter route and screen say in their header comment that the first real
 * feature replaces them: "The first real feature (scaffold-feature-screen) replaces this route ...".
 * Only the first lines are read, so a later comment that mentions the skill does not count.
 */
const STARTER_MARKER = /scaffold-feature-screen\)? replaces\b/;
const STARTER_HEAD_LINES = 8;
const CODE_FILE = /\.(tsx?|jsx?)$/;

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

/** True when a source file is the bootstrap starter (its header names this skill as its replacement). */
export function isStarterSource(source) {
  return source !== null && STARTER_MARKER.test(source.split('\n').slice(0, STARTER_HEAD_LINES).join('\n'));
}

/**
 * The starter files still in the app: { routes: ['src/app/index.tsx'], features: ['src/features/home'] }
 * (repo-relative). Empty lists in an app that has replaced the starter.
 */
export function findStarter(root, layout) {
  const routes = [];
  if (isDir(join(root, layout.routesDir))) {
    for (const rel of walk(join(root, layout.routesDir), { pruneDirsContaining: ['SKILL.md'] })) {
      if (!CODE_FILE.test(rel)) continue;
      if (isStarterSource(readFileSync(join(root, layout.routesDir, rel), 'utf8'))) routes.push(`${layout.routesDir}/${rel}`);
    }
  }
  const features = [];
  if (isDir(join(root, layout.featuresDir))) {
    for (const name of readdirSync(join(root, layout.featuresDir)).sort()) {
      const screen = join(root, layout.featuresDir, name, `${name}-screen.tsx`);
      if (existsSync(screen) && isStarterSource(readFileSync(screen, 'utf8'))) features.push(`${layout.featuresDir}/${name}`);
    }
  }
  return { routes, features, all: [...routes, ...features.map((dir) => `${dir}/`)] };
}

const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * The app's source language: the option, else SOURCE_LANGUAGE in <i18nDir>/languages.ts, else the
 * first entry of its LANGUAGES list, else en. Returns { language, from } (from names where it came
 * from, for the plan line).
 */
export function sourceLanguageOf(root, layout, given) {
  if (given !== undefined) return { language: given, from: '--source-language' };
  const file = `${layout.i18nDir}/languages.ts`;
  if (existsSync(join(root, file))) {
    const text = readFileSync(join(root, file), 'utf8');
    const declared = /export\s+const\s+SOURCE_LANGUAGE\s*(?::[^=]+)?=\s*['"]([^'"]+)['"]/.exec(text)?.[1];
    if (declared !== undefined && LANGUAGE_TAG.test(declared)) return { language: declared, from: `${file} SOURCE_LANGUAGE` };
    const first = /export\s+const\s+LANGUAGES\s*(?::[^=]+)?=\s*\[\s*['"]([^'"]+)['"]/.exec(text)?.[1];
    if (first !== undefined && LANGUAGE_TAG.test(first)) return { language: first, from: `${file} LANGUAGES[0]` };
  }
  return { language: 'en', from: 'default' };
}

/** A usable --source-language value, or null. */
export function isLanguageTag(value) {
  return typeof value === 'string' && LANGUAGE_TAG.test(value);
}
