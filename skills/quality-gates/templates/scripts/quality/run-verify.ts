// scripts/quality/run-verify.ts
// device-only: covered by npm run verify itself (this file only wires verify-plan.ts to the shell)
// `npm run verify`: every gate except end-to-end flows and mutation testing, cheapest first; it stops
// at the first failure. The steps live in verify-plan.ts (tested there); this file reads the two
// facts the plan needs and spawns each step from the repo root.
import { spawnSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { extraStepsOf, runPlan, verifyPlan, type VerifyStep } from './verify-plan.ts';

/** The same roots jest.sim.config.js runs. */
const SIM_TESTS = ['src/**/*.sim.test.ts', 'test/**/*.sim.test.ts'];
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function execute(step: VerifyStep): number {
  const [command = 'false', ...args] = step.command;
  return spawnSync(command, args, { stdio: 'inherit' }).status ?? 1;
}

function main(): number {
  process.chdir(REPO_ROOT);
  const extra = extraStepsOf(JSON.parse(readFileSync('quality-gates.json', 'utf8')) as unknown);
  if (!extra.ok) {
    console.error(`verify: ${extra.message}. Fix quality-gates.json (a gate change).`);
    return 1;
  }
  const hasSims = SIM_TESTS.some((pattern) => globSync(pattern).length > 0);
  return runPlan(verifyPlan({ extraSteps: extra.steps, hasSims }), execute, (line) => {
    console.log(line);
  });
}

process.exitCode = main();
