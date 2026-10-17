// src/ui/adaptive/use-list-detail-layout.test.tsx
// no-providers: the hook reads only the window metrics, the safe-area insets and its own layout
// events, never an app provider.
import { act, renderHook } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LIST_PANE_WIDTH } from './pane-layout';
import { useListDetailLayout } from './use-list-detail-layout';

import type { ListDetailPanes } from './use-list-detail-layout';
import type { ReactElement, ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';

/** The window React Native reports to useWindowDimensions (Jest's own default font scale is 2). */
const mockWindow = { width: 402, height: 874, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

type Case = {
  readonly width: number;
  readonly height: number;
  readonly fontScale: number;
  readonly insets: EdgeInsets;
};

/** Renders the hook in a window of this size; SafeAreaProvider needs metrics to render in Jest. */
async function mountIn(window: Case): Promise<{ readonly current: ListDetailPanes }> {
  Object.assign(mockWindow, {
    width: window.width,
    height: window.height,
    fontScale: window.fontScale,
  });
  const frame = { x: 0, y: 0, width: window.width, height: window.height };
  function Wrapper({ children }: { readonly children: ReactNode }): ReactElement {
    return (
      <SafeAreaProvider initialMetrics={{ frame, insets: window.insets }}>
        {children}
      </SafeAreaProvider>
    );
  }
  const { result } = await renderHook(() => useListDetailLayout(), { wrapper: Wrapper });
  return result;
}

/** Fires the layout event ListDetailLayout's root view would fire at this width. */
async function layOut(result: { readonly current: ListDetailPanes }, width: number): Promise<void> {
  const event = { nativeEvent: { layout: { x: 0, y: 0, width, height: 900 } } };
  await act(() => {
    result.current.onLayout(event as LayoutChangeEvent);
  });
}

const NO_SIDES = { top: 24, right: 0, bottom: 20, left: 0 };
const TWO_PANES = { kind: 'two-pane', listWidth: LIST_PANE_WIDTH };
const ONE_PANE = { kind: 'one-pane' };

describe('useListDetailLayout', () => {
  it('shows one pane on a phone in portrait', async () => {
    const insets = { top: 62, right: 0, bottom: 34, left: 0 };
    const panes = await mountIn({ width: 402, height: 874, fontScale: 1, insets });
    expect(panes.current.layout).toStrictEqual(ONE_PANE);
  });

  it('shows two panes on an iPad mini in portrait', async () => {
    const panes = await mountIn({ width: 744, height: 1133, fontScale: 1, insets: NO_SIDES });
    expect(panes.current.layout).toStrictEqual(TWO_PANES);
    await layOut(panes, 744);
    expect(panes.current.layout).toStrictEqual(TWO_PANES);
  });

  it('falls back to one pane on the same iPad at fontScale 2', async () => {
    const panes = await mountIn({ width: 744, height: 1133, fontScale: 2, insets: NO_SIDES });
    expect(panes.current.layout).toStrictEqual(ONE_PANE);
  });

  it('follows the measured box when a side tab bar leaves 664 of a 744 window', async () => {
    const panes = await mountIn({ width: 744, height: 1133, fontScale: 1, insets: NO_SIDES });
    await layOut(panes, 664);
    expect(panes.current.layout).toStrictEqual(ONE_PANE);
  });

  it('follows the box back to two panes when it grows again', async () => {
    const panes = await mountIn({ width: 1376, height: 1032, fontScale: 1, insets: NO_SIDES });
    await layOut(panes, 700);
    expect(panes.current.layout).toStrictEqual(ONE_PANE);
    await layOut(panes, 1296);
    expect(panes.current.layout).toStrictEqual(TWO_PANES);
  });

  it('takes a landscape notch off the window before the first layout', async () => {
    const window = { width: 780, height: 402, fontScale: 1 };
    const clearPanes = await mountIn({ ...window, insets: { ...NO_SIDES, bottom: 0 } });
    expect(clearPanes.current.layout).toStrictEqual(TWO_PANES);
    const notched = { top: 0, right: 62, bottom: 21, left: 62 };
    const panes = await mountIn({ ...window, insets: notched });
    expect(panes.current.layout).toStrictEqual(ONE_PANE);
  });
});
