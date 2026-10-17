// catalogue.mjs: loads, validates, searches and renders the known-failures catalogue
// (assets/known-failures/index.json plus one <area>.json per area). The area references in
// references/ are rendered from it, so the JSON files are the one place an entry is written.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail } from '../check-lib.mjs';

export const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_CATALOGUE = join(SKILL_DIR, 'assets', 'known-failures');
export const DEFAULT_REFERENCES = join(SKILL_DIR, 'references');
export const DEFAULT_QUERIES = join(SKILL_DIR, 'assets', 'known-queries.tsv');
export const INDEX_FILE = 'index.json';
export const CATALOGUE_VERSION = 2;
export const STATUSES = ['verified', 'documented', 'open'];
export const PLATFORMS = ['ios', 'android'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_FIELDS = ['topic', 'symptom', 'cause', 'fix'];
const ENTRY_KEYS = ['id', 'topic', 'symptom', 'cause', 'fix', 'match', 'status', 'needsHuman', 'skill', 'platforms', 'appliesTo'];

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${what} ${path} is not valid JSON (${error.message})`, 'Fix the JSON syntax (one object per entry in "entries").');
  }
  return null;
}

/**
 * Loads the catalogue folder (or its index.json). Returns { dir, index, files, entries } where every
 * entry carries its area and the file it came from. A missing folder or unreadable JSON is exit 2;
 * structural problems are left to validateCatalogue.
 */
export function loadCatalogue(path) {
  if (!existsSync(path)) fail(`nothing to check: catalogue ${path} does not exist`, 'Pass --catalogue <folder holding index.json and one <area>.json per area>.');
  const dir = statSync(path).isDirectory() ? path : dirname(path);
  const indexPath = join(dir, INDEX_FILE);
  if (!existsSync(indexPath)) fail(`nothing to check: ${indexPath} does not exist`, 'The catalogue folder holds index.json (version, areas, skills) and one <area>.json per area.');
  const index = readJson(indexPath, 'catalogue index');
  const areas = index && typeof index.areas === 'object' && index.areas !== null ? index.areas : {};
  const files = [];
  const entries = [];
  for (const areaId of Object.keys(areas)) {
    const file = `${areaId}.json`;
    const full = join(dir, file);
    if (!existsSync(full)) {
      files.push({ area: areaId, file, missing: true });
      continue;
    }
    const data = readJson(full, 'catalogue area file');
    files.push({ area: areaId, file, data });
    const list = Array.isArray(data?.entries) ? data.entries : [];
    list.forEach((entry, position) => entries.push({ entry, area: areaId, file, position }));
  }
  return { dir, index, files, entries };
}

/** The entries as plain objects with their area, in catalogue order. */
export function entriesOf(catalogue) {
  return catalogue.entries.filter(({ entry }) => typeof entry === 'object' && entry !== null).map(({ entry, area }) => ({ ...entry, area }));
}

// ---------------------------------------------------------------------------------------------
// Versions: the subset of semver ranges an entry's appliesTo uses
// ---------------------------------------------------------------------------------------------

/** "57.0.27" -> [57, 0, 27]; "57", "57.x" -> [57] (a prefix); null when not a version. */
export function parseVersion(text) {
  const match = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:[-+].*)?$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const parts = [];
  for (const piece of match.slice(1)) {
    if (piece === undefined || piece === 'x' || piece === '*') break;
    parts.push(Number(piece));
  }
  return parts;
}

const full = (parts) => [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const bump = (parts) => (parts.length === 1 ? [parts[0] + 1, 0, 0] : parts.length === 2 ? [parts[0], parts[1] + 1, 0] : [parts[0], parts[1], parts[2] + 1]);

function comparatorHolds(version, token) {
  const match = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token);
  const parts = parseVersion(match?.[2]);
  if (!parts || parts.length === 0) return null;
  const lo = full(parts);
  const op = match[1] ?? '';
  if (op === '>=') return compare(version, lo) >= 0;
  if (op === '>') return compare(version, full(bump(parts))) >= 0 || (parts.length === 3 && compare(version, lo) > 0);
  if (op === '<') return compare(version, lo) < 0;
  if (op === '<=') return compare(version, full(bump(parts))) < 0;
  if (op === '^') {
    const hi = lo[0] > 0 || parts.length === 1 ? [lo[0] + 1, 0, 0] : lo[1] > 0 || parts.length === 2 ? [0, lo[1] + 1, 0] : [0, 0, lo[2] + 1];
    return compare(version, lo) >= 0 && compare(version, hi) < 0;
  }
  if (op === '~') {
    const hi = parts.length >= 2 ? [lo[0], lo[1] + 1, 0] : [lo[0] + 1, 0, 0];
    return compare(version, lo) >= 0 && compare(version, hi) < 0;
  }
  return compare(version, lo) >= 0 && compare(version, full(bump(parts))) < 0;
}

/** true / false, or null when the range is not understood. Space-separated comparators all hold. */
export function satisfies(versionText, range) {
  const parts = parseVersion(versionText);
  if (!parts || parts.length === 0) return null;
  const version = full(parts);
  const tokens = String(range).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let holds = true;
  for (const token of tokens) {
    const result = comparatorHolds(version, token);
    if (result === null) return null;
    holds &&= result;
  }
  return holds;
}

/** The versions a repo uses: node_modules/<pkg>/package.json when installed, else package.json specs. */
export function repoVersions(root) {
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return null;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return null;
  }
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const versions = new Map();
  for (const [name, spec] of Object.entries(declared)) {
    const installed = join(root, 'node_modules', name, 'package.json');
    let version = null;
    if (existsSync(installed)) {
      try {
        version = JSON.parse(readFileSync(installed, 'utf8')).version ?? null;
      } catch {
        version = null;
      }
    }
    version ??= String(spec).replace(/^[\^~=v]+/, '');
    if (parseVersion(version)) versions.set(name, version);
  }
  return versions;
}

/** Why an entry may not apply to this repo ('react-native 0.87.0 is outside 0.86.x'), or null. */
export function appliesToMismatch(entry, versions) {
  if (!versions || !entry.appliesTo) return null;
  for (const [name, range] of Object.entries(entry.appliesTo)) {
    const version = versions.get(name);
    if (version && satisfies(version, range) === false) return `${name} ${version} is outside ${range}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'not', 'are', 'was', 'but', 'has', 'have', 'after', 'when', 'then', 'into', 'our', 'its', 'can', 'cannot', 'does', 'did', 'error', 'failed', 'fails', 'app']);

export function words(text) {
  return [...new Set(String(text).toLowerCase().split(/[^a-z0-9_.-]+/).filter((word) => word.length >= 3 && !STOP_WORDS.has(word)))];
}

const patternCache = new Map();
function compiled(pattern) {
  if (!patternCache.has(pattern)) {
    let regex = null;
    try {
      regex = new RegExp(pattern);
    } catch {
      regex = null;
    }
    patternCache.set(pattern, regex);
  }
  return patternCache.get(pattern);
}

/** The whole words of a text for keyword matching: each word, plus the parts of a hyphenated or dotted word. */
function terms(text) {
  const out = new Set();
  for (const word of words(text)) {
    const trimmed = word.replace(/^[._-]+|[._-]+$/g, '');
    if (trimmed.length >= 3) out.add(trimmed);
    for (const part of trimmed.split(/[._-]+/)) if (part.length >= 3 && !STOP_WORDS.has(part)) out.add(part);
  }
  return out;
}

/**
 * Points for one entry: 1000 when one of its error patterns matches; with keywords, the number of
 * query words that are whole words of its id, topic, symptom and cause, when that is at least two and
 * at least half. Only a pattern hit is a diagnosis; a keyword hit is a lead to confirm.
 */
export function score(entry, query, { keywords = true } = {}) {
  if ((entry.match ?? []).some((pattern) => compiled(pattern)?.test(query))) return 1000;
  if (!keywords) return 0;
  const queryWords = [...new Set(words(query).map((word) => word.replace(/^[._-]+|[._-]+$/g, '')).filter((word) => word.length >= 3))];
  const haystack = terms(`${entry.id} ${entry.topic} ${entry.symptom} ${entry.cause}`);
  const hits = queryWords.filter((word) => haystack.has(word)).length;
  return hits >= 2 && hits * 2 >= queryWords.length ? hits : 0;
}

/**
 * The matching entries, best first: pattern hits before keyword hits, more keyword hits first, and an
 * entry whose appliesTo excludes this repo's versions after the ones that apply. Ties keep catalogue order.
 * kind is 'pattern' (an error pattern matched: a diagnosis) or 'keyword' (only words matched: confirm it).
 */
export function rankEntries(entries, query, { keywords = true, versions = null } = {}) {
  return entries
    .map((entry, order) => {
      const points = score(entry, query, { keywords });
      const mismatch = appliesToMismatch(entry, versions);
      return { entry, order, points, kind: points >= 1000 ? 'pattern' : 'keyword', mismatch, rank: mismatch ? points / 2 : points };
    })
    .filter((item) => item.points > 0)
    .sort((a, b) => b.rank - a.rank || a.order - b.order);
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

function entryProblems({ entry, area, file, position }, ctx) {
  const problems = [];
  const where = `${file} entries[${position}]${typeof entry?.id === 'string' ? ` (${entry.id})` : ''}`;
  const add = (rule, message, fix) => problems.push({ file, where, rule, message, fix });
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    add('entry-shape', 'is not an object', 'Each entry is { id, topic, symptom, cause, fix, match, status, needsHuman, skill } (+ platforms, appliesTo).');
    return problems;
  }
  const unknownKeys = Object.keys(entry).filter((key) => !ENTRY_KEYS.includes(key));
  if (unknownKeys.length > 0) add('entry-shape', `unknown key ${unknownKeys.join(', ')}`, `Use only ${ENTRY_KEYS.join(', ')} (the area comes from the file).`);
  if (typeof entry.id !== 'string' || !KEBAB.test(entry.id) || !entry.id.startsWith(`${area}-`)) add('entry-id', `id "${entry.id}" is not kebab-case "${area}-<slug>"`, `Name it ${area}-<what-failed>, for example build-metro-cache-variant.`);
  for (const field of TEXT_FIELDS) {
    if (typeof entry[field] !== 'string' || entry[field].trim().length < 3) add('entry-text', `${field} is missing or empty`, 'Write the symptom as the text you see, the cause as why, and the fix as the action.');
  }
  if (!Array.isArray(entry.match)) add('entry-match', 'match is not an array of regular expressions', 'Use [] when there is no stable error text to match.');
  else {
    for (const pattern of entry.match) {
      const regex = typeof pattern === 'string' ? compiled(pattern) : null;
      if (!regex) add('entry-match', `match pattern ${JSON.stringify(pattern)} does not compile`, 'Escape backslashes twice in JSON ("\\\\d").');
      else if (pattern.length < 4 || regex.test('') || regex.test(' ')) add('entry-match-broad', `match pattern ${JSON.stringify(pattern)} matches almost any log line`, 'Use a distinctive part of the error text (at least four characters, never a pattern that matches the empty string).');
    }
  }
  if (!STATUSES.includes(entry.status)) add('entry-status', `status "${entry.status}" is not one of ${STATUSES.join(', ')}`, "verified = seen and fixed in a real run; documented = read in the tool's source or docs; open = not settled, the fix is the current fallback.");
  if (typeof entry.needsHuman !== 'boolean') add('entry-needs-human', 'needsHuman is not true or false', 'needsHuman: true when the fix needs a person (a password, a console, an agreement, a product decision): a stop.');
  if (entry.skill !== null && (typeof entry.skill !== 'string' || !KEBAB.test(entry.skill))) add('entry-skill', `skill "${entry.skill}" is not a skill name or null`, 'Name the skill that owns the full procedure, or null.');
  else if (typeof entry.skill === 'string' && ctx.skills && !ctx.skills.has(entry.skill)) add('entry-skill-unknown', `skill "${entry.skill}" is not in index.json "skills"`, 'Use the exact name of a skill in the library (index.json "skills" lists them), or null.');
  if (entry.platforms !== undefined && (!Array.isArray(entry.platforms) || entry.platforms.length === 0 || entry.platforms.some((platform) => !PLATFORMS.includes(platform)) || new Set(entry.platforms).size !== entry.platforms.length)) add('entry-platforms', `platforms ${JSON.stringify(entry.platforms)} is not a list of ${PLATFORMS.join(' / ')}`, 'Leave platforms out when the failure happens on both; otherwise ["ios"] or ["android"].');
  if (entry.appliesTo !== undefined) {
    const ranges = entry.appliesTo;
    const bad = typeof ranges !== 'object' || ranges === null || Array.isArray(ranges) || Object.keys(ranges).length === 0 || Object.entries(ranges).some(([name, range]) => !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name) || typeof range !== 'string' || satisfies('1.0.0', range) === null);
    if (bad) add('entry-applies-to', `appliesTo ${JSON.stringify(ranges)} is not { "<package>": "<range>" }`, 'Use package names and simple ranges ("57.x", ">=4.5 <5", "^1.2.0", "~57.0.3").');
  }
  const text = TEXT_FIELDS.map((field) => entry[field] ?? '').join('\n');
  for (const term of ctx.bannedTerms) {
    const hit = term.regex.exec(text);
    if (hit) add('entry-banned-term', `contains "${hit[0]}" (${term.why})`, 'Write the entry for any React Native app: generic nouns, the house vocabulary, no private paths.');
  }
  return problems;
}

function indexProblems(catalogue) {
  const problems = [];
  const add = (where, message, fix) => problems.push({ file: INDEX_FILE, where, rule: 'catalogue-shape', message, fix });
  const index = catalogue.index;
  if (index?.version !== CATALOGUE_VERSION) add('version', `version is not ${CATALOGUE_VERSION}`, `Keep "version": ${CATALOGUE_VERSION}.`);
  if (!DATE.test(index?.reviewedOn ?? '')) add('reviewedOn', 'reviewedOn is not a YYYY-MM-DD date', 'Set the date the catalogue was last reviewed against the stack.');
  const areas = index?.areas && typeof index.areas === 'object' ? index.areas : {};
  if (Object.keys(areas).length === 0) add('areas', 'no areas', 'Add "areas": { "<id>": { "title", "file", "intro", "reverify" } }.');
  const referenceFiles = new Set();
  for (const [id, area] of Object.entries(areas)) {
    if (!KEBAB.test(id) || typeof area?.title !== 'string' || typeof area?.intro !== 'string' || typeof area?.reverify !== 'string' || !/^references\/[a-z0-9-]+\.md$/.test(area?.file ?? '')) {
      add(`areas.${id}`, 'needs a kebab id, a title, an intro, a reverify command and a file references/<name>.md', 'Complete the area object.');
    } else if (referenceFiles.has(area.file)) add(`areas.${id}`, `file ${area.file} is used by two areas`, 'Give every area its own reference file.');
    else referenceFiles.add(area.file);
  }
  if (!Array.isArray(index?.skills) || index.skills.some((name) => typeof name !== 'string' || !KEBAB.test(name))) add('skills', 'skills is not a list of skill names', 'List every skill name of the library in "skills".');
  if (index?.bannedTerms !== undefined && (!Array.isArray(index.bannedTerms) || index.bannedTerms.some((term) => typeof term?.pattern !== 'string' || compiled(term.pattern) === null || typeof term?.why !== 'string'))) add('bannedTerms', 'bannedTerms is not a list of { pattern, why } with compilable patterns', 'Fix the pattern or remove the term.');
  for (const file of catalogue.files) {
    if (file.missing) problems.push({ file: file.file, where: file.file, rule: 'catalogue-shape', message: `area ${file.area} has no file ${file.file}`, fix: `Create ${file.file} as { "area": "${file.area}", "entries": [] }.` });
    else if (file.data?.area !== file.area || !Array.isArray(file.data?.entries)) problems.push({ file: file.file, where: file.file, rule: 'catalogue-shape', message: `is not { "area": "${file.area}", "entries": [...] }`, fix: 'Fix the file: its area must equal its name.' });
  }
  if (catalogue.entries.length === 0) add('entries', 'no entries', 'Add at least one entry.');
  return problems;
}

/** Every structural problem of the catalogue as { file, where, rule, message, fix }. */
export function validateCatalogue(catalogue) {
  const problems = indexProblems(catalogue);
  const index = catalogue.index ?? {};
  const ctx = {
    skills: Array.isArray(index.skills) ? new Set(index.skills) : null,
    bannedTerms: (Array.isArray(index.bannedTerms) ? index.bannedTerms : []).filter((term) => typeof term?.pattern === 'string' && compiled(term.pattern)).map((term) => ({ regex: new RegExp(term.pattern, 'i'), why: term.why })),
  };
  const seen = new Map();
  for (const item of catalogue.entries) {
    problems.push(...entryProblems(item, ctx));
    const id = item.entry?.id;
    if (typeof id === 'string') {
      if (seen.has(id)) problems.push({ file: item.file, where: `${item.file} entries[${item.position}] (${id})`, rule: 'entry-duplicate', message: `id ${id} is also used in ${seen.get(id)}`, fix: 'Merge the two entries, or give one a more specific id.' });
      else seen.set(id, item.file);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Queries: the exact error lines the catalogue must find (assets/known-queries.tsv)
// ---------------------------------------------------------------------------------------------

/** Lines "<expected-id>\t<query>" (# comments and blank lines skipped) -> [{ line, id, query }]. */
export function readQueries(path) {
  if (!existsSync(path)) return null;
  const rows = [];
  readFileSync(path, 'utf8').split('\n').forEach((raw, index) => {
    if (raw.trim() === '' || raw.startsWith('#')) return;
    const tab = raw.indexOf('\t');
    rows.push({ line: index + 1, id: tab > 0 ? raw.slice(0, tab).trim() : '', query: tab > 0 ? raw.slice(tab + 1).trim() : raw.trim() });
  });
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** The markdown reference for one area, rendered from the catalogue. */
export function renderArea(catalogue, areaId) {
  const index = catalogue.index;
  const area = index.areas[areaId];
  const entries = entriesOf(catalogue).filter((entry) => entry.area === areaId);
  const topics = [...new Set(entries.map((entry) => entry.topic))];
  const lines = [
    `# ${area.title}`,
    '',
    `${area.intro} Match the text you see in the Symptom column, or run \`find-fix.mjs --text "<first error line>"\`.`,
    '',
    `Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on ${index.reviewedOn} against ${index.stack}; re-verify the versions with \`${area.reverify}\`.`,
    '',
    `<!-- Generated from assets/known-failures/${areaId}.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->`,
    '',
    '## Contents',
    '',
    ...topics.map((topic) => `- ${topic}`),
  ];
  for (const topic of topics) {
    lines.push('', `## ${topic}`, '', '| ID | Symptom | Cause | Fix | Status | Platform | Skill |', '|---|---|---|---|---|---|---|');
    for (const entry of entries.filter((item) => item.topic === topic)) {
      const status = entry.needsHuman ? `${entry.status}, needs a human` : entry.status;
      const applies = entry.appliesTo ? ` (${Object.entries(entry.appliesTo).map(([name, range]) => `${name} ${range}`).join(', ')})` : '';
      const platform = (entry.platforms ?? []).map((name) => (name === 'ios' ? 'iOS' : 'Android')).join(', ');
      const skill = entry.skill ? `\`${entry.skill}\`` : '';
      lines.push(`| \`${entry.id}\` | ${cell(entry.symptom)} | ${cell(entry.cause)} | ${cell(entry.fix)} | ${status}${cell(applies)} | ${platform} | ${skill} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The rendered file name of an area (references/<name>.md -> <name>.md). */
export function referenceName(catalogue, areaId) {
  return basename(catalogue.index.areas[areaId].file);
}
