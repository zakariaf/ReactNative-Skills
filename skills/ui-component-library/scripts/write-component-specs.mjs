#!/usr/bin/env node
// write-component-specs.mjs: writes the app's component-specs.json (default src/ui/component-specs.json):
// the numeric projection of the token file's components block (every size, padding, gap, radius,
// border and elevation a component uses), with token references such as "{spacing.md}" resolved,
// borders floored only when the design's references are browser renders (specs.asRenderedBorders),
// and the catalogue's overrides applied, each with its reason. Components read it through
// COMPONENT_SPECS; nobody edits it by hand, and this script never edits the token file.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/write-component-specs.mjs [repo-root] [--check]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';
import {
  firstDifference, loadContract, overridesWithoutReason, readTokens, specNote, specsConfig, specsFromTokens, specsJsonText,
} from './lib/component-source.mjs';

const SPEC = {
  name: 'write-component-specs',
  summary: 'Writes component-specs.json from the token file\'s components block (numbers only, references resolved, catalogue overrides applied). With --check it only compares.',
  usage: '[repo-root] [options]',
  options: {
    check: { type: 'boolean', help: 'Do not write; fail when the file is missing or differs' },
    tokens: { type: 'string', value: 'file', help: 'Token file (default: specs.tokens in the catalogue, else design/tokens.json)' },
    out: { type: 'string', value: 'file', help: 'Output file (default: specs.out, else <ui folder>/component-specs.json)' },
    contract: { type: 'string', value: 'file', help: 'Catalogue file (default: contracts/component-library.json)' },
    'ui-dir': { type: 'string', value: 'dir', help: 'The shared components folder (default: the catalogue uiDir, else the layout uiDir)' },
    'as-rendered-borders': { type: 'boolean', help: 'Floor CSS borders as a browser draws them (default: specs.asRenderedBorders)' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  specs-mismatch         component-specs.json is missing or differs from the derivation (--check)',
    '  spec-override-reason   a catalogue override has no "why" sentence (nothing is written until it has one)',
    '',
    'NOT APPLICABLE when the catalogue sets "specs": false, or (with --check) when the ui folder exists but',
    'neither the catalogue nor component-specs.json exists yet. A missing ui folder is exit 2 (nothing to check).',
    'Example: node write-component-specs.mjs . --check',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root);
  const contract = loadContract(root, layout, options.contract);
  const uiDir = options['ui-dir'] ?? contract.data?.uiDir ?? layout.uiDir;
  // An empty folder or the wrong directory has nothing to check; NOT APPLICABLE is only for an app
  // whose ui folder exists without a library yet.
  if (!existsSync(join(root, uiDir))) fail(`nothing to check: ${uiDir} does not exist`, 'Run from the app repo root, or pass --ui-dir (a monorepo\'s UI package: packages/ui/src).');
  const report = createReporter({ name: 'write-component-specs' });
  const config = specsConfig(contract.data, uiDir);
  if (config === null) return report.notApplicable(`${contract.rel} sets "specs": false (the components take their sizes from the theme tokens and named constants)`);
  if (options.tokens !== undefined) config.tokens = options.tokens;
  if (options.out !== undefined) config.out = options.out;
  if (options['as-rendered-borders']) config.asRenderedBorders = true;
  for (const override of overridesWithoutReason(config)) {
    report.problem({ file: contract.rel, rule: 'spec-override-reason', message: `the override of ${override.path} gives no reason`, fix: 'Add "why": one sentence naming the design rule or decision that differs from the token file (never an override "to make it fit").' });
  }
  if (report.count > 0) return report.finish({ checked: 1, unit: 'files' });
  if (options.check && !contract.exists && !existsSync(join(root, config.out))) {
    return report.notApplicable(`no component library yet: neither ${contract.rel} nor ${config.out} exists (run without --check to write the specs)`);
  }
  const tokens = readTokens(root, config.tokens);
  const specs = specsFromTokens(tokens, config);
  const expected = specsJsonText(specs);
  const target = join(root, config.out);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (options.check) {
    if (current !== expected) {
      let why = 'is missing';
      if (current !== null) {
        let actual = null;
        try {
          actual = JSON.parse(current);
        } catch {
          why = 'is not valid JSON';
        }
        if (actual !== null) {
          const diff = firstDifference(specs, actual);
          const note = diff ? specNote(tokens, config, diff.path) : null;
          why = diff ? `differs: ${diff.path} is ${diff.actual === undefined ? 'missing' : JSON.stringify(diff.actual)}, the derived spec is ${JSON.stringify(diff.expected)}${note ? ` (${note})` : ''}` : 'differs in formatting only';
        }
      }
      report.problem({ file: config.out, rule: 'specs-mismatch', message: `${why} (derived from ${config.tokens} "${config.block}")`, fix: 'Run write-component-specs.mjs without --check; never edit the JSON by hand (change the token file or add a reasoned override).' });
    }
    return report.finish({ checked: 1, unit: 'files' });
  }
  if (!existsSync(join(root, dirname(config.out)))) fail(`${dirname(config.out)} does not exist`, 'Run from the app repo root, or create the shared components folder first.');
  if (current !== expected) writeFileSync(target, expected);
  report.note(`${current === expected ? 'unchanged' : 'wrote'} ${config.out} (${Object.keys(specs).length} component groups from ${config.tokens})`);
  return report.finish({ checked: 1, unit: 'files' });
});
