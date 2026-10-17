// design-contract.mjs: reads contracts/design-system.json (the app's design-system facts), checks
// its shape, and resolves the module paths every checker uses. Paths default to the canonical layout
// (resolveLayout: src/theme, src/ui, contracts) and a contract "files" entry overrides one of them.

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError, fail, parseJsonc } from '../check-lib.mjs';

export const CONTRACT_NAME = 'design-system.json';

/** Module keys -> [layout folder key, file name]. Every one is required (theme-file-missing). */
export const MODULES = {
  themeTypes: ['themeDir', 'theme-types.ts'],
  tokens: ['themeDir', 'tokens.ts'],
  typeStyles: ['themeDir', 'type-styles.ts'],
  motion: ['themeDir', 'motion.ts'],
  fonts: ['themeDir', 'fonts.ts'],
  palette: ['themeDir', 'palette.ts'],
  contrast: ['themeDir', 'contrast.ts'],
  themeSet: ['themeDir', 'theme-set.ts'],
  themeContext: ['themeDir', 'theme-context.ts'],
  useTheme: ['themeDir', 'use-theme.ts'],
  makeStyles: ['themeDir', 'make-styles.ts'],
  themeProvider: ['themeDir', 'theme-provider.tsx'],
  textLocale: ['themeDir', 'text-locale.tsx'],
  textStyle: ['themeDir', 'use-text-style.ts'],
  shadowStyles: ['themeDir', 'shadow-styles.ts'],
  appText: ['uiDir', 'app-text.tsx'],
  balancedWrap: ['uiDir', 'use-balanced-wrap.ts'],
  pressSurface: ['uiDir', 'pressable-surface.tsx'],
  pressFeedback: ['uiDir', 'press-feedback-context.tsx'],
};

/** How a bundled weight is picked: its own family per file (the default), or one family name plus fontWeight (Expo's object syntax). */
export const WEIGHT_BY = ['family', 'fontWeight'];

/** The contract's "fonts" value for the platform's own font (the default): nothing bundled, no font rules. */
export const SYSTEM_FONT = 'system';

/**
 * The contract's bundled-font spec ({ dir, files, licences, weightBy? }), or null when the app draws
 * with the system font ("fonts": "system"). Only a bundled spec switches the font-files, font-plugin,
 * font-family and no-font-weight rules on.
 */
export function bundledFonts(contract) {
  const fonts = contract?.fonts;
  return fonts !== null && typeof fonts === 'object' && Array.isArray(fonts.files) && fonts.files.length > 0 ? fonts : null;
}

/** The contract's weight selection: 'family' unless the app chose Expo's object syntax. */
export function weightByOf(contract) {
  return bundledFonts(contract)?.weightBy ?? 'family';
}

const TOP_KEYS = new Set(['$schema', 'tokens', 'exports', 'palettes', 'invariantFields', 'files', 'text', 'fonts', 'rawValues']);

/** Styling systems whose apps keep tokens elsewhere: with one of them and no theme folder, the checks do not apply. */
export const OTHER_STYLING_PACKAGES = ['nativewind', 'tamagui', '@tamagui/core', '@shopify/restyle', 'react-native-unistyles', 'styled-components', '@gluestack-ui/themed'];

function isRepoPath(value) {
  return typeof value === 'string' && value.trim() !== '' && !value.startsWith('/') && !value.split(/[\\/]/).includes('..');
}

/**
 * "fonts" is a declaration the contract always makes: "system" (the platform's font, the default)
 * or the bundled files. A missing key, null or an empty list would leave a reader guessing whether
 * the app chose the system font or never filled the contract in, so each is refused with the two
 * spellings.
 */
function fontsErrors(fonts) {
  const spellings = `"${SYSTEM_FONT}" (the platform's font, nothing bundled) or { "dir", "files", "licences" } (bundled font files)`;
  if (fonts === undefined) return [`"fonts" is missing: declare ${spellings}`];
  if (fonts === SYSTEM_FONT) return [];
  if (fonts === null || typeof fonts !== 'object' || Array.isArray(fonts)) return [`"fonts" is ${JSON.stringify(fonts)}: it must be ${spellings}`];
  const errors = [];
  const need = (condition, message) => {
    if (!condition) errors.push(message);
  };
  need(isRepoPath(fonts.dir) && Array.isArray(fonts.files) && fonts.licences && typeof fonts.licences === 'object' && !Array.isArray(fonts.licences), `bundled "fonts" needs "dir", "files" and "licences" (or "${SYSTEM_FONT}" when the app uses the platform's font)`);
  need(!Array.isArray(fonts.files) || fonts.files.length > 0, `"fonts.files" is empty, so nothing is bundled: write "fonts": "${SYSTEM_FONT}"`);
  need(fonts.weightBy === undefined || WEIGHT_BY.includes(fonts.weightBy), `"fonts.weightBy" must be ${WEIGHT_BY.map((value) => `"${value}"`).join(' or ')}`);
  for (const [i, entry] of (Array.isArray(fonts.files) ? fonts.files : []).entries()) {
    need(typeof entry?.file === 'string' && typeof entry?.family === 'string' && typeof entry?.sha256 === 'string', `fonts.files[${i}] needs "file", "family" and "sha256"`);
  }
  return errors;
}

function shapeErrors(contract) {
  const errors = [];
  const need = (condition, message) => {
    if (!condition) errors.push(message);
  };
  for (const key of Object.keys(contract)) need(TOP_KEYS.has(key), `unknown key "${key}"`);
  need(isRepoPath(contract.tokens), '"tokens" must be a repo-relative path');
  need(Array.isArray(contract.exports), '"exports" must be a list');
  for (const [i, entry] of (Array.isArray(contract.exports) ? contract.exports : []).entries()) {
    need(isRepoPath(entry?.file) && typeof entry?.name === 'string' && typeof entry?.token === 'string', `exports[${i}] needs "file", "name" and "token"`);
  }
  need(Array.isArray(contract.palettes) && contract.palettes.length > 0, '"palettes" must list at least one palette');
  for (const [i, entry] of (Array.isArray(contract.palettes) ? contract.palettes : []).entries()) {
    need(isRepoPath(entry?.file) && typeof entry?.export === 'string' && typeof entry?.token === 'string', `palettes[${i}] needs "file", "export" and "token"`);
  }
  errors.push(...fontsErrors(contract.fonts));
  const policy = contract.rawValues?.policy;
  if (policy !== undefined) need(policy.maxRadius === undefined || policy.maxRadius === null || typeof policy.maxRadius === 'number', '"rawValues.policy.maxRadius" must be a number or null');
  return errors;
}

/**
 * The contract at <contractsDir>/design-system.json (or `given`), or null when the file is missing.
 * A file that is not JSON, or has the wrong shape, is bad input (exit 2).
 */
export function readContract(root, layout, given) {
  const rel = given ?? posix.join(layout.contractsDir, CONTRACT_NAME);
  const abs = join(root, rel);
  if (!existsSync(abs)) return { rel, contract: null };
  let contract;
  try {
    contract = parseJsonc(readFileSync(abs, 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, 'Fix the syntax (copy the shape of templates/contracts/design-system.json).');
  }
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) fail(`${rel} must hold a JSON object`, 'Copy templates/contracts/design-system.json and edit it.');
  const errors = shapeErrors(contract);
  if (errors.length > 0) fail(`${rel}: ${errors.join('; ')}`, 'Match the schema in templates/contracts/design-system.schema.json.');
  return { rel, contract };
}

/** { key: repo-relative path } for every module, with the contract's "files" overrides. */
export function modulePaths(layout, contract) {
  const out = {};
  for (const [key, [dirKey, name]] of Object.entries(MODULES)) out[key] = posix.join(layout[dirKey], name);
  for (const [key, value] of Object.entries(contract?.files ?? {})) if (isRepoPath(value)) out[key] = value;
  return out;
}

/** The first styling package in package.json, or null. */
export function otherStylingPackage(root) {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return null;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  return OTHER_STYLING_PACKAGES.find((name) => Object.hasOwn(deps, name)) ?? null;
}
