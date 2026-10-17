#!/usr/bin/env node
// check-reminder-logic.mjs: runs an Expo app's own pure reminder modules (wall clock, planner,
// reconcile, tap data) against the local-notification rules: DST-safe wall-clock times, stable
// identifiers that change on every edit, the nearest occurrences within the iOS limit, nothing in
// the past, rows rejected without stopping the plan, minimal tap data, and a diff that touches only
// the planner's own notifications. The modules are imported as pure TypeScript (Node type
// stripping), so a module that reaches React Native or Expo cannot load.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-reminder-logic.mjs [repo-root]

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';
import { enableAppImports, errorText, lineOfExport, reasonOf } from './lib/app-modules.mjs';
import { REMINDER_CHECKS } from './lib/reminder-checks.mjs';
import { coreModules, hasSdk, readManifest, reminderPaths, SDK } from './lib/reminder-paths.mjs';

const SPEC = {
  name: 'check-reminder-logic',
  summary: 'Runs the app\'s pure reminder modules (wall-clock, plan-reminders, reconcile-reminders, reminder-tap) against the rules: DST-safe times, stable identifiers that change on an edit, at most 64 nearest occurrences, nothing in the past, rejected rows, minimal tap data, a diff that touches only its own notifications.',
  usage: '[repo-root] [options]',
  options: {
    'core-dir': { type: 'string', value: 'dir', help: 'The pure reminder planner folder (default: <coreDir>/reminders; rn-skills.config.json "remindersCoreDir")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: missing-module, module-load, wall-clock-dst, plan-dst, plan-idempotent, plan-edit,',
    'plan-max-pending, plan-past, plan-skip, plan-reject, plan-data, reconcile-diff, tap-parse.',
    'Modules (in the planner folder): wall-clock.ts (instantOfWallClock), plan-reminders.ts (planReminders,',
    'REMINDER_ID_PREFIX, IOS_PENDING_LIMIT), reconcile-reminders.ts (reconcileReminders), reminder-tap.ts',
    '(parseReminderTap, reminderTapData). As soon as one exists, all four are required.',
    `NOT APPLICABLE when ${SDK} is not in package.json, or when none of the four modules exists and the`,
    'local notifications folder does not exist either (a push-only app).',
    'A root without a source folder (src/ by default) is bad input (exit 2).',
    'Example: node check-reminder-logic.mjs .',
  ].join('\n'),
};

const short = (value) => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
};

/** The failed assertion's label, with what was expected and what the module gave. */
function explain(error) {
  const label = reasonOf(error);
  if (error?.code !== 'ERR_ASSERTION' || error.generatedMessage === true || !('actual' in error) || typeof error.actual === 'boolean') return label;
  return `${label} (expected ${short(error.expected)}, got ${short(error.actual)})`;
}

/** One line naming why an app module could not be imported, without absolute paths. */
function loadReason(error, root) {
  return errorText(error).split(root).join('.').replace(/ imported from \S+/, '').split('\n')[0];
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root);
  requireDir(join(root, layout.srcDir), `app source folder ${layout.srcDir}/`);
  const report = createReporter({ name: 'check-reminder-logic', json: options.json });
  if (!hasSdk(readManifest(root))) return report.notApplicable(`${SDK} is not in package.json`);
  const paths = reminderPaths(layout, options);
  const modules = coreModules(paths);
  const present = Object.values(modules).filter((rel) => existsSync(join(root, rel)));
  if (present.length === 0 && !existsSync(join(root, paths.notificationsDir))) {
    return report.notApplicable(`${SDK} is installed but the app has no local reminders (no ${paths.coreDir}/ modules and no ${paths.notificationsDir}/)`);
  }
  const app = enableAppImports(root, { aliases: layout.aliases });
  const loaded = {};
  for (const [key, rel] of Object.entries(modules)) {
    if (!existsSync(join(root, rel))) {
      report.problem({ file: rel, rule: 'missing-module', message: `the ${key} module is missing`, fix: `Copy templates/${rel.replace(/^.*?src\//, 'src/')} from this skill (with its test) and adapt it; the checks call its exports by name (references/checkers.md).` });
      continue;
    }
    try {
      loaded[key] = await app.load(rel);
    } catch (error) {
      report.problem({ file: rel, line: 1, rule: 'module-load', message: `cannot be imported: ${loadReason(error, root)}`, fix: 'Keep the module pure TypeScript: types, other pure modules and src/core/dates/date-key.ts only (no React, React Native, Expo or app layers), no enums or namespaces.' });
    }
  }
  let checked = 0;
  const failed = new Set();
  for (const check of REMINDER_CHECKS) {
    if (!check.needs.every((key) => loaded[key] !== undefined)) continue;
    // A check built on another one's behaviour waits until that one passes (one bug, one problem).
    const blocker = (check.after ?? []).find((rule) => failed.has(rule));
    if (blocker !== undefined) {
      report.note(`${check.rule} not run: it builds on ${blocker}, which failed`);
      continue;
    }
    checked += 1;
    try {
      check.run(loaded, { deepStrictEqual, ok, strictEqual });
    } catch (error) {
      failed.add(check.rule);
      const rel = modules[check.needs.at(-1)];
      const line = lineOfExport(readFileSync(join(root, rel), 'utf8'), check.fn);
      report.problem({ file: rel, line, rule: check.rule, message: `${check.fn}: ${explain(error)}`, fix: check.fix });
    }
  }
  return report.finish({ checked, unit: 'checks' });
});
