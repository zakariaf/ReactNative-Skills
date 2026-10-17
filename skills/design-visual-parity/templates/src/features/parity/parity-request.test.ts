// src/features/parity/parity-request.test.ts
import { SOURCE_LANGUAGE } from '@/i18n/languages';

import { PARITY_PLANS } from './parity-plans';
import { describeParityError, parseParityRequest } from './parity-request';

import type { ParityPlanTable } from './parity-plans';

// A plan table of the test's own: the app replaces PARITY_PLANS with its frames, and these tests keep
// passing whatever frames it plans.
const PLANS = {
  'test-plain': {
    root: 'test.screen',
    href: '/test',
    state: null,
    data: 'design',
    tall: false,
    probe: null,
  },
  'test-tall': {
    root: 'test-tall.screen',
    href: '/test-tall',
    state: null,
    data: 'design',
    tall: true,
    probe: null,
  },
  'test-dialog': {
    root: 'test-dialog.scrim',
    href: '/test',
    state: 'test-dialog-open',
    data: 'design',
    tall: false,
    probe: null,
  },
} as const satisfies ParityPlanTable;

const DAY = '2026-10-01';
const BASE = {
  frame: 'test-plain',
  theme: 'dark',
  lang: SOURCE_LANGUAGE,
  date: DAY,
  motion: 'still',
  nonce: '3f9a0c1d2e4b',
} as const;

describe('parseParityRequest', () => {
  it('reads a launch into one request with its plan', () => {
    expect(parseParityRequest(BASE, DAY, PLANS)).toStrictEqual({
      ok: true,
      value: {
        frame: 'test-plain',
        plan: PLANS['test-plain'],
        theme: 'dark',
        language: SOURCE_LANGUAGE,
        date: DAY,
        scrollY: undefined,
        probe: null,
        nonce: '3f9a0c1d2e4b',
      },
    });
  });

  it('takes the scroll offset of a tall frame', () => {
    const result = parseParityRequest({ ...BASE, frame: 'test-tall', scrollY: '240' }, DAY, PLANS);

    expect(result.ok && result.value.scrollY).toBe(240);
  });

  it("plans with the app's own PARITY_PLANS by default", () => {
    // Before the app has an approved frame the table is empty and every launch is refused.
    const frame = Object.keys(PARITY_PLANS)[0];
    const result = parseParityRequest({ ...BASE, frame: frame ?? 'no-frame-planned' }, DAY);

    expect(result.ok ? result.value.frame : null).toBe(frame ?? null);
  });

  it.each([
    [
      { ...BASE, dark: '1' },
      { kind: 'parity-unknown-param', param: 'dark' },
    ],
    [
      { ...BASE, theme: ['dark', 'light'] },
      { kind: 'parity-repeated-param', param: 'theme' },
    ],
    [
      { ...BASE, nonce: undefined },
      { kind: 'parity-missing-param', param: 'nonce' },
    ],
    [
      { ...BASE, frame: 'home' },
      { kind: 'parity-bad-value', param: 'frame', value: 'home' },
    ],
    [
      { ...BASE, lang: 'xx' },
      { kind: 'parity-bad-value', param: 'lang', value: 'xx' },
    ],
    [
      { ...BASE, motion: 'system' },
      { kind: 'parity-bad-value', param: 'motion', value: 'system' },
    ],
    [
      { ...BASE, date: '2026-10-02' },
      { kind: 'parity-bad-value', param: 'date', value: '2026-10-02' },
    ],
    [
      { ...BASE, scrollY: '12.5' },
      { kind: 'parity-bad-value', param: 'scrollY', value: '12.5' },
    ],
    [
      { ...BASE, scrollY: '240' },
      { kind: 'parity-bad-value', param: 'scrollY', value: '240' },
    ],
    [
      { ...BASE, probe: 'map' },
      { kind: 'parity-bad-value', param: 'probe', value: 'map' },
    ],
  ])('refuses %j', (params, error) => {
    expect(parseParityRequest(params, DAY, PLANS)).toStrictEqual({ ok: false, error });
  });

  it('describes a failure in one line', () => {
    expect(describeParityError({ kind: 'parity-bad-value', param: 'frame', value: 'home' })).toBe(
      'parity-bad-value frame=home',
    );
    expect(describeParityError({ kind: 'parity-missing-param', param: 'nonce' })).toBe(
      'parity-missing-param nonce',
    );
  });
});
