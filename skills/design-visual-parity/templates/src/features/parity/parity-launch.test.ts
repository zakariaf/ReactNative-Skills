// src/features/parity/parity-launch.test.ts
import { SOURCE_LANGUAGE } from '@/i18n/languages';

import { PARITY_FIXTURE } from './parity-fixture';
import { runParityLaunch } from './parity-launch';
import { currentParityRequest, endParitySession } from './parity-session';

import type { ParityAppliers } from './parity-launch';
import type { ParityPlanTable } from './parity-plans';

// A plan table of the test's own: the app replaces PARITY_PLANS with its frames, and these tests keep
// passing whatever frames it plans.
const PLANS = {
  'test-dialog': {
    root: 'test-dialog.scrim',
    href: '/test',
    state: 'test-dialog-open',
    data: 'design',
    tall: false,
    probe: null,
  },
} as const satisfies ParityPlanTable;

const PARAMS = {
  frame: 'test-dialog',
  theme: 'light',
  lang: SOURCE_LANGUAGE,
  date: PARITY_FIXTURE.day,
  motion: 'still',
  nonce: 'a1b2c3d4',
} as const;

function fakeAppliers(settings: 'applied' | 'restarting' = 'applied'): {
  readonly appliers: ParityAppliers;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    appliers: {
      consent: () => {
        calls.push('consent');
        return Promise.resolve();
      },
      overrides: (overrides) => {
        calls.push(`overrides ${JSON.stringify(overrides)}`);
        return Promise.resolve();
      },
      data: (data) => {
        calls.push(`data ${String(data.tasks.length)} tasks, ${String(data.lists.length)} lists`);
        return Promise.resolve();
      },
      settings: (value) => {
        calls.push(`settings ${value.language} ${value.theme}`);
        return Promise.resolve(settings);
      },
    },
  };
}

describe('runParityLaunch', () => {
  afterEach(() => {
    endParitySession();
  });

  it('holds consent, sets every switch, writes the data, applies the settings, then opens the frame', async () => {
    const { appliers, calls } = fakeAppliers();
    const navigate = jest.fn();

    const result = await runParityLaunch(PARAMS, { appliers, navigate, plans: PLANS });

    expect(calls).toStrictEqual([
      'consent',
      `overrides ${JSON.stringify({ today: PARITY_FIXTURE.day, motion: 'still', isOffline: false, probe: null })}`,
      `data ${String(PARITY_FIXTURE.tasks.length)} tasks, ${String(PARITY_FIXTURE.lists.length)} lists`,
      `settings ${SOURCE_LANGUAGE} system`,
    ]);
    expect(navigate).toHaveBeenCalledWith('/test');
    expect(result.ok && result.value.kind).toBe('opened');
    expect(currentParityRequest()?.plan.state).toBe('test-dialog-open');
  });

  it('stops before opening anything when the language restarts the app', async () => {
    const { appliers } = fakeAppliers('restarting');
    const navigate = jest.fn();

    const result = await runParityLaunch(PARAMS, { appliers, navigate, plans: PLANS });

    expect(result).toStrictEqual({ ok: true, value: { kind: 'restarting' } });
    expect(navigate).not.toHaveBeenCalled();
    expect(currentParityRequest()).toBeNull();
  });

  it('refuses a bad launch without applying anything', async () => {
    const { appliers, calls } = fakeAppliers();

    const result = await runParityLaunch(
      { ...PARAMS, frame: 'home' },
      { appliers, navigate: jest.fn(), plans: PLANS },
    );

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'parity-bad-value', param: 'frame', value: 'home' },
    });
    expect(calls).toStrictEqual([]);
  });

  it('stops before applying anything when a consent moment could cover the frame', async () => {
    const { appliers, calls } = fakeAppliers();
    const navigate = jest.fn();
    const live: ParityAppliers = {
      ...appliers,
      consent: () => Promise.reject(new Error('ads mode test')),
    };

    const result = await runParityLaunch(PARAMS, { appliers: live, navigate, plans: PLANS });

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'parity-apply-failed', param: 'consent', value: 'ads mode test' },
    });
    expect(calls).toStrictEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a step that throws', async () => {
    const { appliers } = fakeAppliers();
    const broken: ParityAppliers = {
      ...appliers,
      data: () => Promise.reject(new Error('database closed')),
    };

    const result = await runParityLaunch(PARAMS, {
      appliers: broken,
      navigate: jest.fn(),
      plans: PLANS,
    });

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'parity-apply-failed', param: 'data', value: 'database closed' },
    });
  });
});
