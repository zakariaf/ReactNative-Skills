// src/services/local-notifications/reminder-sync-context.test.tsx
// no-providers: this file tests ReminderSyncProvider itself, outside it and as the test's own wrapper.
import { renderHook } from '@testing-library/react-native';

import { ReminderSyncProvider, useReminderSyncService } from './reminder-sync-context';

import type { ReminderSync } from './reminder-sync';
import type { ReactNode } from 'react';

const sync: ReminderSync = {
  request: () => undefined,
  sync: () => Promise.resolve({ kind: 'failed', step: 'unexpected' }),
  enable: () => Promise.resolve('granted'),
};

describe('useReminderSyncService', () => {
  it('returns the one sync the kit provides', async () => {
    const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
      <ReminderSyncProvider sync={sync}>{props.children}</ReminderSyncProvider>
    );
    const { result } = await renderHook(() => useReminderSyncService(), { wrapper });
    expect(result.current).toBe(sync);
  });

  it('throws without the provider, naming the kit to register', async () => {
    await expect(renderHook(() => useReminderSyncService())).rejects.toThrow(
      'createLocalNotificationsKit',
    );
  });
});
