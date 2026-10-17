// src/ui/a11y/use-announce.test.ts
// no-providers: useAnnounce reads no React context, only the module-level systemA11yStore (the
// mirror of the phone's switches, which no provider holds), so the test drives that store directly.
import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { systemA11yStore } from './system-a11y-store';
import { useAnnounce } from './use-announce';

describe('useAnnounce', () => {
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false, isScreenReaderOn: false });
  });

  it('stays silent while no screen reader runs', async () => {
    const speak = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    const { result } = await renderHook(() => useAnnounce());
    result.current('Task completed');
    expect(speak).not.toHaveBeenCalled();
  });

  it('speaks once a screen reader is running, queued behind speech already playing', async () => {
    const speak = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    const { result } = await renderHook(() => useAnnounce());
    await act(() => {
      systemA11yStore.setState({ isScreenReaderOn: true });
    });
    result.current('Task completed');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('Task completed', { queue: true });
  });
});
