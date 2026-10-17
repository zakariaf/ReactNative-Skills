// src/stores/debug-overrides/debug-overrides-reducer-cases.ts
// The debug switches' rules as data: one case per action and the changes that change nothing (the
// store then writes nothing). debug-overrides-reducer.test.ts runs every case, and so does
// state-management-zustand's check-reducers. Plain data and type imports only.
import type { DebugOverrides } from './debug-overrides';
import type { DebugOverridesAction } from './debug-overrides-reducer';

type DebugOverridesCase = {
  /** The kebab-case name of the rule the case pins; a failure names it. */
  readonly rule: string;
  /** The switches before the action; the table's `initial` when left out. */
  readonly state?: DebugOverrides;
  readonly action: DebugOverridesAction;
} & ({ readonly same: true } | { readonly expect: Partial<DebugOverrides> });

type DebugOverridesReducerCases = {
  readonly reducer: 'debugOverridesReducer';
  readonly initial: DebugOverrides;
  readonly cases: readonly DebugOverridesCase[];
};

/** DEFAULT_DEBUG_OVERRIDES written out (a cases file holds data only); the test pins the two together. */
const DEFAULTS: DebugOverrides = {
  today: null,
  isOffline: false,
  motion: 'system',
  isCanvasProbeOn: false,
};

const SIMULATED: DebugOverrides = { ...DEFAULTS, today: '2030-12-31' };

export const DEBUG_OVERRIDES_REDUCER_CASES: DebugOverridesReducerCases = {
  reducer: 'debugOverridesReducer',
  initial: DEFAULTS,
  cases: [
    {
      rule: 'link-applies-every-switch-it-names',
      action: { type: 'apply-overrides', patch: { today: '2030-01-02', isOffline: true } },
      expect: { today: '2030-01-02', isOffline: true },
    },
    {
      rule: 'link-repeated-changes-nothing',
      state: SIMULATED,
      action: { type: 'apply-overrides', patch: { today: '2030-12-31' } },
      same: true,
    },
    {
      rule: 'offline-on',
      action: { type: 'set-offline', isOn: true },
      expect: { isOffline: true },
    },
    { rule: 'offline-unchanged', action: { type: 'set-offline', isOn: false }, same: true },
    {
      rule: 'motion-still',
      action: { type: 'set-motion', motion: 'still' },
      expect: { motion: 'still' },
    },
    {
      rule: 'canvas-probe-on',
      action: { type: 'set-canvas-probe', isOn: true },
      expect: { isCanvasProbeOn: true },
    },
    {
      rule: 'next-day-from-the-real-day',
      action: { type: 'advance-day', realToday: '2030-02-28' },
      expect: { today: '2030-03-01' },
    },
    {
      rule: 'next-day-from-the-simulated-day',
      state: SIMULATED,
      action: { type: 'advance-day', realToday: '2030-02-28' },
      expect: { today: '2031-01-01' },
    },
    {
      rule: 'real-day-clears-the-simulated-day',
      state: SIMULATED,
      action: { type: 'use-real-day' },
      expect: { today: null },
    },
    { rule: 'real-day-unchanged', action: { type: 'use-real-day' }, same: true },
  ],
};
