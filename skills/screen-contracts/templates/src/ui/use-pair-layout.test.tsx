// src/ui/use-pair-layout.test.tsx
// no-providers: the hook reads only the window metrics React Native reports, never a provider.
import { renderHook } from '@testing-library/react-native';

import { usePairLayout } from './use-pair-layout';

/** The window React Native reports to useWindowDimensions (Jest's own default font scale is 2). */
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

describe('usePairLayout', () => {
  afterEach(() => {
    mockWindow.fontScale = 1;
  });

  it('puts the two cells side by side at the default text size', async () => {
    const { result } = await renderHook(() => usePairLayout(12));

    expect(result.current.isStacked).toBe(false);
    expect(result.current.row).toStrictEqual({
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 12,
    });
    expect(result.current.cell).toStrictEqual({ flexGrow: 1, flexShrink: 1, flexBasis: 'auto' });
  });

  it('stacks the cells from the large-text threshold on', async () => {
    mockWindow.fontScale = 1.3;

    const { result } = await renderHook(() => usePairLayout(12));

    expect(result.current.isStacked).toBe(true);
    expect(result.current.row).toStrictEqual({ flexDirection: 'column', gap: 12 });
    expect(result.current.cell).toStrictEqual({ alignSelf: 'stretch' });
  });

  it('keeps every cell off a zero flex basis', async () => {
    const { result } = await renderHook(() => usePairLayout(8));

    expect(result.current.cell.flexBasis).not.toBe(0);
    expect(result.current.cell.flex).toBeUndefined();
  });
});
