#!/usr/bin/env node
// build-index.mjs: renders the index's generated parts from every skill's frontmatter and the curated
// assets/index.json: references/skill-table.md, references/intent-map.md, references/task-matrix.md,
// references/build-orders.md and the quick task table in SKILL.md. With --catalog it first takes the
// categories, plugins and manual flags from the library's catalogue file, so the catalogue stays the one
// source. Without --write it only reports what would change (exit 1 when anything is stale).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, requireFile, run } from './check-lib.mjs';
import { DATA_FILE, INDEX_NAME, SKILL_DIR, catalogSnapshot, detectMode, findSkillsRoot, namedSkills, readIndexData, readSkills, renderAll } from './lib/index-model.mjs';
import { catalogDrift, readCatalogFile } from './lib/catalog-sync.mjs';

const SPEC = {
  name: 'build-index',
  summary:
    'Renders the skill catalogue, the intent map, the task matrix, the build orders and the quick table in SKILL.md ' +
    'from every skill\'s frontmatter and assets/index.json (and, with --catalog, the library catalogue). Without ' +
    '--write it writes nothing and fails when a file is stale.',
  usage: '[repo-root] [--skills-root <dir>] [--index <dir>] [--catalog <file>] [--write | --check]',
  options: {
    'skills-root': { type: 'string', value: 'dir', help: 'The folder that holds the skills (default: skills/ or an agent skills folder of the repo root)' },
    index: { type: 'string', value: 'dir', help: `The index skill to render into (default: <skills-root>/${INDEX_NAME}, else this skill)` },
    catalog: { type: 'string', value: 'file', help: 'The library catalogue file (a JSON { categories, skills } list): categories, plugins and manual flags come from it' },
    write: { type: 'boolean', help: 'Write the generated files and the catalogue snapshot (only when the data names real skills)' },
    check: { type: 'boolean', help: 'Write nothing; exit 1 when anything is stale (the default without --write; for CI)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  index-data        assets/index.json is missing or has the wrong shape',
    '  catalog-drift     (--catalog) the catalogue snapshot in assets/index.json differs from the catalogue file',
    '  skill-stale       the data names a skill that does not exist (nothing is written)',
    '  generated-stale   a generated file differs from a fresh render (run with --write)',
    '  generated-missing SKILL.md lacks the generated-block markers',
    '',
    'The repo root (default .) is searched for the skills folder: skills/, then .agents/skills/, .claude/skills/ and',
    'the other agent folders. A repo without any skills folder prints NOT APPLICABLE, and so does an app: a skills',
    'folder inside an agent folder, or one that does not hold the index skill, holds installed skills (the index',
    'is generated only in the library; an app runs check-index.mjs).',
    'Run it after adding, removing or renaming a skill, after changing any skill\'s description or the catalogue,',
    'and after editing assets/index.json; then run check-index.mjs.',
    '',
    'Examples:',
    '  node build-index.mjs .                                         (report what is stale; writes nothing)',
    '  node build-index.mjs . --catalog <catalogue> --write    (the library: sync the catalogue, render)',
    '  node build-index.mjs . --catalog <catalogue> --check    (CI)',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (options.write && options.check) fail('--write and --check exclude each other', 'Pass one of them.');
  const report = createReporter({ name: SPEC.name, json: options.json });
  const repoRoot = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const skillsRoot = options['skills-root'] !== undefined ? requireDir(resolve(options['skills-root']), 'skills root') : findSkillsRoot(repoRoot);
  if (skillsRoot === null) return report.notApplicable(`no skills folder in ${repoRoot} (skills/, .agents/skills/, .claude/skills/, ...)`);
  const skills = readSkills(skillsRoot);
  if (skills.length === 0) fail(`no skill folders with a SKILL.md in ${skillsRoot}`, 'Pass --skills-root <the folder that holds the skills>.');
  const indexDir = requireDir(resolve(options.index ?? (existsSync(join(skillsRoot, INDEX_NAME, 'SKILL.md')) ? join(skillsRoot, INDEX_NAME) : SKILL_DIR)), 'index skill');
  if (detectMode(skillsRoot, indexDir) === 'installed') return report.notApplicable(`${skillsRoot} holds installed skills; the index is generated in the library (run check-index.mjs instead)`);
  const loaded = readIndexData(indexDir);
  if (loaded.error) {
    report.problem({ file: DATA_FILE, rule: 'index-data', message: loaded.error, fix: 'Restore the shape: plugins, catalog { categories, skills }, tasks, buildOrders (a list of { id, title, intro, steps }), and the optional categoryNotes, rowRules and closure.' });
    return report.finish({ checked: 0, unit: 'generated files' });
  }
  const data = loaded.data;
  let checked = 0;
  if (options.catalog !== undefined) {
    const catalog = readCatalogFile(requireFile(resolve(options.catalog), 'catalogue'));
    const drift = catalogDrift(data, catalog);
    checked += 1;
    if (drift.length > 0) {
      if (options.write) {
        data.catalog = catalogSnapshot(catalog);
        writeFileSync(join(indexDir, DATA_FILE), `${JSON.stringify(data, null, 2)}\n`);
        report.note(`wrote ${DATA_FILE} (catalogue snapshot: ${drift.length} change${drift.length === 1 ? '' : 's'})`);
      } else {
        for (const item of drift) report.problem({ file: DATA_FILE, rule: 'catalog-drift', message: item, fix: 'Run node build-index.mjs . --catalog <catalogue> --write (never edit the snapshot by hand).' });
      }
    }
  }
  const known = new Set(skills.map((skill) => skill.folder));
  const stale = namedSkills(data).filter((entry) => !known.has(entry.name));
  for (const entry of stale) report.problem({ file: DATA_FILE, rule: 'skill-stale', message: `${entry.where} names ${entry.name}, which is not a skill in ${skillsRoot}`, fix: 'Use the skill\'s exact name, or remove the entry; nothing was written.' });
  for (const [rel, content] of Object.entries(renderAll(indexDir, data, skills))) {
    checked += 1;
    if (content === null) {
      report.problem({ file: rel, rule: 'generated-missing', message: 'SKILL.md has no generated-block markers for the quick task table', fix: 'Restore the two generated:task-table marker comments in SKILL.md, then rerun with --write.' });
      continue;
    }
    const path = join(indexDir, rel);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === content) continue;
    if (options.write && stale.length === 0) {
      writeFileSync(path, content);
      report.note(`wrote ${rel}`);
    } else {
      report.problem({ file: rel, rule: 'generated-stale', message: current === null ? 'does not exist yet' : 'differs from a fresh render (a description, a skill or the data changed)', fix: 'Run node build-index.mjs . --write, then check-index.mjs.' });
    }
  }
  report.note(`${skills.length} skills, ${data.tasks.length} task rows, ${data.buildOrders.length} build orders (${data.buildOrders.reduce((sum, order) => sum + order.steps.length, 0)} steps)`);
  return report.finish({ checked, unit: 'generated files' });
});
