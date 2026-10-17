#!/usr/bin/env node
// sync-shared.mjs: copies the canonical shared files into every skill that declares them in
// assets/shared.json, or (--check) fails when a copy is missing or has drifted.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMON_OPTIONS, MANIFEST_PATH, compareShared, defaultTargets, readManifest, resolveRoots, resolveTargets, syncShared, targetLabel } from './lib/library.mjs';
import { createReporter, parseArgs, run } from './shared/scripts/check-lib.mjs';

const SPEC = {
  name: 'sync-shared',
  summary: 'Copies files from tools/shared/ into each skill that lists them in assets/shared.json. With --check it changes nothing and fails on any missing, changed or extra copy. With no skill arguments it covers every skill folder in skills/.',
  usage: '[options] [skill-name-or-path...]',
  options: {
    ...COMMON_OPTIONS,
    check: { type: 'boolean', help: 'Report drift instead of fixing it (exit 1 on any drift)' },
  },
  positionals: { min: 0, max: Infinity },
  details: [
    'assets/shared.json format (a JSON array):',
    '  [',
    '    { "from": "scripts/check-lib.mjs", "to": "scripts/check-lib.mjs" },',
    '    { "from": "scripts/lib/source-scan.mjs", "to": "scripts/lib/source-scan.mjs" },',
    '    { "from": "repo-templates/__mocks__/", "to": "templates/__mocks__/" }',
    '  ]',
    '"from" is relative to the shared folder, "to" is relative to the skill folder.',
    'A folder entry ends both paths with "/" and mirrors the folder (extra files in the copy are removed).',
  ].join('\n'),
};

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const roots = resolveRoots(options);
  const targets = positionals.length ? resolveTargets(positionals, roots) : defaultTargets(roots);
  const report = createReporter({ name: 'sync-shared' });
  let checked = 0;
  for (const target of targets) {
    const label = targetLabel(target);
    const manifest = readManifest(target.dir, roots.shared);
    if (!manifest.exists) {
      console.log(`skip  ${label} (no ${MANIFEST_PATH})`);
      continue;
    }
    checked += 1;
    for (const error of manifest.errors) {
      report.problem({ file: `${label}/${MANIFEST_PATH}`, rule: 'shared-json', message: error, fix: 'Use [{ "from": "<path in the shared folder>", "to": "<path in this skill>" }]; see --help.' });
    }
    if (manifest.errors.length) {
      console.log(`FAIL  ${label} (invalid ${MANIFEST_PATH})`);
      continue;
    }
    if (options.check) {
      const findings = compareShared(target.dir, manifest.entries, roots.shared);
      for (const finding of findings) {
        const message = finding.kind === 'missing' ? `missing copy of shared ${finding.from}` : finding.kind === 'drift' ? `differs from the canonical shared ${finding.from}` : `extra file in the mirrored folder ${finding.from}`;
        report.problem({ file: `${label}/${finding.rel}`, rule: 'shared-drift', message, fix: 'Run: node tools/sync-shared.mjs' });
      }
      console.log(`${findings.length ? 'FAIL' : 'ok  '}  ${label} (${manifest.entries.length} entries${findings.length ? `, ${findings.length} drifted` : ''})`);
      continue;
    }
    const result = syncShared(target.dir, manifest.entries, roots.shared);
    const changes = [...result.copied.map((rel) => `copied ${rel}`), ...result.removed.map((rel) => `removed ${rel}`)];
    console.log(`${changes.length ? 'sync' : 'ok  '}  ${label} (${result.unchanged} unchanged${changes.length ? `; ${changes.join(', ')}` : ''})`);
  }
  return report.finish({ checked, unit: 'skills with assets/shared.json' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(main);
