// lib/web-target.mjs: the facts both web-support checkers read (a helper of this skill, not synced):
// the app config (platforms, web.output), whether the web is a target, and contracts/web.json.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, lineOf, parseJsonc } from '../check-lib.mjs';
import { matchBracket, scanSource } from './source-scan.mjs';

export const CONTRACT_KEYS = new Set(['$schema', '$comment', 'version', 'output', 'host', 'headersFile', 'smokeRoutes', 'smokeLanguage', 'clientRoutes', 'publishSourceMaps', 'nativeOnlyPackages']);
export const OUTPUTS = ['single', 'static', 'server'];
export const HOSTS = ['eas-hosting', 'static-host', 'custom-server'];

export const readJson = (path, what) => {
  try {
    return parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${what} is not valid JSON: ${error.message}`, `Fix the JSON in ${what}.`);
  }
};
export const read = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);

/** { file, text, json } of the app config, or null. app.config.ts/js wins over app.json, as in Expo. */
export function readAppConfig(root) {
  for (const file of ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs']) {
    const text = read(root, file);
    if (text !== null) return { file, text, json: null };
  }
  const text = read(root, 'app.json');
  return text === null ? null : { file: 'app.json', text, json: readJson(join(root, 'app.json'), 'app.json') };
}

/** The `platforms` list of the app config, or null when it is not set. */
export function platformsOf(config) {
  if (config.json) {
    const list = (config.json.expo ?? config.json).platforms;
    return Array.isArray(list) ? list : null;
  }
  const { codeKeep } = scanSource(config.text);
  const match = /(?<![\w$.])['"]?platforms['"]?\s*:\s*\[([^\]]*)\]/.exec(codeKeep);
  return match ? [...match[1].matchAll(/['"]([a-z]+)['"]/g)].map((m) => m[1]) : null;
}

/** { value, line } of web.output in the app config; value null when it is not set. */
export function webOutputOf(config) {
  if (config.json) {
    const value = (config.json.expo ?? config.json).web?.output ?? null;
    const index = config.text.search(/"output"\s*:/);
    return { value, line: index === -1 ? 1 : lineOf(config.text, index) };
  }
  const scan = scanSource(config.text);
  const webKey = /(?<![\w$.])['"]?web['"]?\s*:\s*\{/g;
  for (const match of scan.codeKeep.matchAll(webKey)) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(scan.code, open);
    if (close === -1) continue;
    const block = scan.codeKeep.slice(open, close);
    const output = /(?<![\w$.])['"]?output['"]?\s*:\s*['"]([a-z]+)['"]/.exec(block);
    return { value: output ? output[1] : null, line: lineOf(config.text, output ? open + output.index : match.index) };
  }
  return { value: null, line: 1 };
}

/** null when the web is a target, else the repo fact that proves it is not (for NOT APPLICABLE). */
export function notWebTargetReason(deps, appConfig) {
  if (!deps['react-native'] && !deps.expo) return 'react-native is not in package.json';
  const platforms = appConfig ? platformsOf(appConfig) : null;
  if (platforms && !platforms.includes('web')) return `the app config platforms (${platforms.join(', ')}) leave out web`;
  if (!platforms && !deps['react-dom']) return 'the app ships no web build: react-dom is not in package.json and the app config sets no platforms';
  return null;
}

export function contractProblems(contract, file, report) {
  const add = (message, fix) => report.problem({ file, line: 1, rule: 'web-contract', message, fix });
  for (const key of Object.keys(contract)) {
    if (!CONTRACT_KEYS.has(key)) throw new UsageError(`${file} has an unknown key "${key}"`, `Use only ${[...CONTRACT_KEYS].join(', ')} (templates/contracts/web.schema.json).`);
  }
  if (contract.version !== 1) add('version must be 1', 'Set "version": 1.');
  if (!OUTPUTS.includes(contract.output)) add(`output must be one of ${OUTPUTS.join(', ')}`, 'Set "output" to the app config web.output.');
  if (!HOSTS.includes(contract.host)) add(`host must be one of ${HOSTS.join(', ')}`, 'Say where the deployed site gets its headers.');
  if (contract.host === 'custom-server' && typeof contract.headersFile !== 'string') add('host custom-server needs headersFile', 'Name the server configuration file that sets the response headers.');
  const routes = contract.smokeRoutes;
  if (!Array.isArray(routes) || routes.length === 0 || routes.some((r) => typeof r?.path !== 'string' || !r.path.startsWith('/') || typeof r?.testID !== 'string' || r.testID === '')) {
    add('smokeRoutes must list at least one { "path": "/...", "testID": "..." }', 'Add the home route and the testID its screen renders.');
  }
  const language = contract.smokeLanguage;
  if (language !== undefined && (typeof language !== 'object' || language === null || typeof language.lang !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language.lang) || !['ltr', 'rtl'].includes(language.dir) || Object.keys(language).some((k) => k !== 'lang' && k !== 'dir'))) {
    add('smokeLanguage must be { "lang": "<language tag>", "dir": "ltr" | "rtl" }', 'For example { "lang": "ar", "dir": "rtl" }, or remove it when the app has one language.');
  }
  for (const key of ['clientRoutes', 'nativeOnlyPackages']) {
    if (contract[key] !== undefined && (!Array.isArray(contract[key]) || contract[key].some((v) => typeof v !== 'string'))) add(`${key} must be a list of strings`, `Fix ${key}.`);
  }
  if (contract.publishSourceMaps !== undefined && typeof contract.publishSourceMaps !== 'boolean') add('publishSourceMaps must be true or false', 'Fix publishSourceMaps.');
}
