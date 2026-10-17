// reminder-paths.mjs: where an app keeps its reminder code, and whether the checks apply at all
// (a helper of check-reminder-code.mjs and check-reminder-logic.mjs, not an entry point).
//
// Folders come from check-lib's resolveLayout (rn-skills.config.json and tsconfig aliases), plus two
// keys this skill documents in references/checkers.md:
//   "remindersCoreDir":      the pure planner folder        (default <coreDir>/reminders)
//   "localNotificationsDir": the port, adapter, fake, sync  (default <servicesDir>/local-notifications)
// Command-line options win over the config file.

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError } from '../check-lib.mjs';

export const SDK = 'expo-notifications';

/** The repo's package.json, or null when there is none. */
export function readManifest(root) {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`package.json is not valid JSON: ${error.message}`, 'Fix package.json, then rerun.');
  }
}

/** True when expo-notifications is a dependency (runtime or dev). */
export function hasSdk(manifest) {
  if (manifest === null) return false;
  return [manifest.dependencies, manifest.devDependencies].some((deps) => deps !== undefined && deps !== null && Object.hasOwn(deps, SDK));
}

const relDir = (value, what) => {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.split('/').includes('..')) {
    throw new UsageError(`${what} must be a repo-relative folder, got ${JSON.stringify(value)}`, `Set ${what} to a folder such as src/core/reminders.`);
  }
  return posix.normalize(value.replace(/\/+$/, ''));
};

/** { coreDir, notificationsDir, hooksDir } as repo-relative posix folders. */
export function reminderPaths(layout, options = {}) {
  const config = layout.config ?? {};
  const coreDir = options['core-dir'] ?? config.remindersCoreDir ?? `${layout.coreDir}/reminders`;
  const notificationsDir = options['services-dir'] ?? config.localNotificationsDir ?? `${layout.servicesDir}/local-notifications`;
  return {
    coreDir: relDir(coreDir, 'remindersCoreDir'),
    notificationsDir: relDir(notificationsDir, 'localNotificationsDir'),
    hooksDir: `${layout.srcDir}/hooks`,
  };
}

/** The pure modules check-reminder-logic runs, by key. */
export function coreModules(paths) {
  return {
    wallClock: `${paths.coreDir}/wall-clock.ts`,
    plan: `${paths.coreDir}/plan-reminders.ts`,
    reconcile: `${paths.coreDir}/reconcile-reminders.ts`,
    tap: `${paths.coreDir}/reminder-tap.ts`,
  };
}
