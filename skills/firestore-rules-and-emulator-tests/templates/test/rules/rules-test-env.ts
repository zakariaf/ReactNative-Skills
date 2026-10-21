// test/rules/rules-test-env.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/app';

/**
 * The emulator project id. A `demo-` id has no real project behind it, so the emulators never call
 * a production service with it; it equals the `--project` of `npm run test:rules`.
 */
export const RULES_TEST_PROJECT_ID = 'demo-tasks';

/** The rules each service is tested with: the files firebase.json deploys. */
const RULES_FILES = { firestore: 'firestore.rules', storage: 'storage.rules' } as const;

export type RulesService = keyof typeof RULES_FILES;

const REPO_ROOT = join(__dirname, '..', '..');

/**
 * Starts a test environment for one service with the repo's rules loaded into the running emulator.
 * Hosts and ports come from `firebase emulators:exec` (FIREBASE_EMULATOR_HUB), so none is written
 * here; outside `emulators:exec` this rejects because no emulator is reachable.
 */
export function createRulesTestEnvironment(service: RulesService): Promise<RulesTestEnvironment> {
  // Every denied request is a warning in the SDK's log; the denials are the point of these tests.
  setLogLevel('error');
  const rules = readFileSync(join(REPO_ROOT, RULES_FILES[service]), 'utf8');
  return initializeTestEnvironment(
    service === 'firestore'
      ? { projectId: RULES_TEST_PROJECT_ID, firestore: { rules } }
      : { projectId: RULES_TEST_PROJECT_ID, storage: { rules } },
  );
}
