// src/services/session/session-port.ts
export type SessionPort = {
  readonly readToken: () => Promise<string | null>;
  readonly saveToken: (token: string) => Promise<void>;
};
