// repo-read.mjs: small readers for the files check-skeleton.mjs inspects (JSON with comments,
// .npmrc, package manifests). Not an entry point.

import { existsSync, readFileSync } from 'node:fs';

/** Strip // and /* comments and trailing commas outside strings, then JSON.parse (tsconfig style). */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** { ok: true, value } or { ok: false, error } for a JSON (or JSONC) file. */
export function readJsonFile(abs, { jsonc = false } = {}) {
  if (!existsSync(abs)) return { ok: false, error: 'missing' };
  try {
    const text = readFileSync(abs, 'utf8');
    return { ok: true, value: jsonc ? parseJsonc(text) : JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: `not valid JSON (${error.message.split('\n')[0]})` };
  }
}

export function readTextFile(abs) {
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** 1-based line of the first line matching a regex, or 1. */
export function lineMatching(text, regex) {
  const index = text.split('\n').findIndex((line) => regex.test(line));
  return index === -1 ? 1 : index + 1;
}

/** One `key=value` line of an .npmrc as npm reads it (spaces around "=" allowed), or null. */
const NPMRC_SETTING = /^\s*([^\s=#;][^\s=]*)\s*=\s*(.*?)\s*$/;
const EXCLUDE_KEY = /^min-release-age-exclude(\[\])?$/;

/**
 * The policy lines of the canonical .npmrc (dependency-management). npm keeps the LAST value of a
 * key, so a later line can switch one off. The guards npm defaults to are written out so a user
 * config cannot switch them off.
 */
export const NPMRC_POLICY = Object.freeze({
  'min-release-age': '7',
  'engine-strict': 'true',
  'save-exact': 'true',
  'strict-allow-scripts': 'true',
  'legacy-peer-deps': 'false',
  force: 'false',
  'dangerously-allow-all-scripts': 'false',
  'package-lock': 'true',
});

/** True when a value keeps the policy (an app may hold a longer release age, never a shorter one). */
export function keepsPolicy(key, value) {
  if (key === 'min-release-age') return /^\d+$/.test(value) && Number(value) >= Number(NPMRC_POLICY[key]);
  return value === NPMRC_POLICY[key];
}

/** Lines that set a policy key to a weaker value (for example a later min-release-age=0). */
export function npmrcPolicyOverrides(text) {
  const out = [];
  text.split('\n').forEach((line, index) => {
    const setting = NPMRC_SETTING.exec(line);
    const want = setting ? NPMRC_POLICY[setting[1]] : undefined;
    if (want !== undefined && !keepsPolicy(setting[1], setting[2])) out.push({ line: index + 1, key: setting[1], value: setting[2], want });
  });
  return out;
}

/** The policy keys an .npmrc never sets (or sets only to a weaker value). */
export function npmrcMissingPolicy(text) {
  const kept = new Set();
  for (const line of text.split('\n')) {
    const setting = NPMRC_SETTING.exec(line);
    if (setting && NPMRC_POLICY[setting[1]] !== undefined && keepsPolicy(setting[1], setting[2])) kept.add(setting[1]);
  }
  return Object.keys(NPMRC_POLICY).filter((key) => !kept.has(key));
}

/**
 * Dated exclude blocks of an .npmrc: every exclude must sit in a block that has not expired. Every
 * spelling npm accepts counts as an exclude ("min-release-age-exclude[]=x", "min-release-age-exclude = x").
 */
export function npmrcExcludeProblems(text, todayIso) {
  const problems = [];
  let expires = null;
  text.split('\n').forEach((line, index) => {
    const header = /^# exclude-block expires=(\d{4}-\d{2}-\d{2}) reason=\S.*$/.exec(line);
    const setting = NPMRC_SETTING.exec(line);
    const pattern = setting && EXCLUDE_KEY.test(setting[1]) ? setting[2] : null;
    if (header) expires = header[1];
    else if (line.trim() === '') expires = null;
    else if (pattern !== null && expires === null) problems.push({ line: index + 1, pattern, kind: 'no-block' });
    else if (pattern !== null && expires < todayIso) problems.push({ line: index + 1, pattern, kind: 'expired', expires });
  });
  return problems;
}

/** Exact semver like 1.2.3 or 1.2.3-rc.1 (what save-exact writes). */
export const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
