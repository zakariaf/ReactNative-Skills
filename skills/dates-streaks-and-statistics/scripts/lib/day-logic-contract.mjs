// day-logic-contract.mjs: reads the repo-owned contracts/day-logic.json that both checkers of this
// skill share (a helper, not an entry point). The contract says where the app keeps its streak and
// statistics modules (null: the app has no such module) and which extra globs count as day code
// (no wall clock) and UI code (no day arithmetic). A malformed contract is bad input (exit 2).

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { fail } from '../check-lib.mjs';

/** The module keys, in the order the checkers report them. */
export const MODULE_KEYS = Object.freeze(['dayStreak', 'streakSummary', 'activityStats', 'statsSummary', 'recordCompletion']);

const TOP_KEYS = new Set(['$schema', 'modules', 'dayCode', 'uiCode']);

/**
 * The modules each module imports (the templates' import graph): a contract that names a module but
 * sets one it needs to null describes code that cannot compile, so it is bad input.
 */
export const MODULE_NEEDS = Object.freeze({
  streakSummary: Object.freeze({ dayStreak: 'streak-summary.ts reads the streak section through day-streak.ts' }),
  statsSummary: Object.freeze({ activityStats: 'stats-summary.ts reads the ActivityStats section' }),
  recordCompletion: Object.freeze({
    dayStreak: 'record-completion.ts folds the streak with recordDay',
    activityStats: 'record-completion.ts folds the statistics with recordActivity',
  }),
});

const NULL_FIX = {
  dayStreak: 'copy templates/src/core/streaks/ and name day-streak.ts',
  activityStats: 'copy templates/src/core/stats/activity-stats.ts and name it',
};
const DROP_FIX = {
  streakSummary: 'set "streakSummary": null',
  statsSummary: 'set "statsSummary": null',
  recordCompletion: 'set "recordCompletion": null and call recordActivity() in the handler (an app without streaks)',
};

/** The default module paths under the layout's core folder (the skill's templates). */
export function defaultModules(layout) {
  const core = layout.coreDir;
  return {
    dayStreak: posix.join(core, 'streaks', 'day-streak.ts'),
    streakSummary: posix.join(core, 'streaks', 'streak-summary.ts'),
    activityStats: posix.join(core, 'stats', 'activity-stats.ts'),
    statsSummary: posix.join(core, 'stats', 'stats-summary.ts'),
    recordCompletion: posix.join(core, 'stats', 'record-completion.ts'),
  };
}

/** The contract's repo-relative path: --contract, else rn-skills.config.json "dayLogicContract", else <contractsDir>/day-logic.json. */
export function contractPathOf(layout, given) {
  const configured = typeof layout.config?.dayLogicContract === 'string' ? layout.config.dayLogicContract : null;
  return posix.normalize(given ?? configured ?? posix.join(layout.contractsDir, 'day-logic.json'));
}

const isRepoPath = (value) => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.split('/').includes('..');

function globList(data, key, rel) {
  const value = data[key] ?? [];
  if (!Array.isArray(value) || !value.every(isRepoPath)) {
    fail(`${rel}: "${key}" must be a list of repo-relative globs`, `Write "${key}": ["src/features/tasks/**/*.ts"] (or []); see the skill's templates/contracts/day-logic.schema.json.`);
  }
  return value;
}

/**
 * The parsed contract, or null when the file does not exist:
 * { rel, modules: { dayStreak: 'src/...' | null, ... }, dayCode: [globs], uiCode: [globs] }.
 */
export function readDayLogicContract(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  let data;
  try {
    data = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    fail(`${rel} is not valid JSON (${String(error.message).split('\n')[0]})`, 'Fix the JSON; the skill\'s templates/contracts/day-logic.json is a valid starting point.');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) fail(`${rel} must hold a JSON object`, 'Copy templates/contracts/day-logic.json and edit it.');
  const unknown = Object.keys(data).filter((key) => !TOP_KEYS.has(key));
  if (unknown.length > 0) fail(`${rel} has unknown keys: ${unknown.join(', ')}`, `Keep only ${[...TOP_KEYS].join(', ')}.`);
  const modules = data.modules;
  if (modules === null || typeof modules !== 'object' || Array.isArray(modules)) fail(`${rel}: "modules" must be an object`, `Name each of ${MODULE_KEYS.join(', ')} with a repo-relative .ts path or null.`);
  const extra = Object.keys(modules).filter((key) => !MODULE_KEYS.includes(key));
  if (extra.length > 0) fail(`${rel}: unknown module keys: ${extra.join(', ')}`, `The module keys are ${MODULE_KEYS.join(', ')}.`);
  const resolved = {};
  for (const key of MODULE_KEYS) {
    const value = modules[key];
    if (value === undefined) fail(`${rel}: "modules.${key}" is missing`, `Set it to the module's repo-relative path, or to null when the app has no ${key} module.`);
    if (value !== null && !(isRepoPath(value) && value.endsWith('.ts'))) fail(`${rel}: "modules.${key}" must be a repo-relative .ts path or null`, `For example "${key}": "src/core/streaks/day-streak.ts".`);
    resolved[key] = value === null ? null : posix.normalize(value);
  }
  for (const [key, needs] of Object.entries(MODULE_NEEDS)) {
    if (resolved[key] === null) continue;
    for (const [need, why] of Object.entries(needs)) {
      if (resolved[need] !== null) continue;
      fail(`${rel}: "modules.${key}" is set but "modules.${need}" is null (${why})`, `Either ${NULL_FIX[need]}, or ${DROP_FIX[key]}.`);
    }
  }
  return { rel, modules: resolved, dayCode: globList(data, 'dayCode', rel), uiCode: globList(data, 'uiCode', rel) };
}
