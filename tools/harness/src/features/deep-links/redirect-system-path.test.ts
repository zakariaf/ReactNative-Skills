// src/features/deep-links/redirect-system-path.test.ts
// The gate's contract with Expo Router: an href, the first screen for a cold link that opens
// nothing, or null so a warm link changes nothing; a gated link waits in the inbox; a crash of the
// decision is reported and never reaches the launch.
import { LINK_FALLBACK, createRedirectSystemPath } from './redirect-system-path';

import type { RedirectDeps } from './redirect-system-path';
import type { LinkPolicy } from '@/core/links/route-incoming-link';
import type { Href } from 'expo-router';

/** A stand-in href for a route this test app does not have (typed routes only know real files). */
const LIST_HREF = '/lists/l-1' as Href;

const POLICY: LinkPolicy<Href> = {
  schemes: ['tasks'],
  hosts: [],
  isTestBuild: false,
  routes: [
    { path: '/tasks/[taskId]', params: { taskId: 'slug' } },
    {
      path: '/lists/[listId]',
      params: { listId: 'slug' },
      gate: 'signed-in',
      open: () => LIST_HREF,
    },
  ],
};

function setup(
  overrides: Partial<RedirectDeps> = {},
): RedirectDeps & { readonly redirect: ReturnType<typeof createRedirectSystemPath> } {
  const deps: RedirectDeps = {
    policy: () => POLICY,
    isGateOpen: () => false,
    defer: jest.fn(),
    report: jest.fn(),
    ...overrides,
  };
  return { ...deps, redirect: createRedirectSystemPath(deps) };
}

describe('createRedirectSystemPath', () => {
  it('returns the allow-listed href on a cold and a warm start', () => {
    const { redirect } = setup();
    expect(redirect({ path: 'tasks://tasks/task-7', initial: true })).toBe('/tasks/task-7');
    expect(redirect({ path: 'tasks://tasks/task-7', initial: false })).toBe('/tasks/task-7');
  });

  it('lands a refused cold link on the first screen and leaves a warm one where it is', () => {
    const { redirect } = setup();
    expect(redirect({ path: 'tasks://settings/delete-account', initial: true })).toBe(
      LINK_FALLBACK,
    );
    expect(redirect({ path: 'tasks://settings/delete-account', initial: false })).toBeNull();
    expect(redirect({ path: 'tasks://', initial: false })).toBeNull();
  });

  it('keeps a gated link while its gate is closed', () => {
    const { redirect, defer } = setup();
    expect(redirect({ path: 'tasks://lists/l-1', initial: true })).toBe(LINK_FALLBACK);
    expect(defer).toHaveBeenCalledWith({ gate: 'signed-in', target: LIST_HREF });
  });

  it('opens a gated link at once while its gate is open', () => {
    const { redirect, defer } = setup({ isGateOpen: (gate) => gate === 'signed-in' });
    expect(redirect({ path: 'tasks://lists/l-1', initial: false })).toBe('/lists/l-1');
    expect(defer).not.toHaveBeenCalled();
  });

  it('reports a crash of the decision and still answers', () => {
    const failure = new Error('policy broke');
    const { redirect, report } = setup({
      policy: () => {
        throw failure;
      },
    });
    expect(redirect({ path: 'tasks://tasks/task-7', initial: true })).toBe(LINK_FALLBACK);
    expect(redirect({ path: 'tasks://tasks/task-7', initial: false })).toBeNull();
    expect(report).toHaveBeenCalledWith(failure);
  });
});
