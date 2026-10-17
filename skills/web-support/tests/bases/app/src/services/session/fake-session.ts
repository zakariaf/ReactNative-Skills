// src/services/session/fake-session.ts
import type { SessionPort } from './session-port';

export function createFakeSession(): SessionPort {
  let token: string | null = null;
  return {
    readToken: () => Promise.resolve(token),
    saveToken: (next) => {
      token = next;
      return Promise.resolve();
    },
  };
}
