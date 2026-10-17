// src/services/session/expo-secure-store-session-adapter.web.ts
// The web keeps the token in memory only: a reload signs out (the server's httpOnly cookie restores it).
import type * as NativeSession from './expo-secure-store-session-adapter';

export const createExpoSecureStoreSessionAdapter: typeof NativeSession.createExpoSecureStoreSessionAdapter = () => {
  let token: string | null = null;
  return {
    readToken: () => Promise.resolve(token),
    saveToken: (next) => {
      token = next;
      return Promise.resolve();
    },
  };
};
