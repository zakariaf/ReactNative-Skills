#!/usr/bin/env node
// find-fix.mjs: looks an error up in the known-failures catalogue. Give it the error text, a log
// file, or an id; it prints the matching entries with cause, fix, status, platform and owning skill.
// Exit 0 when something known matched, 1 when nothing did (then diagnose from first principles and
// add the new entry to the catalogue once it is solved).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/find-fix.mjs --text "errSecInternalComponent"
//      node ${CLAUDE_SKILL_DIR}/scripts/find-fix.mjs . --log build/ios-sim/logs/xcodebuild.log
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, run } from './check-lib.mjs';
import { DEFAULT_CATALOGUE, PLATFORMS, entriesOf, loadCatalogue, rankEntries, repoVersions } from './lib/catalogue.mjs';

const SPEC = {
  name: 'find-fix',
  summary: 'Finds known failures by error text (--text), in a log file (--log) or by id (--id), and prints symptom, cause, fix, status, platform and the skill that owns the fix.',
  usage: '[repo-root] (--text "<error text>" | --log <file> | --id <catalogue-id>)... [options]',
  options: {
    text: { type: 'string', multiple: true, value: 'text', help: 'Error text or a description of what you see (pattern and keyword match)' },
    log: { type: 'string', multiple: true, value: 'file', help: 'A log file; only the error patterns are matched (no keywords)' },
    id: { type: 'string', multiple: true, value: 'id', help: 'Print this catalogue entry' },
    area: { type: 'string', value: 'area', help: 'Limit to one area (build, ios, android, release, deps, lint, testing, e2e, animation, i18n, services, state, gates, perf, parity, skills, games, runtime)' },
    platform: { type: 'string', value: 'ios|android', help: 'Leave out entries that happen only on the other platform' },
    limit: { type: 'string', default: '5', value: 'n', help: 'Most entries to print per query (default 5)' },
    catalogue: { type: 'string', value: 'dir', help: "Catalogue folder (default: this skill's assets/known-failures/)" },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'The optional repo root (default .) is read only for its package versions: an entry whose appliesTo',
    'excludes the installed version is ranked after the ones that apply and says why. A root that is given',
    'must exist (exit 2); without a package.json there the lookup still works, unranked by version.',
    'A --text query matches an entry when one of its error patterns matches, or when at least half of the',
    "query's words (and at least two) are whole words of the entry's id, topic, symptom and cause.",
    'A pattern hit prints MATCH (a diagnosis); a keyword-only hit prints MATCH? (a lead: confirm the symptom',
    'before acting; it never says "stop and ask a human").',
    'Rule: no-known-fix  nothing in the catalogue matched (exit 1)',
  ].join('\n'),
};

function print(item) {
  const { entry, mismatch, kind } = item;
  const platform = entry.platforms ? ` ${entry.platforms.join('+')} only` : '';
  const skill = entry.skill ? ` skill: ${entry.skill}` : '';
  // Only an error-pattern hit is a diagnosis. A keyword-only hit is a lead: it never says "stop and ask a human".
  if (kind === 'keyword') console.log(`MATCH? ${entry.id} [${entry.status} | keyword match: confirm the symptom before acting]${platform}${skill}`);
  else console.log(`MATCH ${entry.id} [${entry.status}${entry.needsHuman ? ' | stop and ask a human' : ''}]${platform}${skill}`);
  if (mismatch) console.log(`  note:    may not apply here (${mismatch})`);
  console.log(`  symptom: ${entry.symptom}`);
  console.log(`  cause:   ${entry.cause}`);
  console.log(`  fix:     ${entry.fix}`);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (options.text.length + options.log.length + options.id.length === 0) fail('nothing to look up: pass --text, --log or --id', 'Example: find-fix.mjs --text "errSecInternalComponent".');
  if (options.platform && !PLATFORMS.includes(options.platform)) fail(`--platform ${options.platform} is not ios or android`, 'Pass --platform ios or --platform android.');
  const limit = Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1) fail(`--limit ${options.limit} is not a positive whole number`, 'Pass --limit 5, for example.');
  const catalogue = loadCatalogue(resolve(options.catalogue ?? DEFAULT_CATALOGUE));
  const all = entriesOf(catalogue);
  if (options.area && !(options.area in (catalogue.index?.areas ?? {}))) fail(`--area ${options.area} is not an area of the catalogue`, `Use one of: ${Object.keys(catalogue.index?.areas ?? {}).join(', ')}.`);
  const entries = all.filter((entry) => (!options.area || entry.area === options.area) && (!options.platform || !entry.platforms || entry.platforms.includes(options.platform)));
  // An explicit repo root must exist (bad input, exit 2); the default '.' may be any folder (no package.json: no version ranking).
  const versions = repoVersions(positionals[0] === undefined ? resolve('.') : requireDir(positionals[0], 'repo root'));
  const report = createReporter({ name: 'find-fix', json: options.json });
  const queries = [
    ...options.text.map((text) => ({ label: `text "${text.slice(0, 60)}"`, body: text, keywords: true })),
    ...options.log.map((file) => {
      if (!existsSync(file)) fail(`nothing to check: log ${file} does not exist`, 'Pass the log that the failing step wrote.');
      return { label: `log ${file}`, body: readFileSync(file, 'utf8'), keywords: false };
    }),
  ];
  for (const id of options.id) {
    const entry = all.find((item) => item.id === id);
    if (entry) print({ entry, mismatch: null, kind: 'id' });
    else report.problem({ file: '', rule: 'no-known-fix', message: `no catalogue entry ${id}`, fix: 'Check the id printed by check-known-pitfalls.mjs, or search with --text.' });
  }
  for (const query of queries) {
    const ranked = rankEntries(entries, query.body, { keywords: query.keywords, versions }).slice(0, limit);
    if (ranked.length === 0) {
      report.problem({ file: '', rule: 'no-known-fix', message: `nothing known matches ${query.label}`, fix: 'Diagnose from the full log (references/diagnosing-new-failures.md); once solved, add an entry to assets/known-failures/<area>.json and run check-catalogue.mjs --write.' });
      continue;
    }
    console.log(`${query.label}: ${ranked.length} known failure(s)`);
    ranked.forEach(print);
  }
  return report.finish({ checked: queries.length + options.id.length, unit: 'queries' });
});
