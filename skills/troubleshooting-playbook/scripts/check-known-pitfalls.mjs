#!/usr/bin/env node
// check-known-pitfalls.mjs: scans the app repo for the known failures that can be seen in files
// before they happen (a Metro cache without the variant key, a selector that loops, an adb call
// without a serial, a Jest config that drops rules ...). Every finding names its catalogue id, so
// find-fix.mjs --id <id> prints the full entry.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-known-pitfalls.mjs .
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, requireFile, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { DEFAULT_CATALOGUE, entriesOf, loadCatalogue } from './lib/catalogue.mjs';
import { PITFALLS, layoutGlobs } from './lib/pitfalls.mjs';

const SPEC = {
  name: 'check-known-pitfalls',
  summary: 'Scans an app repo for known failures that are visible in its files; each finding names the catalogue id with its cause and fix.',
  usage: '[repo-root] [options]',
  options: {
    only: { type: 'string', multiple: true, value: 'id', help: 'Run only these catalogue ids (repeatable)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (catalogue ids):',
    ...PITFALLS.map((pitfall) => `  ${pitfall.id}`),
    '',
    'Paths come from resolveLayout (src/, scripts/, .maestro/, contracts/ by default; tsconfig paths,',
    'package.json workspaces and rn-skills.config.json keys srcDir, scriptsDir, e2eDir, configDir,',
    'servicesDir and contractsDir move them). The repo walk skips node_modules, generated ios/ and android/,',
    'build output, .stryker-tmp, reports/ and every folder that holds a SKILL.md (installed skills plant',
    'these bugs on purpose). Rules about runtime code skip test files and __mocks__.',
    '',
    'Each finding prints the catalogue fix and cause; find-fix.mjs --id <id> prints the full entry.',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  requireFile(join(root, 'package.json'), 'root package.json (run from the app repo root)');
  const unknown = options.only.filter((id) => !PITFALLS.some((pitfall) => pitfall.id === id));
  if (unknown.length > 0) fail(`--only names no pitfall rule: ${unknown.join(', ')}`, 'Run --help for the list of rule ids.');
  const byId = new Map(entriesOf(loadCatalogue(DEFAULT_CATALOGUE)).map((entry) => [entry.id, entry]));
  const layout = resolveLayout(root);
  const files = walkRepo(root, {
    ignore: ['.stryker-tmp/**', 'reports/**', 'dist-audit/**'],
    include: ['*.ts', '*.tsx', '*.mts', '*.js', '*.mjs', '*.cjs', '*.json', '*.yaml', '*.yml', '*.plist', '*.sh'],
  });
  const cache = new Map();
  const ctx = { root, layout, files, globs: layoutGlobs(layout), read: (rel) => cache.get(rel) ?? cache.set(rel, readFileSync(join(root, rel), 'utf8')).get(rel) };
  const report = createReporter({ name: 'check-known-pitfalls', json: options.json });
  const rules = options.only.length > 0 ? PITFALLS.filter((pitfall) => options.only.includes(pitfall.id)) : PITFALLS;
  for (const pitfall of rules) {
    const entry = byId.get(pitfall.id);
    for (const finding of pitfall.detect(ctx)) {
      report.problem({ file: finding.file, line: finding.line, rule: pitfall.id, message: finding.message, fix: entry ? `${entry.fix} (cause: ${entry.cause})` : 'See find-fix.mjs --id.' });
    }
  }
  return report.finish({ checked: files.length, unit: `files against ${rules.length} known pitfalls` });
});
