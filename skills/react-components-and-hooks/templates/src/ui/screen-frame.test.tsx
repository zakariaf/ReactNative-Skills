// src/ui/screen-frame.test.tsx
import { screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/use-theme';
import { renderHookWithProviders, renderWithProviders } from '@test/render-with-providers';

import {
  ABOVE_TAB_BAR_EDGES,
  ALL_EDGES,
  BELOW_HEADER_EDGES,
  BELOW_HEADER_SCROLLING_EDGES,
  BETWEEN_HEADER_AND_TAB_BAR_EDGES,
  ScreenFrame,
} from './screen-frame';

import type { ReactElement, ReactNode } from 'react';

// SafeAreaProvider renders nothing in Jest until it has metrics: a 402 x 874 pt phone with a
// 62 pt status bar and a 34 pt home indicator.
const PHONE_METRICS = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 62, left: 0, right: 0, bottom: 34 },
};

function onPhone(children: ReactNode): ReactElement {
  return <SafeAreaProvider initialMetrics={PHONE_METRICS}>{children}</SafeAreaProvider>;
}

const ON = 'additive';
const OFF = 'off';

describe('ScreenFrame', () => {
  it('paints the ground and carries the screen testID', async () => {
    const { result } = await renderHookWithProviders(() => useTheme());
    await renderWithProviders(
      onPhone(
        <ScreenFrame testID="tasks.screen" edges={ALL_EDGES}>
          <View testID="tasks.list" />
        </ScreenFrame>,
      ),
    );
    expect(screen.getByTestId('tasks.screen')).toHaveStyle({
      backgroundColor: result.current.colors.background,
    });
    expect(screen.getByTestId('tasks.list')).toBeOnTheScreen();
  });

  // What sits around the screen -> the edges the frame applies (as the native view receives them).
  it.each([
    {
      around: 'nothing above or below',
      edges: ALL_EDGES,
      native: { top: ON, right: ON, bottom: ON, left: ON },
    },
    {
      around: 'a header above',
      edges: BELOW_HEADER_EDGES,
      native: { top: OFF, right: ON, bottom: ON, left: ON },
    },
    {
      around: 'a tab bar below',
      edges: ABOVE_TAB_BAR_EDGES,
      native: { top: ON, right: ON, bottom: OFF, left: ON },
    },
    {
      around: 'a header above and a tab bar below',
      edges: BETWEEN_HEADER_AND_TAB_BAR_EDGES,
      native: { top: OFF, right: ON, bottom: OFF, left: ON },
    },
    {
      around: 'a header above and content scrolling under the home indicator',
      edges: BELOW_HEADER_SCROLLING_EDGES,
      native: { top: OFF, right: ON, bottom: OFF, left: ON },
    },
  ] as const)('leaves to the bars the insets they pad, with $around', async ({ edges, native }) => {
    await renderWithProviders(
      onPhone(
        <ScreenFrame testID="tasks.screen" edges={edges}>
          <View testID="tasks.list" />
        </ScreenFrame>,
      ),
    );
    expect(screen.getByTestId('tasks.screen')).toHaveProp('edges', native);
  });
});
