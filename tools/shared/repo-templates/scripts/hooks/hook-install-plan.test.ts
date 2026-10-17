// scripts/hooks/hook-install-plan.test.ts
import { planHookInstall } from './hook-install-plan.ts';

describe('planHookInstall', () => {
  it('installs when the package root is the git top level', () => {
    expect(planHookInstall('/work/app', { found: true, topLevel: '/work/app' })).toStrictEqual({
      install: true,
    });
  });

  it('ignores a trailing separator on either path', () => {
    expect(planHookInstall('/work/app/', { found: true, topLevel: '/work/app' })).toStrictEqual({
      install: true,
    });
  });

  it('skips a package nested inside a larger repository and names that repository', () => {
    const plan = planHookInstall('/work/repo/tools/harness', {
      found: true,
      topLevel: '/work/repo',
    });

    expect(plan).toStrictEqual({
      install: false,
      reason:
        "/work/repo/tools/harness is not the top level of the git repository /work/repo; that repository's root installs its own hooks",
    });
  });

  it("skips a checkout without a repository and keeps git's own message", () => {
    const plan = planHookInstall('/app', {
      found: false,
      detail: 'fatal: not a git repository (or any of the parent directories): .git',
    });

    expect(plan).toStrictEqual({
      install: false,
      reason:
        '/app is not in a git repository (fatal: not a git repository (or any of the parent directories): .git); a checkout without .git needs no git hooks',
    });
  });

  it('skips a folder that only shares a name prefix with the top level', () => {
    expect(planHookInstall('/work/app-two', { found: true, topLevel: '/work/app' })).toMatchObject({
      install: false,
    });
  });
});
