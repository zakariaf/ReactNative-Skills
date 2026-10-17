#!/usr/bin/env node
// spec-lookup.mjs: prints the exact text of spec entries (REQ-4, SCR-2, NN-1, DEC-3, a section number)
// from the app's spec folder, so a test title, code comment, commit body or question quotes the spec
// instead of paraphrasing it from memory.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/spec-lookup.mjs [repo-root] <id...>     (or --list for every ID)

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { UsageError, createReporter, parseArgs, requireFile, run } from './check-lib.mjs';
import { EXCLUDED_STATUSES, kindOf, loadSpecConfig, normalizeId, readSpec } from './lib/spec-model.mjs';

const SPEC = {
  name: 'spec-lookup',
  summary: 'Prints the spec entry for each ID from the app\'s spec folder, and fails on IDs that do not exist.',
  usage: '[repo-root] [options] <id...>',
  options: {
    from: { type: 'string', value: 'file', help: 'Read the IDs from a file (separated by spaces, commas or new lines); a relative path is tried under the repo root first, then the current folder' },
    list: { type: 'boolean', help: 'List every entry (ID, kind, status, title, place) instead of printing entries' },
    kind: { type: 'string', value: 'kind', help: 'With --list: only entries of this kind (requirement, screen, decision, ...)' },
    brief: { type: 'boolean', help: 'Print only the heading line of each entry' },
    spec: { type: 'string', value: 'dir', help: 'Spec folder, repo-relative (default: specDir of contracts/spec.json, else docs/spec)' },
    contract: { type: 'string', value: 'file', help: 'Spec contract, repo-relative (default: <contractsDir>/spec.json)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: Infinity },
  details: [
    'The first argument is the repo root when it names an existing folder (default: the current folder).',
    'IDs follow the app\'s scheme in contracts/spec.json (default prefixes: NN- non-negotiable, SCR- screen,',
    'REQ- requirement, DEC- decision, OOS- out of scope), plus section numbers when the spec numbers them.',
    '"spec 4.2", "section 4", "§ 4.2" and lowercase forms (req-4) are accepted.',
    'An entry marked dropped or out-of-scope prints a line saying it must not be built.',
    '',
    'Rule:',
    '  unknown-spec-id  the ID is not in the spec (a typo, or an entry that does not exist yet)',
    '',
    'A repo with no spec prints NOT APPLICABLE for --list, and exits 2 when IDs are asked for.',
    'rn-skills.config.json keys read: specContract (moves contracts/spec.json), contractsDir.',
    '',
    'Examples:',
    '  node spec-lookup.mjs . REQ-4 SCR-2 NN-1',
    '  node spec-lookup.mjs --list --kind decision',
  ].join('\n'),
};

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

/** The closest IDs of the same kind: shared prefix, nearest number. */
function suggestions(id, entries, kinds) {
  const kind = kindOf(id, kinds);
  const sameKind = entries.filter((entry) => entry.kind === kind || (kind === null && entry.id.toLowerCase().startsWith(id.slice(0, 2).toLowerCase())));
  const number = Number.parseFloat(id.replace(/^\D+/, ''));
  return sameKind
    .map((entry) => ({ id: entry.id, distance: Math.abs(Number.parseFloat(entry.id.replace(/^\D+/, '')) - number) || 0 }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((item) => item.id);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const args = [...positionals];
  const root = args.length > 0 && isDir(resolve(args[0])) ? resolve(args.shift()) : resolve('.');
  const report = createReporter({ name: 'spec-lookup', json: options.json });
  const config = loadSpecConfig(root, { contract: options.contract, spec: options.spec });
  // Each ID remembers where it came from, so a problem line names <file>:<line>: the --from file and
  // its line, or the spec folder (line 1) for an ID given on the command line.
  const raw = args.map((text) => ({ text, file: null, line: 1 }));
  if (options.from) {
    // Relative to the repo root first (spec-lookup.mjs <app> --from ids.txt), else to the current folder.
    const underRoot = isAbsolute(options.from) ? null : resolve(root, options.from);
    const fromAbs = requireFile(underRoot && existsSync(underRoot) ? underRoot : options.from, 'ID file');
    const fromRel = relative(root, fromAbs);
    const fromName = fromRel && !fromRel.startsWith('..') && !isAbsolute(fromRel) ? fromRel.split('\\').join('/') : options.from;
    readFileSync(fromAbs, 'utf8').split('\n').forEach((lineText, index) => {
      for (const text of lineText.split(/[\s,]+/)) raw.push({ text, file: fromName, line: index + 1 });
    });
  }
  const sources = raw
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.text && !/^spec$/i.test(item.text) && !/^(sections?|§)$/i.test(item.text));
  const ids = sources.map((item) => item.text);
  if (!config.applicable) {
    if (options.list || ids.length === 0) return report.notApplicable(`${config.reason}; quote the issue or acceptance criterion instead`);
    throw new UsageError(`no requirement spec to look ${ids.join(', ')} up in: ${config.reason}`, 'Quote the issue or acceptance criterion instead, or create the spec from the skill\'s templates/docs/spec/.');
  }
  if (!config.specExists) throw new UsageError(`the spec folder ${config.specRel}/ named by ${config.contractRel} does not exist`, `Create ${config.specRel}/ or fix specDir in ${config.contractRel}.`);
  const { entries } = readSpec(root, config);
  if (entries.length === 0) throw new UsageError(`${config.specRel}/ holds no entry heading`, `Write each entry as a heading "## ${config.kinds[0].prefix}1 · <title>"; check-spec-refs.mjs reports malformed headings.`);
  if (options.list) {
    const shown = entries.filter((entry) => !options.kind || entry.kind === options.kind);
    if (options.kind && shown.length === 0) throw new UsageError(`no entry of kind "${options.kind}"`, `Use one of: ${[...new Set(entries.map((entry) => entry.kind))].join(', ')}.`);
    for (const entry of shown) console.log(`${entry.id.padEnd(10)} ${entry.kind.padEnd(15)} ${(entry.kindSpec ? entry.status : '').padEnd(12)} ${entry.title}  (${entry.file}:${entry.line})`);
    return report.finish({ checked: shown.length, unit: 'spec entries' });
  }
  if (ids.length === 0) throw new UsageError('no IDs given', 'Pass IDs such as REQ-4 SCR-2 NN-1, or --list to see every entry.');
  const byId = new Map();
  for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  for (const source of sources) {
    const rawId = source.text;
    const id = normalizeId(rawId, config.kinds);
    const entry = byId.get(id);
    if (!entry) {
      const near = suggestions(id, entries, config.kinds);
      report.problem({ file: source.file ?? config.specRel, line: source.line, rule: 'unknown-spec-id', message: `"${rawId}" is not a spec entry${near.length ? ` (nearest: ${near.join(', ')})` : ''}`, fix: 'Check the ID with --list. A requirement the spec does not have is a question for the reviewer, never an entry to invent.' });
      continue;
    }
    const status = entry.kindSpec ? `  [${entry.kind}, ${entry.status}]` : '';
    console.log(`== ${entry.id} · ${entry.title}${status}  (${entry.file}:${entry.line})`);
    if (EXCLUDED_STATUSES.includes(entry.status)) console.log(`NOTE ${entry.id} is ${entry.status}: do not build it; ask the reviewer before bringing it into scope.`);
    if (!options.brief) console.log(`${entry.text.split('\n').slice(1).join('\n').trim()}\n`);
  }
  return report.finish({ checked: ids.length, unit: 'IDs' });
});
