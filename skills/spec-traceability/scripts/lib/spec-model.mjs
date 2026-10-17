// spec-model.mjs: reads the app's requirement spec and its ID scheme (shared by spec-lookup.mjs and
// check-spec-refs.mjs).
//
// The spec is a folder of markdown files in the app repo (default docs/spec/). Every entry is a heading
// "<#...> <ID> · <title>" (the separator may also be an em dash, an en dash, " - " or ":"), where ID is
// a configured prefix plus a number (REQ-4, REQ-4.1, SCR-2, NN-1, DEC-3, OOS-2) or, when the spec
// numbers its sections, a section number (4, 4.2). The entry's text runs until the next heading of the
// same or a higher level; its fields ("- Status: built", "- Default: 5 seconds") are the "Name: value"
// lines of its own body, before the first sub-heading.
// The ID scheme comes from contracts/spec.json (contract keys: see the skill's references/spec-format.md;
// rn-skills.config.json "specContract" moves it);
// without a contract the defaults below apply, which are the same as the shipped template contract.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, parseJsonc, resolveLayout, toPosix } from '../check-lib.mjs';

export const DEFAULT_SPEC_DIR = 'docs/spec';
export const CONTRACT_NAME = 'spec.json';
/** rn-skills.config.json key that moves the contract (the --contract option wins over it). */
export const CONTRACT_CONFIG_KEY = 'specContract';
export const STATUSES = ['planned', 'in-progress', 'built', 'dropped', 'out-of-scope', 'open', 'decided'];
/** Statuses that mean "this is not built, and must not be": a test that traces one builds excluded work. */
export const EXCLUDED_STATUSES = ['dropped', 'out-of-scope'];
export const PLATFORMS = ['ios', 'android', 'web'];

export const DEFAULT_KINDS = Object.freeze([
  { kind: 'non-negotiable', prefix: 'NN-', defaultStatus: 'decided', requiredFields: ['Enforced by'] },
  { kind: 'screen', prefix: 'SCR-', traced: true, named: true },
  { kind: 'requirement', prefix: 'REQ-', traced: true },
  { kind: 'decision', prefix: 'DEC-', defaultStatus: 'open', requiredFields: ['Default|Decided'] },
  { kind: 'out-of-scope', prefix: 'OOS-', defaultStatus: 'out-of-scope' },
]);

const TOP_KEYS = ['$schema', '$comment', 'specDir', 'kinds', 'sections', 'aliases', 'traceGlobs', 'ignore'];
const KIND_KEYS = ['kind', 'prefix', 'traced', 'named', 'requiredFields', 'defaultStatus', 'bareIn', '$comment'];
const PREFIX_SHAPE = /^[A-Z][A-Z0-9]{0,9}[-_]?$/;
const KIND_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** The number part of a prefixed ID: 4, 4.1, 4.1.2, an optional lowercase letter (11a). */
export const NUMBER_PART = String.raw`\d{1,4}(?:\.\d{1,3}){0,2}[a-z]?`;
/** A section number: 4, 4.2, 4.2.1 (never a year or a time: the lookahead stops "2026-09" and "8.8 - 180"). */
export const SECTION = String.raw`\d{1,2}(?:\.\d{1,2}){0,2}(?![\w.]\d|\w)`;
const SEPARATOR = String.raw`\s*(?:·|—|–|:)\s+|\s+-\s+`;

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function contractError(file, message) {
  return new UsageError(`${file} does not match ${file.replace(/\.json$/, '.schema.json')}: ${message}`, 'Fix the contract (the skill ships templates/contracts/spec.json and its schema), or delete it to use the defaults.');
}

function validateContract(data, file) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw contractError(file, 'the contract must be a JSON object');
  for (const key of Object.keys(data)) if (!TOP_KEYS.includes(key)) throw contractError(file, `unknown key "${key}" (allowed: ${TOP_KEYS.join(', ')})`);
  if (data.specDir !== undefined && (typeof data.specDir !== 'string' || data.specDir === '' || data.specDir.startsWith('/') || data.specDir.split('/').includes('..'))) throw contractError(file, 'specDir must be a repo-relative folder (no leading /, no ..)');
  if (data.sections !== undefined && ![true, false, 'auto'].includes(data.sections)) throw contractError(file, 'sections must be true, false or "auto"');
  for (const key of ['traceGlobs', 'ignore']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some((item) => typeof item !== 'string' || item === ''))) throw contractError(file, `${key} must be a list of globs`);
  }
  if (data.kinds !== undefined) {
    if (!Array.isArray(data.kinds) || data.kinds.length === 0) throw contractError(file, 'kinds must be a non-empty list');
    const prefixes = new Set();
    const names = new Set();
    data.kinds.forEach((kind, index) => {
      const where = `kinds[${index}]`;
      if (kind === null || typeof kind !== 'object' || Array.isArray(kind)) throw contractError(file, `${where} must be an object`);
      for (const key of Object.keys(kind)) if (!KIND_KEYS.includes(key)) throw contractError(file, `${where} has an unknown key "${key}" (allowed: ${KIND_KEYS.join(', ')})`);
      if (typeof kind.kind !== 'string' || !KIND_SHAPE.test(kind.kind)) throw contractError(file, `${where}.kind must be a kebab-case name such as "requirement"`);
      if (typeof kind.prefix !== 'string' || !PREFIX_SHAPE.test(kind.prefix)) throw contractError(file, `${where}.prefix "${kind.prefix}" must be 1-10 capital letters or digits starting with a letter, optionally ending in - or _ (REQ-, SCR-, NN-)`);
      if (prefixes.has(kind.prefix)) throw contractError(file, `${where}.prefix "${kind.prefix}" is used twice`);
      if (names.has(kind.kind)) throw contractError(file, `${where}.kind "${kind.kind}" is used twice`);
      prefixes.add(kind.prefix);
      names.add(kind.kind);
      for (const flag of ['traced', 'named']) if (kind[flag] !== undefined && typeof kind[flag] !== 'boolean') throw contractError(file, `${where}.${flag} must be true or false`);
      if (kind.defaultStatus !== undefined && !STATUSES.includes(kind.defaultStatus)) throw contractError(file, `${where}.defaultStatus must be one of ${STATUSES.join(', ')}`);
      if (kind.bareIn !== undefined && !['everywhere', 'comments'].includes(kind.bareIn)) throw contractError(file, `${where}.bareIn must be "everywhere" or "comments"`);
      if (kind.requiredFields !== undefined && (!Array.isArray(kind.requiredFields) || kind.requiredFields.some((field) => typeof field !== 'string' || field.trim() === ''))) throw contractError(file, `${where}.requiredFields must be a list of field names ("Default|Decided" means either)`);
    });
  }
  if (data.aliases !== undefined) {
    if (data.aliases === null || typeof data.aliases !== 'object' || Array.isArray(data.aliases)) throw contractError(file, 'aliases must map an ID to a list of names');
    for (const [id, names] of Object.entries(data.aliases)) {
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || name.trim() === '')) throw contractError(file, `aliases["${id}"] must be a list of names`);
    }
  }
}

function normalizeKind(kind) {
  return {
    kind: kind.kind,
    prefix: kind.prefix,
    traced: kind.traced === true,
    named: kind.named === true,
    requiredFields: kind.requiredFields ?? [],
    defaultStatus: kind.defaultStatus ?? 'planned',
    // A prefix that ends in a separator (REQ-) cannot be part of a word or a standards name, so it is
    // read everywhere; a bare letter prefix (S) is read only in comments of code files, because "S256"
    // or a data code in a string is not a citation.
    bareIn: kind.bareIn ?? (/[-_]$/.test(kind.prefix) ? 'everywhere' : 'comments'),
  };
}

/**
 * Where the spec and its ID scheme live. Returns { applicable: false, reason } when the repo keeps no
 * spec (no contract and no default folder): a repo fact, so the checkers print NOT APPLICABLE.
 */
export function loadSpecConfig(root, { contract, spec } = {}) {
  const layout = resolveLayout(root);
  const configured = layout.config?.[CONTRACT_CONFIG_KEY];
  if (configured !== undefined && (typeof configured !== 'string' || configured.trim() === '' || configured.startsWith('/') || configured.split('/').includes('..'))) {
    throw new UsageError(`rn-skills.config.json "${CONTRACT_CONFIG_KEY}" must be a repo-relative file path`, `Set "${CONTRACT_CONFIG_KEY}": "contracts/${CONTRACT_NAME}" or remove the key.`);
  }
  const named = contract ?? configured;
  const contractRel = toPosix(named ?? join(layout.contractsDir, CONTRACT_NAME));
  const contractAbs = join(root, contractRel);
  let data = {};
  let contractText = null;
  if (existsSync(contractAbs)) {
    contractText = readFileSync(contractAbs, 'utf8');
    try {
      data = parseJsonc(contractText);
    } catch (error) {
      throw new UsageError(`${contractRel} is not valid JSON (${error.message})`, 'Fix the JSON syntax of the contract.');
    }
    validateContract(data, contractRel);
  } else if (named) {
    throw new UsageError(`nothing to check: contract ${contractRel} does not exist`, contract ? 'Pass the path of the spec contract, relative to the repo root.' : `Fix "${CONTRACT_CONFIG_KEY}" in rn-skills.config.json, or remove the key.`);
  }
  const specRel = toPosix(spec ?? data.specDir ?? DEFAULT_SPEC_DIR).replace(/\/+$/, '');
  const specAbs = join(root, specRel);
  const specExists = existsSync(specAbs) && statSync(specAbs).isDirectory();
  if (spec && !specExists) throw new UsageError(`nothing to check: spec folder ${specRel} does not exist`, 'Pass the folder that holds the spec markdown files, relative to the repo root.');
  const base = {
    layout,
    contractRel,
    contractText,
    hasContract: contractText !== null,
    specRel,
    specAbs,
    specExists,
    kinds: (data.kinds ?? DEFAULT_KINDS).map(normalizeKind),
    sections: data.sections ?? 'auto',
    aliases: data.aliases ?? {},
    traceGlobs: data.traceGlobs ?? ['*.test.ts', '*.test.tsx', '*.test.js', '*.test.mjs', `${layout.e2eDir}/**/*.yaml`, `${layout.e2eDir}/**/*.yml`],
    ignore: data.ignore ?? [],
  };
  if (contractText === null && !specExists) {
    return { ...base, applicable: false, reason: `the app keeps no requirement spec (no ${contractRel} and no ${specRel}/ folder)` };
  }
  return { ...base, applicable: true };
}

/** The configured prefixes as one alternation, longest first (so SCR- wins over S). */
export function prefixAlternation(kinds) {
  return [...kinds].map((kind) => kind.prefix).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
}

/** RegExp source for a prefixed ID of the given kinds; group 1 is the prefix, group 2 the number. */
export function prefixedIdSource(kinds) {
  return String.raw`(?<![A-Za-z0-9_])(${prefixAlternation(kinds)})(${NUMBER_PART})(?![A-Za-z0-9_]|\.\d)`;
}

/** The kind of an ID (or null): a prefixed ID, or 'section' for a section number. */
export function kindOf(id, kinds) {
  if (new RegExp(String.raw`^${SECTION}$`).test(id)) return 'section';
  const match = new RegExp(`^${prefixedIdSource(kinds)}$`).exec(id);
  return match ? kinds.find((kind) => kind.prefix === match[1]).kind : null;
}

/** Canonical form of a typed ID: "req-4" -> "REQ-4", "spec 4.2" -> "4.2", "§ 4" -> "4", "scr-11A" -> "SCR-11a". */
export function normalizeId(raw, kinds) {
  let text = String(raw).trim().replace(/[.,;:)\]]+$/, '').replace(/^[([]/, '');
  text = text.replace(/^spec(?:'s)?\s*/i, '').replace(/^(?:sections?|§)\s*/i, '');
  const upper = text.toUpperCase();
  for (const kind of [...kinds].sort((a, b) => b.prefix.length - a.prefix.length)) {
    if (upper.startsWith(kind.prefix) && /^\d/.test(text.slice(kind.prefix.length))) {
      return `${kind.prefix}${text.slice(kind.prefix.length).toLowerCase()}`;
    }
  }
  return text;
}

const FIELD = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?([A-Z][A-Za-z ]{1,30}?)(?:(?:\*\*|__):|:(?:\*\*|__)|:)\s*(.*?)\s*$/;

/** The "Name: value" lines of an entry's own body (lowercase names). */
function fieldsOf(lines, start, end) {
  const fields = new Map();
  let fence = false;
  for (let index = start; index < end; index += 1) {
    if (/^\s*(```|~~~)/.test(lines[index])) fence = !fence;
    if (fence) continue;
    const match = FIELD.exec(lines[index]);
    if (match && !fields.has(match[1].toLowerCase())) fields.set(match[1].toLowerCase(), { name: match[1], value: match[2], line: index + 1 });
  }
  return fields;
}

/** Every markdown file of the spec folder, repo-relative, sorted. */
export function specFiles(config) {
  const out = [];
  const visit = (dirAbs, dirRel) => {
    for (const item of readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith('.')) continue;
      if (item.isDirectory()) visit(join(dirAbs, item.name), `${dirRel}/${item.name}`);
      else if (/\.mdx?$/.test(item.name)) out.push(`${dirRel}/${item.name}`);
    }
  };
  visit(config.specAbs, config.specRel);
  return out;
}

/**
 * Reads every entry of the spec. Returns { entries, malformed, files } where an entry is
 * { id, kind, title, file, line, level, text, fields, status } and malformed lists headings that start
 * like an entry but are not one ({ file, line, heading, reason }).
 */
export function readSpec(root, config) {
  const files = specFiles(config);
  const entries = [];
  const malformed = [];
  // Groups: 1 hashes, 2 the ID, 3 its prefix (none for a section), 4 its number, 5 the title.
  const entryHeading = new RegExp(String.raw`^(#{1,6})\s+((${prefixAlternation(config.kinds)})(${NUMBER_PART})|${SECTION})(?:${SEPARATOR})(.+?)(?:\s+#+)?\s*$`);
  const stems = config.kinds.map((kind) => kind.prefix.replace(/[-_]$/, '')).filter(Boolean);
  const looksLikeEntry = stems.length ? new RegExp(String.raw`^(${stems.map(escapeRe).join('|')})(?:[-_ ]?\d|[-_]\w)`) : null;
  const kindByPrefix = new Map(config.kinds.map((kind) => [kind.prefix, kind]));
  for (const rel of files) {
    const lines = readFileSync(join(root, rel), 'utf8').split('\n');
    const heads = [];
    let fence = false;
    lines.forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence) return;
      const hashes = /^(#{1,6})\s+(.*)$/.exec(line);
      if (!hashes) return;
      const full = entryHeading.exec(line);
      if (full) {
        const id = full[2];
        const prefix = full[3];
        heads.push({ index, level: hashes[1].length, id, kind: prefix ? kindByPrefix.get(prefix) : null, title: full[5] });
        return;
      }
      heads.push({ index, level: hashes[1].length, id: null });
      const text = hashes[2].trim();
      const stem = looksLikeEntry ? looksLikeEntry.exec(text) : null;
      if (stem) {
        // The example ID uses the prefix the heading starts with (REQ-1 for "REQ 6 · Archive").
        const kind = config.kinds.find((item) => item.prefix.replace(/[-_]$/, '') === stem[1]) ?? config.kinds[0];
        malformed.push({ file: rel, line: index + 1, heading: line.trim(), reason: `"${text}" is not "<ID> · <title>" with an ID such as ${kind.prefix}1` });
      }
    });
    heads.forEach((head, i) => {
      if (!head.id) return;
      const next = heads.slice(i + 1).find((other) => other.level <= head.level);
      const child = heads[i + 1];
      const end = next ? next.index : lines.length;
      const ownEnd = child ? child.index : lines.length;
      const fields = fieldsOf(lines, head.index + 1, ownEnd);
      const kind = head.kind;
      const statusField = fields.get('status');
      const status = statusField ? statusField.value.toLowerCase().replace(/[.;,]+$/, '').split(/[\s(]/)[0] : kind ? kind.defaultStatus : null;
      entries.push({
        id: head.id,
        kind: kind ? kind.kind : 'section',
        kindSpec: kind,
        title: head.title.trim(),
        file: rel,
        line: head.index + 1,
        level: head.level,
        text: lines.slice(head.index, end).join('\n').trimEnd(),
        fields,
        status,
      });
    });
  }
  return { entries, malformed, files };
}

/** Names a citation may pair with an ID: the entry title and the contract aliases, lowercase. */
export function namesOf(entry, aliases) {
  const names = new Set([entry.title.toLowerCase().replace(/\s+/g, ' ').trim()]);
  for (const alias of aliases[entry.id] ?? []) names.add(alias.toLowerCase().replace(/\s+/g, ' ').trim());
  return [...names].filter(Boolean);
}
