// src/canvas/use-canvas-lifecycle.test.ts
// no-providers: useCanvasLifecycle reads no context; focus, cover and callbacks are its input.
import { renderHook } from '@testing-library/react-native';

import { useCanvasLifecycle } from './use-canvas-lifecycle';

import type { LifecycleInput } from './use-canvas-lifecycle';

const mockApp = { isActive: true };
jest.mock('@/hooks/use-is-app-active', () => ({
  useIsAppActive: () => mockApp.isActive,
}));

type Flags = Pick<LifecycleInput, 'isFocused' | 'isInterrupted'>;

async function setup() {
  const calls: string[] = [];
  const input = (flags: Flags): LifecycleInput => ({
    ...flags,
    onPause: () => {
      calls.push('pause');
    },
    onResume: () => {
      calls.push('resume');
    },
    onFlags: (facts) => {
      calls.push(`flags ${JSON.stringify(facts)}`);
    },
  });
  const view = await renderHook(
    (flags: Flags) => {
      useCanvasLifecycle(input(flags));
    },
    { initialProps: { isFocused: true, isInterrupted: false } },
  );
  return { calls, rerender: view.rerender };
}

const decisions = (calls: readonly string[]): string[] =>
  calls.filter((call) => !call.startsWith('flags'));

describe('useCanvasLifecycle', () => {
  beforeEach(() => {
    mockApp.isActive = true;
  });

  it('runs the surface while the app is active, the screen focused and nothing covers it', async () => {
    const { calls } = await setup();
    expect(decisions(calls)).toStrictEqual(['resume']);
  });

  it('pauses while a full-screen overlay covers the surface and resumes after it', async () => {
    const { calls, rerender } = await setup();

    await rerender({ isFocused: true, isInterrupted: true });
    await rerender({ isFocused: true, isInterrupted: false });

    expect(decisions(calls)).toStrictEqual(['resume', 'pause', 'resume']);
  });

  it('pauses when the screen loses focus', async () => {
    const { calls, rerender } = await setup();

    await rerender({ isFocused: false, isInterrupted: false });

    expect(decisions(calls)).toStrictEqual(['resume', 'pause']);
  });

  it('reports the three facts before each decision, for the clock trace', async () => {
    const { calls, rerender } = await setup();

    await rerender({ isFocused: true, isInterrupted: true });

    expect(calls).toStrictEqual([
      'flags {"isAppActive":true,"isFocused":true,"isInterrupted":false}',
      'resume',
      'flags {"isAppActive":true,"isFocused":true,"isInterrupted":true}',
      'pause',
    ]);
  });
});
