// src/services/session/expo-secure-store-session-adapter.ts
import { getItemAsync, setItemAsync } from 'expo-secure-store';

import type { SessionPort } from './session-port';

const KEY = 'session.token';

export function createExpoSecureStoreSessionAdapter(): SessionPort {
  return { readToken: () => getItemAsync(KEY), saveToken: (token) => setItemAsync(KEY, token) };
}
