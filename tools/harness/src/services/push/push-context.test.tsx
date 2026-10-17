// src/services/push/push-context.test.tsx
// no-providers: this file tests PushProvider itself, outside it and as the test's own wrapper.
import { renderHook } from '@testing-library/react-native';

import { createFakePush } from './fake-push';
import { PushProvider, usePushServices } from './push-context';

import type { PushServices } from './push-context';
import type { ReactNode } from 'react';

describe('usePushServices', () => {
  it('returns what the push kit provides', async () => {
    const value: PushServices = {
      push: createFakePush(),
      registration: {
        sync: () => Promise.resolve('none'),
        start: () => () => undefined,
        unregister: () => Promise.resolve(),
      },
      openSettings: () => Promise.resolve(),
    };
    const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
      <PushProvider value={value}>{props.children}</PushProvider>
    );
    const { result } = await renderHook(() => usePushServices(), { wrapper });
    expect(result.current).toBe(value);
  });

  it('throws without the provider, naming the kit to register', async () => {
    await expect(renderHook(() => usePushServices())).rejects.toThrow('createPushKit');
  });
});
