#!/usr/bin/env node
// check-budgets.mjs: checks that quality-gates.json carries every performance budget and that none
// is looser than this skill's starting value, unless the reviewer approved that exact change (--allow).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-budgets.mjs [repo-root] [--allow <key>]...

import { resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, run } from './check-lib.mjs';
import { GATES_FILE, PERF_BUDGETS, readGates } from './lib/budgets.mjs';

const SPEC = {
  name: 'check-budgets',
  summary: 'Checks the "perf" section of quality-gates.json: every budget present, a positive number, known, and not looser than the starting value.',
  usage: '[repo-root] [--allow <key>]...',
  options: {
    allow: { type: 'string', multiple: true, value: 'key', help: 'A budget the reviewer approved loosening (with a device report and the Gate-Change: trailer)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  budget-missing   the "perf" section or one of its keys is absent, or not a positive number',
    '  budget-looser    a budget is looser than its starting value (tightening is always fine)',
    '  budget-unknown   a perf key this skill does not know (a typo, or a budget nothing reads)',
    '',
    'Budgets and starting values:',
    ...Object.entries(PERF_BUDGETS).map(([key, [value, dir, what]]) => `  ${key.padEnd(30)} ${dir} ${String(value).padEnd(8)} ${what}`),
    '',
    'Example: node check-budgets.mjs . --allow memoryFootprintMbMax',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const read = readGates(root);
  if (read === null) fail(`nothing to check: ${GATES_FILE} does not exist in ${positionals[0] ?? '.'}`, 'Run from the app repo root; quality-gates creates quality-gates.json (merge assets/perf-budgets.json into its "perf").');
  const unknownAllow = options.allow.filter((key) => !Object.hasOwn(PERF_BUDGETS, key));
  if (unknownAllow.length > 0) fail(`--allow names unknown budgets: ${unknownAllow.join(', ')}`, `Use one of: ${Object.keys(PERF_BUDGETS).join(', ')}.`);
  const report = createReporter({ name: 'check-budgets', json: options.json });
  const { perf } = read.gates;
  if (!perf || typeof perf !== 'object' || Array.isArray(perf)) {
    report.problem({ file: GATES_FILE, line: 1, rule: 'budget-missing', message: `${GATES_FILE} has no "perf" section`, fix: 'Add the "perf" section from assets/perf-budgets.json (with the Gate-Change: trailer quality-gates asks for).' });
    return report.finish({ checked: 1, unit: 'gate files' });
  }
  const lineOfKey = (key) => {
    const index = read.text.indexOf(`"${key}"`);
    return index === -1 ? 1 : read.text.slice(0, index).split('\n').length;
  };
  for (const [key, [value, direction]] of Object.entries(PERF_BUDGETS)) {
    const got = perf[key];
    if (typeof got !== 'number' || !(got > 0)) {
      report.problem({ file: GATES_FILE, line: lineOfKey(key), rule: 'budget-missing', message: `perf.${key} is ${JSON.stringify(got)}`, fix: `Set "${key}": ${value} (or a tighter value a device report supports).` });
      continue;
    }
    const isLooser = direction === 'max' ? got > value : got < value;
    if (isLooser && !options.allow.includes(key)) {
      report.problem({ file: GATES_FILE, line: lineOfKey(key), rule: 'budget-looser', message: `perf.${key} is ${got}, looser than the starting value ${value}`, fix: `Restore ${value}, or fix the work. Loosening needs a device report that justifies it, the reviewer's approval, the Gate-Change: trailer, and --allow ${key}.` });
    } else if (isLooser) {
      report.note(`perf.${key} = ${got} is looser than ${value} (allowed by --allow ${key})`);
    }
  }
  for (const key of Object.keys(perf).filter((name) => !Object.hasOwn(PERF_BUDGETS, name))) {
    report.problem({ file: GATES_FILE, line: lineOfKey(key), rule: 'budget-unknown', message: `perf.${key} is not a known budget`, fix: `Use one of: ${Object.keys(PERF_BUDGETS).join(', ')}.` });
  }
  return report.finish({ checked: Object.keys(PERF_BUDGETS).length, unit: 'budgets' });
});
