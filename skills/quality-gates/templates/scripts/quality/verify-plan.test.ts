// scripts/quality/verify-plan.test.ts
import {
  CORE_STEPS,
  extraStepsOf,
  GUARDRAIL_COMMAND,
  runPlan,
  verifyPlan,
  verifySummary,
  type VerifyStep,
} from './verify-plan.ts';

const names = (steps: readonly VerifyStep[]): readonly string[] => steps.map((step) => step.name);

describe('verifyPlan', () => {
  it('runs the ten core gates in order when the app has no simulations', () => {
    expect(names(verifyPlan({ extraSteps: [], hasSims: false }))).toStrictEqual([
      'format:check',
      'lint',
      'typecheck',
      'i18n:verify',
      'check:unused',
      'guardrail',
      'test:coverage',
      'export:audit',
      'audit:licenses',
      'check:deps',
    ]);
  });

  it('adds test:sim right after the tests once a simulation exists', () => {
    const steps = names(verifyPlan({ extraSteps: [], hasSims: true }));
    expect(steps.indexOf('test:sim')).toBe(steps.indexOf('test:coverage') + 1);
  });

  it('runs extra steps after the tests and before the release export', () => {
    const steps = names(verifyPlan({ extraSteps: ['check:contrast'], hasSims: true }));
    expect(steps.slice(6, 10)).toStrictEqual([
      'test:coverage',
      'test:sim',
      'check:contrast',
      'export:audit',
    ]);
  });

  it('spawns npm scripts silently and the guardrail with node', () => {
    const steps = verifyPlan({ extraSteps: [], hasSims: false });
    expect(steps[0]?.command).toStrictEqual(['npm', 'run', '-s', 'format:check']);
    expect(steps.find((step) => step.name === 'guardrail')?.command).toStrictEqual(
      GUARDRAIL_COMMAND,
    );
  });

  it('lists every step it can plan as a core step', () => {
    const planned = names(verifyPlan({ extraSteps: [], hasSims: true }));
    expect([...planned].sort()).toStrictEqual([...CORE_STEPS].sort());
  });
});

describe('extraStepsOf', () => {
  it('reads no extra steps when the key is absent', () => {
    expect(extraStepsOf({})).toStrictEqual({ ok: true, steps: [] });
  });

  it('keeps the listed scripts in order', () => {
    expect(extraStepsOf({ verifyExtraSteps: ['check:contrast', 'audit:network'] })).toStrictEqual({
      ok: true,
      steps: ['check:contrast', 'audit:network'],
    });
  });

  it.each([
    ['a core step', ['lint']],
    ['a repeated step', ['check:contrast', 'check:contrast']],
    ['a shell command', ['npm run lint']],
  ])('refuses %s', (_label, verifyExtraSteps) => {
    expect(extraStepsOf({ verifyExtraSteps }).ok).toBe(false);
  });

  it('refuses a value that is not a list of names', () => {
    expect(extraStepsOf({ verifyExtraSteps: 'lint' }).ok).toBe(false);
  });
});

describe('runPlan', () => {
  const steps = verifyPlan({ extraSteps: [], hasSims: false });

  it('runs every step and prints the summary when all pass', () => {
    const lines: string[] = [];
    const status = runPlan(
      steps,
      () => 0,
      (line) => lines.push(line),
    );
    expect(status).toBe(0);
    expect(lines).toStrictEqual([verifySummary(steps)]);
    expect(lines[0]).toMatch(/^verify: 10 steps passed \(format:check, lint, /u);
  });

  it('stops at the first failing step with its exit code', () => {
    const ran: string[] = [];
    const lines: string[] = [];
    const status = runPlan(
      steps,
      (step) => {
        ran.push(step.name);
        return step.name === 'typecheck' ? 2 : 0;
      },
      (line) => lines.push(line),
    );
    expect(status).toBe(2);
    expect(ran).toStrictEqual(['format:check', 'lint', 'typecheck']);
    expect(lines).toStrictEqual([
      'verify: step "typecheck" failed (exit 2); later steps did not run',
    ]);
  });
});
