// src/hooks/use-window-class.test.ts
// no-providers: the hook reads only the window metrics React Native reports, never a provider.
import { renderHook } from '@testing-library/react-native';

import { classifyWindow, useWindowClass } from './use-window-class';

/** The window React Native reports to useWindowDimensions (Jest's own default font scale is 2). */
const mockWindow = { width: 402, height: 874, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

describe('classifyWindow', () => {
  it.each([
    { name: 'a narrow split-screen pane', width: 320, height: 568, widthClass: 'compact' },
    { name: 'a compact Android phone', width: 360, height: 800, widthClass: 'compact' },
    { name: 'a phone in portrait', width: 402, height: 874, widthClass: 'compact' },
    { name: 'a phone in landscape', width: 874, height: 402, widthClass: 'regular' },
    { name: 'an iPad mini in portrait', width: 744, height: 1133, widthClass: 'regular' },
    { name: 'an Android tablet in portrait', width: 800, height: 1280, widthClass: 'regular' },
    { name: 'a 13-inch iPad in landscape', width: 1376, height: 1032, widthClass: 'regular' },
  ] as const)(
    'classifies $name ($width x $height) as $widthClass',
    ({ width, height, widthClass }) => {
      expect(classifyWindow(width, height, 1)).toStrictEqual({
        width: widthClass,
        isLandscape: width > height,
        isLargeText: false,
      });
    },
  );

  it('flags large text from iOS Extra Extra Extra Large and Android 1.3 upwards', () => {
    expect(classifyWindow(402, 874, 1.353).isLargeText).toBe(true);
    expect(classifyWindow(360, 800, 1.2999999523162842).isLargeText).toBe(true);
    expect(classifyWindow(402, 874, 2).isLargeText).toBe(true);
  });

  it('keeps rows side by side up to iOS Extra Extra Large and Android 1.15', () => {
    expect(classifyWindow(402, 874, 1.235).isLargeText).toBe(false);
    expect(classifyWindow(360, 800, 1.149999976158142).isLargeText).toBe(false);
  });
});

describe('useWindowClass', () => {
  it('classifies the current window and follows its changes', async () => {
    mockWindow.width = 402;
    mockWindow.height = 874;
    mockWindow.fontScale = 1;
    const { result, rerender } = await renderHook(() => useWindowClass());
    expect(result.current).toStrictEqual({
      width: 'compact',
      isLandscape: false,
      isLargeText: false,
    });

    mockWindow.width = 1032;
    mockWindow.height = 744;
    mockWindow.fontScale = 2;
    await rerender({});
    expect(result.current).toStrictEqual({
      width: 'regular',
      isLandscape: true,
      isLargeText: true,
    });
  });
});
