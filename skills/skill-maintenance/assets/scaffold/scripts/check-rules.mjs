#!/usr/bin/env node
// check-rules.mjs: fails when a source file contains a pattern this skill forbids. Each rule names
// the files it applies to (globs relative to the repo root), the pattern (matched with comments
// blanked out), the message and the fix. Run from the repo root:
//   node <this skill>/scripts/check-rules.mjs [repo-root]
// The scan uses walkRepo: it skips node_modules, generated native and build output, and every
// installed skill (skills/, .agents/, .claude/ and any folder holding a SKILL.md), whose fixtures
// plant these patterns on purpose.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, lineOf, maskComments, matchGlob, parseArgs, requireDir, run, walkRepo } from './check-lib.mjs';

/** One entry per rule. include: globs relative to the repo root ("*.ts" matches at any depth). */
const RULES = [
  {
    id: '__FILL_RULE_ID__',
    include: ['*.ts', '*.tsx'],
    pattern: /__FILL_PATTERN__/,
    message: '__FILL_WHAT_IS_WRONG__',
    fix: '__FILL_HOW_TO_FIX_IT__',
  },
];

const SPEC = {
  name: 'check-rules',
  summary: 'Fails when a source file contains a pattern this skill forbids; every problem names the file, the line, the rule and the fix.',
  usage: '[repo-root] [options]',
  options: {
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: ['Rules:', ...RULES.map((rule) => `  ${rule.id}  ${rule.message}`)].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: 'check-rules', json: options.json });
  const files = walkRepo(root, { include: [...new Set(RULES.flatMap((rule) => rule.include))] });
  for (const rel of files) {
    const text = maskComments(readFileSync(join(root, rel), 'utf8'));
    for (const rule of RULES.filter((item) => item.include.some((glob) => matchGlob(rel, glob)))) {
      const match = rule.pattern.exec(text);
      if (match) report.problem({ file: rel, line: lineOf(text, match.index), rule: rule.id, message: rule.message, fix: rule.fix });
    }
  }
  return report.finish({ checked: files.length, unit: 'files' });
});
