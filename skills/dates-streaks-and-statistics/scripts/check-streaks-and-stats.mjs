#!/usr/bin/env node
// check-streaks-and-stats.mjs: runs an Expo app's own streak, statistics, summary and completion
// modules against the rules: first event of a day, "active yesterday or today", a clock set back,
// pruning that never shortens a count, a derived streak that agrees with the stored one, statistics
// folds, summaries that hand screens finished numbers, and one fold per completion. The modules are
// imported as pure TypeScript (Node type stripping), so a module that reaches React Native cannot load.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-streaks-and-stats.mjs [repo-root]

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';
import { enableAppImports, lineOfExport, reasonOf } from './lib/app-modules.mjs';
import { MODULE_KEYS, contractPathOf, defaultModules, readDayLogicContract } from './lib/day-logic-contract.mjs';
import { describeLoadError, loadFix } from './lib/load-error.mjs';
import { STATS_CHECKS } from './lib/stats-checks.mjs';
import { STREAK_CHECKS } from './lib/streak-checks.mjs';

const SPEC = {
  name: 'check-streaks-and-stats',
  summary: 'Runs the app\'s streak, statistics, summary and completion modules against the calendar-day rules (first event of a day, active yesterday or today, clock set back, pruning, derived streaks, statistics folds, summaries, one fold per completion).',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The day-logic contract (default: contracts/day-logic.json; rn-skills.config.json "dayLogicContract")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: missing-module, module-load, streak-first-of-day, streak-rule, streak-clock-back, streak-prune,',
    'streak-week, streak-derive (when streakOfDays is exported), view-streak, stats-counts, stats-run,',
    'stats-best, stats-days, stats-counters, view-stats, completion-record, fold-immutable.',
    '(The countdown, view-countdown, is checked by check-calendar-code with the day hooks.)',
    '',
    'Modules (contract key: default path): dayStreak: src/core/streaks/day-streak.ts, streakSummary:',
    'src/core/streaks/streak-summary.ts, activityStats: src/core/stats/activity-stats.ts, statsSummary:',
    'src/core/stats/stats-summary.ts, recordCompletion: src/core/stats/record-completion.ts.',
    'With contracts/day-logic.json every module it names is required and null means the app has none;',
    'a module whose dependency is null (streakSummary or recordCompletion without dayStreak, statsSummary or',
    'recordCompletion without activityStats) is bad input (exit 2): the templates could never compile that way.',
    'Without it, the defaults are required as soon as one of them exists, and when none exists the check',
    'prints NOT APPLICABLE. A contract that sets every module to null is NOT APPLICABLE too.',
    'A root without a source folder (src/ by default) is bad input (exit 2), never NOT APPLICABLE.',
    'When multi-package: run once per app, with the app folder as the root.',
    'Example: node check-streaks-and-stats.mjs .',
  ].join('\n'),
};

const CHECKS = [...STREAK_CHECKS, ...STATS_CHECKS];

const short = (value) => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
};

/** The failed assertion's label, with what was expected and what the module gave. */
function explain(error) {
  const label = reasonOf(error);
  if (error?.code !== 'ERR_ASSERTION' || error.generatedMessage === true || !('actual' in error) || typeof error.actual === 'boolean') return label;
  return `${label} (expected ${short(error.expected)}, got ${short(error.actual)})`;
}

/** { key: path } of the modules this app must have, or { notApplicable: reason }. */
function modulesToCheck(root, layout, contract, contractRel) {
  if (contract !== null) {
    const named = Object.fromEntries(Object.entries(contract.modules).filter(([, path]) => path !== null));
    if (Object.keys(named).length === 0) return { notApplicable: `${contractRel} sets every module to null` };
    return { modules: named };
  }
  const defaults = defaultModules(layout);
  if (!Object.values(defaults).some((rel) => existsSync(join(root, rel)))) {
    return { notApplicable: `no streak or statistics module: ${contractRel} is absent and none of ${Object.values(defaults).join(', ')} exists` };
  }
  return { modules: defaults };
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root);
  // A folder that is not an app (or the wrong working directory) is bad input, never NOT APPLICABLE.
  requireDir(join(root, layout.srcDir), `app source folder ${layout.srcDir}/`);
  const contractRel = contractPathOf(layout, options.contract);
  const contract = readDayLogicContract(root, contractRel);
  const report = createReporter({ name: 'check-streaks-and-stats', json: options.json });
  const plan = modulesToCheck(root, layout, contract, contractRel);
  if (plan.notApplicable) return report.notApplicable(plan.notApplicable);
  const app = enableAppImports(root, { aliases: layout.aliases });
  const loaded = {};
  for (const key of MODULE_KEYS) {
    const rel = plan.modules[key];
    if (rel === undefined) continue;
    if (!existsSync(join(root, rel))) {
      const where = contract === null ? `or write ${contractRel} with "${key}": null` : `or set "${key}": null in ${contractRel}`;
      report.problem({ file: rel, rule: 'missing-module', message: `the ${key} module is missing`, fix: `Copy it from the skill templates (templates/${rel.replace(/^.*?src\//, 'src/')}) and adapt it, ${where} when the app has no such module.` });
      continue;
    }
    try {
      loaded[key] = await app.load(rel);
    } catch (error) {
      const reason = describeLoadError(error, root, layout);
      report.problem({ file: rel, line: 1, rule: 'module-load', message: `cannot be imported: ${reason}`, fix: loadFix(reason, 'Keep the module pure: types and other pure modules only (no React, React Native, Expo or app layers), no enums.') });
    }
  }
  let checked = 0;
  for (const check of CHECKS) {
    if (!check.needs.every((key) => loaded[key] !== undefined)) continue;
    if (check.when && !check.when(loaded)) continue;
    checked += 1;
    try {
      check.run(loaded, { deepStrictEqual, ok, strictEqual });
    } catch (error) {
      const rel = plan.modules[check.needs[0]];
      const line = lineOfExport(readFileSync(join(root, rel), 'utf8'), check.fn);
      report.problem({ file: rel, line, rule: check.rule, message: `${check.fn}: ${explain(error)}`, fix: check.fix });
    }
  }
  return report.finish({ checked, unit: 'checks' });
});
