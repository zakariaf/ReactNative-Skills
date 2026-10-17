// scripts/quality/verify-plan.ts
// The steps of `npm run verify`, cheapest and most likely to fail first, and the only place that
// decides them. Every step is strict: a step whose tool is missing fails loudly, never skips.
// Another skill adds a gate by appending its npm script to "verifyExtraSteps" in quality-gates.json
// (a gated file), and test:sim joins the plan as soon as a simulation exists.

/** One step: the name printed in the summary and the command spawned for it. */
export type VerifyStep = { readonly name: string; readonly command: readonly string[] };

/** The repo facts the plan depends on. */
export type VerifyFacts = {
  /** npm scripts appended by other skills in quality-gates.json "verifyExtraSteps", in order. */
  readonly extraSteps: readonly string[];
  /** True when a *.sim.test.ts exists under src/ or test/ (balance simulations of a game). */
  readonly hasSims: boolean;
};

/** quality-gates.json "verifyExtraSteps" after validation. */
export type ExtraSteps =
  | { readonly ok: true; readonly steps: readonly string[] }
  | { readonly ok: false; readonly message: string };

/** The guardrail step: resolved configs against quality-gates.json. */
export const GUARDRAIL_COMMAND = ['node', 'scripts/quality/check-quality-gates.ts'] as const;

/** Every step name the plan owns; an extra step may not repeat one. */
export const CORE_STEPS = [
  'format:check',
  'lint',
  'typecheck',
  'i18n:verify',
  'check:unused',
  'guardrail',
  'test:coverage',
  'test:sim',
  'export:audit',
  'audit:licenses',
  'check:deps',
] as const;

const SCRIPT_NAME = /^[a-z][a-z0-9]*(?:[:-][a-z0-9]+)*$/u;

const npmStep = (script: string): VerifyStep => ({
  name: script,
  command: ['npm', 'run', '-s', script],
});

/**
 * Every verify step in order: formatting, lint and types first (seconds), then dead code, the
 * guardrail and the tests, then the extra gates, and last the release export with the steps that
 * read it and the network (licences of shipped code, the dependency policy).
 */
export function verifyPlan(facts: VerifyFacts): readonly VerifyStep[] {
  return [
    npmStep('format:check'),
    npmStep('lint'),
    npmStep('typecheck'),
    npmStep('i18n:verify'),
    npmStep('check:unused'),
    { name: 'guardrail', command: GUARDRAIL_COMMAND },
    npmStep('test:coverage'),
    ...(facts.hasSims ? [npmStep('test:sim')] : []),
    ...facts.extraSteps.map(npmStep),
    npmStep('export:audit'),
    npmStep('audit:licenses'),
    npmStep('check:deps'),
  ];
}

const isCoreStep = (name: string): boolean => (CORE_STEPS as readonly string[]).includes(name);

/** Reads "verifyExtraSteps" from the parsed quality-gates.json: distinct npm script names, no core step. */
export function extraStepsOf(gates: unknown): ExtraSteps {
  const value: unknown =
    typeof gates === 'object' && gates !== null
      ? (gates as Readonly<Record<string, unknown>>)['verifyExtraSteps']
      : undefined;
  if (value === undefined) {
    return { ok: true, steps: [] };
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return { ok: false, message: 'verifyExtraSteps must be a list of npm script names' };
  }
  const names = value as readonly string[];
  const bad = names.find(
    (name, index) => !SCRIPT_NAME.test(name) || isCoreStep(name) || names.indexOf(name) !== index,
  );
  if (bad !== undefined) {
    return {
      ok: false,
      message: `verifyExtraSteps entry "${bad}" is malformed, repeated or a core step`,
    };
  }
  return { ok: true, steps: names };
}

/** The last line of a green run, naming every step that ran. */
export function verifySummary(steps: readonly VerifyStep[]): string {
  return `verify: ${String(steps.length)} steps passed (${steps.map((step) => step.name).join(', ')})`;
}

/**
 * Runs the steps in order and stops at the first failure, like `a && b && c`. Returns the exit
 * code: the failing step's, or 0 when every step passed.
 */
export function runPlan(
  steps: readonly VerifyStep[],
  execute: (step: VerifyStep) => number,
  print: (line: string) => void,
): number {
  for (const step of steps) {
    const status = execute(step);
    if (status !== 0) {
      print(`verify: step "${step.name}" failed (exit ${String(status)}); later steps did not run`);
      return status;
    }
  }
  print(verifySummary(steps));
  return 0;
}
