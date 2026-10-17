// src/stores/stores-context.tsx: hands the app's stores down; they are created once per app start (and per test).
import { createContext, use } from 'react';

import type { ListsStore } from '@/stores/lists-store';
import type { TasksStore } from '@/stores/tasks-store';
import type { JSX, ReactNode } from 'react';

/**
 * Every domain store, made by createStores(deps). A new domain adds one member here, one line in
 * createStores, and one reload line in updateAndPublish when it holds rows from disk. Context
 * carries the stores themselves, never their state: components subscribe with selectors.
 */
export type Stores = {
  readonly lists: ListsStore;
  readonly tasks: TasksStore;
};

const StoresContext = createContext<Stores | null>(null);

export type StoresProviderProps = {
  readonly stores: Stores;
  readonly children: ReactNode;
};

/** Hands the stores down. They never change after startup, so nothing re-renders for it. */
export function StoresProvider({ stores, children }: StoresProviderProps): JSX.Element {
  return <StoresContext value={stores}>{children}</StoresContext>;
}

/** Returns the stores. A missing provider is a programmer error, so it throws. */
export function useStores(): Stores {
  const stores = use(StoresContext);
  if (stores === null) throw new Error('useStores() needs a <StoresProvider> above it');
  return stores;
}
