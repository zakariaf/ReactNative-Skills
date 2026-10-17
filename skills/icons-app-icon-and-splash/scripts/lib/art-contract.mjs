// art-contract.mjs: reads the app's contracts/app-art.json for the checkers, with the same defaults and
// the same strictness as the app's own reader (templates/scripts/art/app-art-contract.ts): where every
// rendered image lives, which images may be absent, how much of an iOS icon the mark covers, and the
// icon checker's allow-lists. A malformed contract is bad input (exit 2), never a silent default.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail, toPosix } from '../check-lib.mjs';

export const CONTRACT_FILE = 'app-art.json';

/** Every image the art pipeline knows, at the paths app-variants-and-environment's config reads. */
export const DEFAULT_OUTPUTS = Object.freeze({
  light: 'assets/icons/production/icon.png',
  dark: 'assets/icons/production/icon-dark.png',
  tinted: 'assets/icons/production/icon-tinted.png',
  androidForeground: 'assets/icons/production/android-foreground.png',
  androidBackground: 'assets/icons/production/android-background.png',
  androidMonochrome: 'assets/icons/production/android-monochrome.png',
  splash: 'assets/images/splash-icon.png',
  splashDark: 'assets/images/splash-icon-dark.png',
  playIcon: 'assets/store/play-icon.png',
  featureGraphic: 'assets/store/feature-graphic.png',
});

export const DEFAULT_OPTIONAL = Object.freeze(['featureGraphic']);
export const DEFAULT_GLYPH_AREA = 0.62;
const TOP_KEYS = ['$schema', '$comment', 'outputs', 'optional', 'glyphArea', 'icons'];
/** The keys that describe rendered art; a contract with none of them only holds check-icons' allow-lists. */
export const ART_KEYS = Object.freeze(['outputs', 'optional', 'glyphArea']);
const ICON_KEYS = ['allowImages', 'allowPackages'];
const FIX = 'Start from the skill\'s templates/contracts/app-art.json and its schema (every key is optional).';

function isRepoPath(value) {
  return typeof value === 'string' && value !== '' && !value.startsWith('/') && !value.split('/').includes('..') && !/\s/.test(value);
}

function stringList(rel, key, value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) fail(`${rel} "${key}" must be a list of strings`, FIX);
  return [...value];
}

/**
 * The contract of the app at `root` (contractsDir from resolveLayout), defaults filled in:
 * { file, exists, declaresArt, outputs, optional, glyphArea, allowImages, allowPackages }. `declaresArt` is
 * true when the file holds one of ART_KEYS: the app renders its icon and splash in code. A contract
 * holding only `icons` (check-icons' allow-lists) does not adopt the art pipeline.
 */
export function readArtContract(root, contractsDir, given) {
  const rel = toPosix(given ?? join(contractsDir, CONTRACT_FILE));
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    if (given) fail(`contract ${rel} does not exist`, 'Pass an existing file to --contract, or leave it out to read contracts/app-art.json.');
    return { file: rel, exists: false, declaresArt: false, outputs: { ...DEFAULT_OUTPUTS }, optional: [...DEFAULT_OPTIONAL], glyphArea: DEFAULT_GLYPH_AREA, allowImages: [], allowPackages: [] };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    fail(`${rel} is not valid JSON: ${error.message}`, FIX);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) fail(`${rel} must hold one JSON object`, FIX);
  for (const key of Object.keys(data)) if (!TOP_KEYS.includes(key)) fail(`${rel} has an unknown key "${key}"`, `Use only: ${TOP_KEYS.join(', ')}.`);
  const outputs = { ...DEFAULT_OUTPUTS };
  if (data.outputs !== undefined) {
    if (data.outputs === null || typeof data.outputs !== 'object' || Array.isArray(data.outputs)) fail(`${rel} "outputs" must be an object`, FIX);
    for (const [key, path] of Object.entries(data.outputs)) {
      if (!(key in DEFAULT_OUTPUTS)) fail(`${rel} "outputs.${key}" is not a known image`, `Known images: ${Object.keys(DEFAULT_OUTPUTS).join(', ')}.`);
      if (!isRepoPath(path) || !path.endsWith('.png')) fail(`${rel} "outputs.${key}" must be a repo-relative .png path`, FIX);
      outputs[key] = path;
    }
  }
  const optional = data.optional === undefined ? [...DEFAULT_OPTIONAL] : stringList(rel, 'optional', data.optional);
  for (const key of optional) if (!(key in DEFAULT_OUTPUTS)) fail(`${rel} "optional" names an unknown image: ${key}`, FIX);
  const glyphArea = data.glyphArea ?? DEFAULT_GLYPH_AREA;
  if (typeof glyphArea !== 'number' || glyphArea < 0.4 || glyphArea > 0.9) fail(`${rel} "glyphArea" must be a number from 0.4 to 0.9`, FIX);
  const icons = data.icons ?? {};
  if (icons === null || typeof icons !== 'object' || Array.isArray(icons)) fail(`${rel} "icons" must be an object`, FIX);
  for (const key of Object.keys(icons)) if (!ICON_KEYS.includes(key)) fail(`${rel} has an unknown key "icons.${key}"`, `Use only: ${ICON_KEYS.join(', ')}.`);
  return {
    file: rel,
    exists: true,
    declaresArt: ART_KEYS.some((key) => data[key] !== undefined),
    outputs,
    optional,
    glyphArea,
    allowImages: stringList(rel, 'icons.allowImages', icons.allowImages),
    allowPackages: stringList(rel, 'icons.allowPackages', icons.allowPackages),
  };
}
