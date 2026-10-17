// src/hooks/use-link-gate.test.ts
// no-providers: useLinkGate writes only the link-gate registry, never a provider.
import { renderHook } from '@testing-library/react-native';

import { linkGates } from '@/services/deep-links/link-gates';

import { useLinkGate } from './use-link-gate';

describe('useLinkGate', () => {
  it('follows the guard value and closes the gate on unmount', async () => {
    const view = await renderHook(
      ({ isOpen }: { isOpen: boolean }) => {
        useLinkGate('signed-in', isOpen);
      },
      {
        initialProps: { isOpen: false },
      },
    );
    expect(linkGates.isOpen('signed-in')).toBe(false);
    await view.rerender({ isOpen: true });
    expect(linkGates.isOpen('signed-in')).toBe(true);
    await view.unmount();
    expect(linkGates.isOpen('signed-in')).toBe(false);
  });
});
