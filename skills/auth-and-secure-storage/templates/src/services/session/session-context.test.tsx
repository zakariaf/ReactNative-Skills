// src/services/session/session-context.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { createSessionTestKit, TEST_ACCOUNT } from '@test/session/session-test-kit';

import { SessionProvider, useSessionManager, useSessionSnapshot } from './session-context';

import type { SessionManager } from './session-types';
import type { ReactNode } from 'react';

function providing(session: SessionManager) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <SessionProvider session={session}>{children}</SessionProvider>;
  };
}

describe('SessionProvider', () => {
  it('restores the session on mount and re-renders with each snapshot', async () => {
    const { session } = createSessionTestKit({ isSignedIn: true });

    const { result } = await renderHook(() => useSessionSnapshot(), {
      wrapper: providing(session),
    });
    await act(async () => {
      await session.restore();
    });

    expect(result.current).toStrictEqual({ status: 'signed-in', account: TEST_ACCOUNT });
    await act(async () => {
      await session.signOut('user');
    });
    expect(result.current).toStrictEqual({ status: 'signed-out', reason: 'user' });
  });

  it('restores again in the foreground after the keychain could not be read', async () => {
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    const { session, secureStorage } = createSessionTestKit({ isSignedIn: true });
    secureStorage.failNext('read');
    await session.restore();
    secureStorage.failNext(null);

    const { result } = await renderHook(() => useSessionSnapshot(), {
      wrapper: providing(session),
    });

    await waitFor(() => {
      expect(result.current.status).toBe('signed-in');
    });
  });

  it('signs out, keeping the values, when the store fails twice in the foreground', async () => {
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    const { session, secureStorage } = createSessionTestKit({ isSignedIn: true });
    secureStorage.failNext('read');

    const { result } = await renderHook(() => useSessionSnapshot(), {
      wrapper: providing(session),
    });

    await waitFor(() => {
      expect(result.current).toStrictEqual({ status: 'signed-out', reason: 'storage-unavailable' });
    });
    expect(secureStorage.stored().size).toBe(3);
  });

  it('waits for the foreground after a failed read in the background', async () => {
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    const { session, secureStorage } = createSessionTestKit({ isSignedIn: true });
    secureStorage.failNext('read');

    const { result } = await renderHook(() => useSessionSnapshot(), {
      wrapper: providing(session),
    });

    await waitFor(() => {
      expect(result.current).toStrictEqual({ status: 'unavailable' });
    });
    expect(secureStorage.calls.filter((call) => call.operation === 'read')).toHaveLength(1);
  });

  it('hands the manager to components below it and refuses to run without it', async () => {
    const { session } = createSessionTestKit();

    const { result } = await renderHook(() => useSessionManager(), { wrapper: providing(session) });

    expect(result.current).toBe(session);
    await expect(renderHook(() => useSessionManager())).rejects.toThrow(
      'needs a <SessionProvider>',
    );
  });
});
