#!/usr/bin/env node
// check-catalogue.mjs: validates the known-failures catalogue, proves that every recorded error line
// still finds its entry first, and proves the area references are rendered from the catalogue. With
// --write it (re)renders the references after an entry was added or changed.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-catalogue.mjs          (this skill's own catalogue)
//      node ${CLAUDE_SKILL_DIR}/scripts/check-catalogue.mjs --write  (after editing assets/known-failures/)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createReporter, parseArgs, run } from './check-lib.mjs';
import { DEFAULT_CATALOGUE, DEFAULT_QUERIES, DEFAULT_REFERENCES, entriesOf, loadCatalogue, rankEntries, readQueries, referenceName, renderArea, validateCatalogue } from './lib/catalogue.mjs';
import { PITFALLS } from './lib/pitfalls.mjs';

const SPEC = {
  name: 'check-catalogue',
  summary: 'Validates the known-failures catalogue (index.json and one <area>.json per area), runs the recorded error lines of known-queries.tsv against it, and checks that every area reference is exactly what the catalogue renders. --write renders them.',
  usage: '[options]',
  options: {
    catalogue: { type: 'string', value: 'dir', help: "Catalogue folder (default: this skill's assets/known-failures/)" },
    references: { type: 'string', value: 'dir', help: "Folder of the rendered area references (default: this skill's references/)" },
    queries: { type: 'string', value: 'file', help: "Recorded error lines, one '<expected-id><TAB><query>' per line (default: this skill's assets/known-queries.tsv for its own catalogue)" },
    write: { type: 'boolean', help: 'Write the rendered references instead of only comparing them' },
    'pitfall-ids': { type: 'boolean', help: 'Also check that every check-known-pitfalls rule names an entry of this catalogue (always on for the own catalogue)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 0 },
  details: [
    'Rules:',
    '  catalogue-shape      index.json: version 2, reviewedOn, areas (title, intro, reverify, references/<name>.md), skills,',
    '                       bannedTerms; one { area, entries } file per area; at least one entry',
    '  entry-shape          an object with only the known keys',
    '  entry-id             <area>-<slug>, kebab-case',
    '  entry-text           topic, symptom, cause and fix are written',
    '  entry-match          match is a list of compilable regular expressions',
    '  entry-match-broad    a pattern shorter than 4 characters, or one that matches an empty line',
    '  entry-status         verified | documented | open',
    '  entry-needs-human    needsHuman is a boolean',
    '  entry-skill          a skill name or null; entry-skill-unknown: not in index.json skills',
    '  entry-platforms      absent (both) or a list of ios / android',
    '  entry-applies-to     { "<package>": "<range>" } with ranges the lookup understands',
    '  entry-banned-term    text that matches an index.json bannedTerms pattern (private nouns, paths)',
    '  entry-duplicate      an id used twice',
    '  query-unknown-id     a queries line names no entry',
    '  query-not-found      a recorded error line finds nothing',
    '  query-not-first      a recorded error line ranks another entry first',
    '  query-missing        an entry with match patterns has no recorded error line (own catalogue, or with --queries)',
    '  reference-stale      references/<name>.md differs from the rendering (fix: --write)',
    '  pitfall-id           a rule of check-known-pitfalls.mjs names no entry (own catalogue, or with --pitfall-ids)',
  ].join('\n'),
};

function checkQueries(report, entries, rows, queriesFile) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const covered = new Set();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      report.problem({ file: queriesFile, line: row.line, rule: 'query-unknown-id', message: `"${row.id}" is not a catalogue id`, fix: "Write each line as '<expected-id><TAB><the exact error text>'." });
      continue;
    }
    covered.add(row.id);
    const ranked = rankEntries(entries, row.query, { keywords: true });
    if (ranked.length === 0) report.problem({ file: queriesFile, line: row.line, rule: 'query-not-found', message: `nothing matches "${row.query.slice(0, 80)}" (expected ${row.id})`, fix: `Give ${row.id} a match pattern that matches this exact text.` });
    else if (ranked[0].entry.id !== row.id) report.problem({ file: queriesFile, line: row.line, rule: 'query-not-first', message: `"${row.query.slice(0, 80)}" ranks ${ranked[0].entry.id} first, not ${row.id}`, fix: `Make the patterns more specific: ${row.id} must match this text and ${ranked[0].entry.id} must not.` });
  }
  return covered;
}

run(async () => {
  const { options } = parseArgs(process.argv.slice(2), SPEC);
  const own = !options.catalogue;
  const catalogue = loadCatalogue(resolve(options.catalogue ?? DEFAULT_CATALOGUE));
  const referencesDir = resolve(options.references ?? DEFAULT_REFERENCES);
  const report = createReporter({ name: 'check-catalogue', json: options.json });
  for (const problem of validateCatalogue(catalogue)) report.problem({ file: problem.file, rule: problem.rule, message: `${problem.where}: ${problem.message}`, fix: problem.fix });
  if (report.count > 0) return report.finish({ checked: catalogue.entries.length, unit: 'entries' });
  const entries = entriesOf(catalogue);
  const queriesPath = options.queries ? resolve(options.queries) : own ? DEFAULT_QUERIES : null;
  if (queriesPath) {
    const rows = readQueries(queriesPath);
    const shown = own && !options.queries ? 'assets/known-queries.tsv' : queriesPath;
    if (!rows) report.problem({ file: shown, rule: 'query-missing', message: 'the queries file does not exist', fix: "Create it: one '<expected-id><TAB><exact error text>' line per entry that has match patterns." });
    else {
      const covered = checkQueries(report, entries, rows, shown);
      for (const entry of entries) {
        if (entry.match.length > 0 && !covered.has(entry.id)) report.problem({ file: shown, rule: 'query-missing', message: `${entry.id} has match patterns but no recorded error line`, fix: `Add '${entry.id}<TAB><the exact first error line>' so the self-test proves find-fix finds it.` });
      }
    }
  }
  for (const areaId of Object.keys(catalogue.index.areas)) {
    const name = referenceName(catalogue, areaId);
    const file = join(referencesDir, name);
    const rendered = renderArea(catalogue, areaId);
    if (options.write) {
      writeFileSync(file, rendered);
      report.note(`wrote references/${name}`);
    } else if (!existsSync(file) || readFileSync(file, 'utf8') !== rendered) {
      report.problem({ file: `references/${name}`, rule: 'reference-stale', message: existsSync(file) ? 'differs from the catalogue' : 'is missing', fix: 'Edit assets/known-failures/<area>.json (never the reference), then run check-catalogue.mjs --write.' });
    }
  }
  if (own || options['pitfall-ids']) {
    const ids = new Set(entries.map((entry) => entry.id));
    for (const pitfall of PITFALLS) {
      if (!ids.has(pitfall.id)) report.problem({ file: 'scripts/lib/pitfalls.mjs', rule: 'pitfall-id', message: `pitfall rule ${pitfall.id} has no catalogue entry`, fix: 'Add the entry to assets/known-failures/<area>.json or fix the rule id.' });
    }
  }
  return report.finish({ checked: entries.length, unit: 'entries' });
});
