#!/usr/bin/env node
// check-stack-pins.mjs: finds explicit version statements of the tracked stack in skills (markdown,
// templates, examples, assets) and reports every one that disagrees with tools/stack.json.
// Usage: node tools/check-stack-pins.mjs [skill-name-or-path...] [options]   (see --help)

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STACK_PATH, defaultTargets, readJson, resolveRoots, resolveTargets, targetLabel } from './lib/library.mjs';
import { UsageError, createReporter, isBinary, parseArgs, resultLine, run, walk } from './shared/scripts/check-lib.mjs';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// Versions and ranges (the small subset of semver the table and the skills use)
// ---------------------------------------------------------------------------------------------

/** "57.0.26" -> { parts: [57, 0, 26], partial: false }; "57", "57.0", "57.0.x" -> partial. */
export function parseVersion(text) {
  const match = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(String(text).trim());
  if (!match) return null;
  const parts = [];
  for (const piece of match.slice(1)) {
    if (piece === undefined || piece === 'x' || piece === '*') break;
    parts.push(Number(piece));
  }
  return { parts, partial: parts.length < 3 };
}

const full = (parts) => [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const nextPrefix = (parts) => (parts.length === 1 ? [parts[0] + 1, 0, 0] : parts.length === 2 ? [parts[0], parts[1] + 1, 0] : [parts[0], parts[1], parts[2] + 1]);
const fmt = (v) => v.join('.');

/** A range as an interval { lo, hi } with hi exclusive (null = no upper bound). Throws on syntax it does not know. */
export function rangeInterval(range) {
  const text = String(range).trim();
  const between = /^>=\s*(\S+)(?:\s+<\s*(\S+))?$/.exec(text);
  if (between) {
    const lo = parseVersion(between[1]);
    const hi = between[2] ? parseVersion(between[2]) : null;
    if (!lo || (between[2] && !hi)) throw new Error(`range "${range}" is not understood`);
    return { lo: full(lo.parts), hi: hi ? full(hi.parts) : null };
  }
  const op = /^(~|\^|=)?\s*(.*)$/.exec(text);
  const version = parseVersion(op[2]);
  if (!version) throw new Error(`range "${range}" is not understood`);
  const lo = full(version.parts);
  const [a, b, c] = lo;
  if (op[1] === '~') return { lo, hi: version.parts.length >= 2 ? [a, b + 1, 0] : [a + 1, 0, 0] };
  if (op[1] === '^') return { lo, hi: a > 0 || version.parts.length === 1 ? [a + 1, 0, 0] : b > 0 || version.parts.length === 2 ? [0, b + 1, 0] : [0, 0, c + 1] };
  return { lo, hi: nextPrefix(version.parts) }; // a partial version covers its prefix; an exact one only itself
}

const inside = (v, range) => cmp(v, range.lo) >= 0 && (range.hi === null || cmp(v, range.hi) < 0);
const intersects = (a, b) => {
  const lo = cmp(a.lo, b.lo) >= 0 ? a.lo : b.lo;
  const his = [a.hi, b.hi].filter(Boolean);
  if (his.length === 0) return true;
  const hi = his.reduce((min, item) => (cmp(item, min) < 0 ? item : min));
  return cmp(lo, hi) < 0;
};
/** A statement entirely above the entry's range: a newer (upcoming or held-back) version, not a stale one. */
export function isNewer(statement, entry) {
  return entry.interval.hi !== null && cmp(full(statement.version.parts), entry.interval.hi) >= 0;
}
const specOperator = (spec) => (/^(>=|~|\^|=)/.exec(String(spec).trim())?.[1] ?? '');

/**
 * Is a statement consistent with an entry? statement = { op, version } where op is '', '~', '^', '=',
 * '>=', '>' or '+'/'or-newer' (a lower bound).
 */
export function consistent(statement, entry) {
  const range = entry.interval;
  const { parts, partial } = statement.version;
  const accepted = (entry.accept ?? []).some((value) => fmt(full(parseVersion(value).parts)) === fmt(full(parts)) && parts.length === 3);
  if (['>=', '>', '+', 'or-newer'].includes(statement.op)) {
    // A lower bound is consistent when the verified version meets it; for an entry that is itself a
    // minimum (range ">=..."), the bound must also not undercut the minimum's major ("Node 20+" is wrong).
    const bound = full(parts);
    const verified = full(parseVersion(entry.version)?.parts ?? range.lo);
    return cmp(bound, verified) <= 0 && (!entry.isMinimum || bound[0] >= range.lo[0]);
  }
  if (statement.op === '~' || statement.op === '^') {
    // A package.json entry's floor must lie in the range (no stale floors); elsewhere a range only has to overlap it.
    if (partial || statement.form !== 'json') return intersects(rangeInterval(`${statement.op}${parts.join('.')}`), range) || accepted;
    return inside(full(parts), range) || accepted;
  }
  if (partial) return intersects({ lo: full(parts), hi: nextPrefix(parts) }, range);
  return inside(full(parts), range) || accepted;
}

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Read and validate tools/stack.json; returns { data, entries: Map(key -> entry) }. */
export function loadStack(path = STACK_PATH) {
  const data = readJson(resolve(path), `stack file ${path}`);
  const entries = new Map();
  const errors = [];
  for (const group of ['packages', 'toolchain']) {
    for (const [key, raw] of Object.entries(data[group] ?? {})) {
      const at = `${group}.${key}`;
      const entry = { key, group, isPackage: group === 'packages' && raw.package !== false, ...raw };
      if (!parseVersion(raw.version) && !/^\d+(\.\d+)*$/.test(String(raw.version))) errors.push(`${at}.version "${raw.version}" is not a version`);
      entry.isMinimum = /^>=/.test(String(raw.range ?? '').trim());
      try {
        entry.interval = rangeInterval(raw.range ?? raw.version);
        if (parseVersion(raw.version) && !inside(full(parseVersion(raw.version).parts), entry.interval)) errors.push(`${at}.version ${raw.version} is outside its own range ${raw.range}`);
      } catch (error) {
        errors.push(`${at}: ${error.message}`);
      }
      if (!Array.isArray(raw.names) || raw.names.length === 0) errors.push(`${at}.names must list how prose names it`);
      for (const field of ['how', 'verified', 'reverify']) if (typeof raw[field] !== 'string' || raw[field] === '') errors.push(`${at}.${field} is missing`);
      if (entry.isPackage && typeof raw.spec !== 'string') errors.push(`${at}.spec is missing (the package.json specifier skills write)`);
      for (const value of raw.accept ?? []) if (!parseVersion(value) || parseVersion(value).partial) errors.push(`${at}.accept "${value}" is not an exact version`);
      entries.set(key, entry);
    }
  }
  if (!Array.isArray(data.contrastWords)) errors.push('contrastWords must be a list of words');
  if (errors.length) throw new UsageError(`stack file ${path} is invalid: ${errors.join('; ')}`, 'Fix tools/stack.json (each entry needs version, range, names, how, verified, reverify; packages also spec).');
  return { data, entries };
}

/** Compile the matchers for every entry (the package.json keys, npm names and prose names). */
export function compileMatchers(entries) {
  const byPackage = new Map();
  const byJsonKey = new Map();
  const prose = [];
  for (const entry of entries.values()) {
    if (entry.isPackage) byPackage.set(entry.key, entry);
    for (const key of entry.jsonKeys ?? []) byJsonKey.set(key, entry);
    for (const name of entry.names) {
      const sep = entry.assign ? '(?:\\s+|\\s*[:=]\\s*["\'`]?)' : '\\s+';
      const re = new RegExp(`(?<![\\w@/.-])${escapeRegExp(name)}[\`'"*]*${sep}(?:(>=|≥|>|\\^|~)\\s*)?\`?v?(\\d+(?:\\.(?:\\d+|x))*)(\\+)?(?![\\w-]|\\.\\w)`, 'g');
      prose.push({ entry, name, re, notAfter: new Set(entry.notAfter ?? []) });
    }
  }
  return { byPackage, byJsonKey, prose };
}

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)\]'"`>]+/gi;
const VERSION_VALUE = /^\s*(>=|>|\^|~|=)?\s*v?(\d+(?:\.(?:\d+|x|\*)){0,2})(?:\s+<\s*\S+)?\s*$/;
const LOWER_AFTER = /^\s*(?:or|and) (?:newer|later|above|higher)\b/i;

/** Every explicit version statement of a tracked entry in one line. */
export function statementsInLine(rawLine, matchers) {
  const line = rawLine.replace(URL_PATTERN, (match) => ' '.repeat(match.length));
  const found = new Map();
  const add = (entry, form, op, versionText, index, raw) => {
    const version = parseVersion(versionText);
    if (!version || version.parts.length === 0) return;
    const id = `${entry.key}:${index}`;
    if (found.has(id)) return;
    found.set(id, { entry, form, op, version, versionText, index, raw });
  };
  for (const match of line.matchAll(/"(@?[A-Za-z0-9][\w.\-/]*)"\s*:\s*"([^"]*)"/g)) {
    const entry = matchers.byPackage.get(match[1]) ?? matchers.byJsonKey.get(match[1]);
    const value = VERSION_VALUE.exec(match[2]);
    if (!entry || !value) continue;
    add(entry, 'json', value[1] ?? '', value[2], match.index + match[0].lastIndexOf(match[2]) + match[2].indexOf(value[2]), match[0]);
  }
  if (!/\bnpm (?:view|info|show|v)\b/.test(line)) {
    for (const match of line.matchAll(/(?<![\w./@-])(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)@(>=|\^|~|=)?v?(\d+(?:\.(?:\d+|x)){0,2})(?![\w-]|\.\w)/g)) {
      const entry = matchers.byPackage.get(match[1]);
      if (entry) add(entry, 'npm', match[2] ?? '', match[3], match.index + match[0].lastIndexOf(match[3]), match[0]);
    }
  }
  for (const { entry, name, re, notAfter } of matchers.prose) {
    re.lastIndex = 0;
    for (const match of line.matchAll(re)) {
      if (notAfter.size) {
        const before = /([A-Za-z]+)[\s`*]*$/.exec(line.slice(0, match.index));
        if (before && notAfter.has(before[1])) continue;
      }
      let op = match[1] === '≥' ? '>=' : match[1] ?? '';
      if (match[3] === '+') op = '+';
      if (!op && LOWER_AFTER.test(line.slice(match.index + match[0].length))) op = 'or-newer';
      add(entry, 'prose', op, match[2], match.index + match[0].lastIndexOf(match[2]), `${name} ${match[0].slice(name.length).trim()}`);
    }
  }
  return [...found.values()].sort((a, b) => a.index - b.index);
}

/** The clause around an index: split at table cells, parentheses, semicolons and sentence ends. */
function clauseAt(line, index) {
  const stops = /[|;()]|\.\s|,\s+but\s/g;
  let start = 0;
  let end = line.length;
  for (const match of line.matchAll(stops)) {
    if (match.index < index) start = match.index + match[0].length;
    else {
      end = match.index;
      break;
    }
  }
  return line.slice(start, end);
}

// ---------------------------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------------------------

function looksBinary(abs) {
  const fd = openSync(abs, 'r');
  try {
    const buffer = Buffer.alloc(8000);
    return isBinary(buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)));
  } finally {
    closeSync(fd);
  }
}

/** The files of a skill this check reads: markdown outside tests/, and everything in templates/, examples/ and assets/ except test files. */
export function scannedFiles(dir) {
  return walk(dir, { defaultIgnores: false, ignore: ['node_modules', '.git', '.DS_Store'] }).filter((rel) => {
    // Fixtures and test files hold versions as test data on purpose.
    if (rel.startsWith('tests/') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)) return false;
    if (rel.endsWith('.md')) return true;
    return /^(templates|examples|assets)\//.test(rel);
  });
}

/** Statements of one file: [{ line, statement, verdict: 'ok'|'mismatch'|'spec'|'skipped', why }]. */
export function checkText(text, matchers, { strict = false, markdown = false, contrastWords = [] } = {}) {
  const contrast = new RegExp(`(?:^|[^\\w-])(?:${contrastWords.map(escapeRegExp).join('|')})(?![\\w-])|→|->`, 'i');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.slice(0, 10).some((line) => line.includes('stack-pin-ignore-file'))) return [];
  const out = [];
  let skipNext = false;
  let block = false;
  let fence = false;
  let section = '';
  lines.forEach((line, i) => {
    if (markdown) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      const heading = !fence && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading && /^#{1,3}\s/.test(line)) section = heading[1];
    }
    if (line.includes('stack-pin-ignore-start')) block = true;
    if (line.includes('stack-pin-ignore-end')) {
      block = false;
      return;
    }
    const ignored = block || skipNext || line.includes('stack-pin-ignore');
    skipNext = line.includes('stack-pin-ignore-next-line');
    const statements = statementsInLine(line, matchers);
    if (statements.length === 0) return;
    const okKeys = new Set(statements.filter((statement) => consistent(statement, statement.entry)).map((statement) => statement.entry.key));
    for (const statement of statements) {
      const record = (verdict, why = '') => out.push({ line: i + 1, statement, verdict, why });
      if (ignored) {
        record('skipped', 'stack-pin-ignore marker');
        continue;
      }
      const ok = consistent(statement, statement.entry);
      if (ok) {
        const spec = statement.entry.spec;
        const op = statement.op === '=' ? '' : statement.op;
        const allowed = new Set([specOperator(spec ?? ''), specOperator(statement.entry.range ?? '')]);
        if (statement.form === 'json' && spec && statement.version.parts.length === 3 && !allowed.has(op) && !['>=', '>'].includes(op)) record('spec');
        else record('ok');
        continue;
      }
      if (!strict && markdown && /anti-patterns/i.test(section)) record('skipped', 'Anti-patterns section');
      else if (!strict && statement.form !== 'json' && isNewer(statement, statement.entry)) record('skipped', 'names a newer version (upcoming or held back)');
      else if (!strict && statement.form !== 'json' && contrast.test(clauseAt(line, statement.index))) record('skipped', 'contrast wording in the same clause');
      else if (!strict && statement.form === 'prose' && okKeys.has(statement.entry.key)) record('skipped', 'the line also states the verified version (a comparison)');
      else record('mismatch');
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const SPEC = {
  name: 'check-stack-pins',
  summary: 'Reports every explicit version statement of a tracked package or tool in the skills (markdown outside tests/, templates/, examples/, assets/) that disagrees with tools/stack.json.',
  usage: '[options] [skill-name-or-path...]',
  options: {
    'skills-root': { type: 'string', value: 'dir', help: 'Folder that holds the skill folders (default: <repo>/skills)' },
    stack: { type: 'string', value: 'file', help: 'Stack table (default: tools/stack.json)' },
    strict: { type: 'boolean', help: 'Also report statements in contrast wording, comparisons and Anti-patterns sections' },
    summary: { type: 'boolean', help: 'Print counts per entry and per skill instead of every problem' },
    verbose: { type: 'boolean', help: 'Also print consistent and skipped statements' },
    json: { type: 'boolean', help: 'Also print the results as JSON' },
  },
  positionals: { min: 0, max: Infinity },
  details: [
    'What counts as a statement (only explicit name+version pairs, to keep false positives low):',
    '  "zustand": "^5.0.15"            a package.json-style entry of a tracked package (or engines "node": ">=22.18")',
    '  zustand@5.0.15                  an npm spec (lines with npm view/info/show are queries and are skipped)',
    '  React Native 0.86.3, Expo SDK 57, Xcode 26.6, Node >= 22.18, Jest 29+, compileSdkVersion = 36',
    '                                  a name from the entry\'s "names" right before the version',
    'A statement is consistent when an exact version lies in the entry\'s range, a partial one ("Reanimated 4")',
    'or a range overlaps it (a package.json entry\'s floor must lie in it: no stale floors), and a lower bound',
    '("22+", ">= 22.18", "26.4 or newer") is met by the verified version without undercutting the major of an',
    'entry that is itself a minimum (node, ios-deployment-target, android-min-sdk). A consistent package.json',
    'entry whose specifier is neither the table\'s spec nor its range ("57.0.3" where both write "~57.0.3") is',
    'reported as stack-spec. Test files (*.test.ts, ...) and tests/ are not read: their versions are test data.',
    '',
    'Not reported unless --strict (stale pins are the drift this check exists for; the rest is context):',
    'a prose or npm statement of a version newer than the range (an upcoming or held-back release), a prose',
    'or npm statement in a clause with contrast wording ("not", "never", "beta", "upgrade", "->", ...), a',
    'prose statement on a line that also states the verified version (a comparison), and statements in a',
    'markdown Anti-patterns section. package.json-style entries are always checked.',
    '',
    'Markers: a line containing stack-pin-ignore is skipped; stack-pin-ignore-next-line skips the next line;',
    'stack-pin-ignore-start ... stack-pin-ignore-end skips a block; stack-pin-ignore-file in the first ten',
    'lines skips the file (in JSON, put it in a "$comment" string).',
    '',
    'Rules: stack-version (the version disagrees with the table), stack-spec (the specifier differs).',
  ].join('\n'),
};

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const roots = resolveRoots({ 'skills-root': options['skills-root'] });
  const { data, entries } = loadStack(options.stack ?? STACK_PATH);
  const matchers = compileMatchers(entries);
  const targets = positionals.length ? resolveTargets(positionals, roots) : defaultTargets(roots);
  const report = createReporter({ name: 'check-stack-pins', json: options.json });
  const perEntry = new Map();
  const perSkill = new Map();
  const skipped = new Map();
  let files = 0;
  let statements = 0;
  for (const target of targets) {
    const label = targetLabel(target);
    if (!existsSync(target.dir)) continue;
    for (const rel of scannedFiles(target.dir)) {
      const abs = join(target.dir, rel);
      if (statSync(abs).size > MAX_FILE_BYTES || looksBinary(abs)) continue;
      files += 1;
      for (const { line, statement, verdict, why } of checkText(readFileSync(abs, 'utf8'), matchers, { strict: options.strict, markdown: rel.endsWith('.md'), contrastWords: data.contrastWords })) {
        statements += 1;
        const entry = statement.entry;
        const stats = perEntry.get(entry.key) ?? { statements: 0, problems: 0 };
        stats.statements += 1;
        perEntry.set(entry.key, stats);
        const where = `${label}/${rel}`;
        const said = statement.raw.replace(/\s+/g, ' ').trim();
        if (verdict === 'skipped') {
          skipped.set(why, (skipped.get(why) ?? 0) + 1);
          if (options.verbose) report.note(`skip ${where}:${line} "${said}" (${why})`);
          continue;
        }
        if (verdict === 'ok') {
          if (options.verbose) report.note(`ok   ${where}:${line} "${said}"`);
          continue;
        }
        stats.problems += 1;
        perSkill.set(label, (perSkill.get(label) ?? 0) + 1);
        if (verdict === 'spec') {
          report.problem({ file: where, line, rule: 'stack-spec', message: `"${said}" writes the specifier ${statement.op || 'exact'} where tools/stack.json writes ${entry.spec} for ${entry.key}`, fix: `Write "${entry.spec}" (${specOperator(entry.spec) === '~' ? 'the specifier npx expo install writes for an Expo SDK package' : 'the house pin for a package outside the Expo map'}).` });
        } else {
          report.problem({ file: where, line, rule: 'stack-version', message: `"${said}" disagrees with the verified ${entry.key} ${entry.version} (consistent: ${entry.range ?? entry.version}; verified ${entry.verified})`, fix: `State ${entry.version} (re-verify: ${entry.reverify}), or mark the line with stack-pin-ignore when it deliberately names another version.` });
        }
      }
    }
  }
  if (options.summary) {
    report.note('');
    report.note(`${'ENTRY'.padEnd(34)}  STATEMENTS  PROBLEMS`);
    for (const [key, stats] of [...perEntry].sort((a, b) => b[1].problems - a[1].problems || (a[0] < b[0] ? -1 : 1))) report.note(`${key.padEnd(34)}  ${String(stats.statements).padStart(10)}  ${String(stats.problems).padStart(8)}`);
    report.note('');
    report.note(`${'SKILL'.padEnd(40)}  PROBLEMS`);
    for (const [skill, count] of [...perSkill].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) report.note(`${skill.padEnd(40)}  ${String(count).padStart(8)}`);
    report.note('');
  }
  report.note(`check-stack-pins: ${statements} version statements in ${files} files of ${targets.length} skills; skipped: ${[...skipped].map(([why, count]) => `${count} (${why})`).join(', ') || 'none'}`);
  if (options.summary) {
    // Keep the summary readable: print the counts, not every problem line.
    if (files === 0) throw new UsageError('nothing to check: 0 files found', 'Point it at skill folders that hold markdown, templates or assets.');
    const count = report.count;
    console.log(`check-stack-pins: ${files} files checked, ${count} problems`);
    if (options.json) console.log(JSON.stringify({ name: 'check-stack-pins', perEntry: Object.fromEntries(perEntry), perSkill: Object.fromEntries(perSkill), problems: count }));
    console.log(resultLine(count));
    return count === 0 ? 0 : 1;
  }
  return report.finish({ checked: files, unit: 'files' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(main);
