// src/stores/settings/settings-store-context.tsx
// Hands the one settings store down from the root layout. The store object never changes after
// startup (context carries the dependency; zustand carries the changing state), so nothing
// re-renders for the provider itself; components subscribe with useSettingsStore(selector).
import { SettingsStoreContext } from './settings-store';

import type { SettingsStore } from './settings-store';
import type { ReactNode } from 'react';

export type SettingsStoreProviderProps = {
  readonly store: SettingsStore;
  readonly children: ReactNode;
};

export function SettingsStoreProvider({ store, children }: SettingsStoreProviderProps): ReactNode {
  return <SettingsStoreContext value={store}>{children}</SettingsStoreContext>;
}
