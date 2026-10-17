// src/services/services-context.test.tsx
import { renderHook } from '@testing-library/react-native';

import { createFakeClock } from '@/services/clock/fake-clock';

import { createTestServices } from './create-test-services';
import { ServicesProvider, useServices } from './services-context';

import type { JSX, ReactNode } from 'react';

describe('useServices', () => {
  it('returns the ports the provider hands down', async () => {
    const services = createTestServices({
      clock: createFakeClock({ nowMs: 0, today: '2026-10-03' }),
    });
    const wrapper = ({ children }: { readonly children: ReactNode }): JSX.Element => (
      <ServicesProvider services={services}>{children}</ServicesProvider>
    );
    const { result } = await renderHook(() => useServices(), { wrapper });

    expect(result.current.clock.today()).toBe('2026-10-03');
  });

  it('throws when no provider is above the hook', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(renderHook(() => useServices())).rejects.toThrow(
      'useServices() needs a <ServicesProvider> above it',
    );
    spy.mockRestore();
  });
});
