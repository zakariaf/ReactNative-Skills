#!/usr/bin/env node
// check-greeting.mjs: checks that every .txt greeting in a folder starts with "Hello".

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, run, walk } from './check-lib.mjs';

const SPEC = {
  name: 'check-greeting',
  summary: 'Checks that every .txt file in the folder starts with "Hello".',
  usage: '[folder]',
  positionals: { min: 0, max: 1 },
};

run(async () => {
  const { positionals } = parseArgs(process.argv.slice(2), SPEC);
  const folder = requireDir(positionals[0] ?? '.', 'folder');
  const report = createReporter({ name: 'check-greeting' });
  const files = walk(folder, { include: ['*.txt'] });
  for (const rel of files) {
    if (!readFileSync(join(folder, rel), 'utf8').startsWith('Hello')) {
      report.problem({ file: rel, line: 1, rule: 'greeting', message: 'does not start with "Hello"', fix: 'Start the greeting with "Hello".' });
    }
  }
  return report.finish({ checked: files.length, unit: 'greetings' });
});
