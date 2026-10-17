// src/ui/a11y/motion-config.test.tsx
// no-providers: MotionConfig is the provider under test, and it reads only the module-level
// systemA11yStore, never the app's provider tree.
import { act, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';

import { MotionConfig } from './motion-config';
import { systemA11yStore } from './system-a11y-store';

jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<Record<string, unknown>>('react-native-reanimated'),
  ReducedMotionConfig: jest.fn(() => null),
}));

function lastMode(): unknown {
  return jest.mocked(ReducedMotionConfig).mock.calls.at(-1)?.[0];
}

describe('MotionConfig', () => {
  // Reset before rendering, never after: RNTL unmounts in its own afterEach, which runs after this
  // block's, so a reset there would update a mounted tree outside act().
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false });
  });

  it("sets Reanimated's global mode from the in-app preference", async () => {
    const { rerender } = await render(
      <MotionConfig preference="on">
        <View testID="app.root" />
      </MotionConfig>,
    );
    expect(lastMode()).toStrictEqual({ mode: ReduceMotion.Always });
    expect(screen.getByTestId('app.root')).toBeOnTheScreen();

    await rerender(
      <MotionConfig preference="off">
        <View testID="app.root" />
      </MotionConfig>,
    );
    expect(lastMode()).toStrictEqual({ mode: ReduceMotion.Never });
  });

  it('follows the live phone switch while the preference is system', async () => {
    await render(
      <MotionConfig preference="system">
        <View testID="app.root" />
      </MotionConfig>,
    );
    expect(lastMode()).toStrictEqual({ mode: ReduceMotion.Never });

    await act(() => {
      systemA11yStore.setState({ isReduceMotionOn: true });
    });
    expect(lastMode()).toStrictEqual({ mode: ReduceMotion.Always });
  });
});
