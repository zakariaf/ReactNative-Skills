// src/features/debug/debug-setup-plan.test.ts
import { planDebugSetup } from './debug-setup-plan';

describe('planDebugSetup', () => {
  it('orders the switches, then the settings, then the screen', () => {
    expect(
      planDebugSetup({ today: null, isOffline: false, language: 'en', open: 'tasks' }),
    ).toStrictEqual([
      { kind: 'overrides', patch: { today: null, isOffline: false } },
      { kind: 'settings', patch: { language: 'en' } },
      { kind: 'open', href: '/' },
    ]);
  });

  it('opens only the debug menu for an empty link', () => {
    expect(planDebugSetup({})).toStrictEqual([{ kind: 'open', href: '/debug' }]);
  });

  it('plans the same steps for the same link twice (a re-delivered link changes nothing)', () => {
    const request = { motion: 'still', theme: 'light' } as const;

    expect(planDebugSetup(request)).toStrictEqual(planDebugSetup(request));
  });
});
