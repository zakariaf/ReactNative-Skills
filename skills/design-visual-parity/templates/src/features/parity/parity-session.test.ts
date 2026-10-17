// src/features/parity/parity-session.test.ts
import { SOURCE_LANGUAGE } from '@/i18n/languages';

import {
  currentParityRequest,
  endParitySession,
  startParitySession,
  subscribeParitySession,
} from './parity-session';

import type { ParityPlanTable } from './parity-plans';
import type { ParityRequest } from './parity-request';

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
} as const satisfies ParityPlanTable;

const REQUEST: ParityRequest = {
  frame: 'test-plain',
  plan: PLANS['test-plain'],
  theme: 'light',
  language: SOURCE_LANGUAGE,
  date: '2026-10-01',
  scrollY: undefined,
  probe: null,
  nonce: 'a1b2c3d4',
};

describe('the parity session', () => {
  afterEach(() => {
    endParitySession();
  });

  it('holds the launch request and tells its subscribers', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeParitySession(listener);

    startParitySession(REQUEST);
    expect(currentParityRequest()).toBe(REQUEST);
    endParitySession();
    expect(currentParityRequest()).toBeNull();
    unsubscribe();
    startParitySession(REQUEST);

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
