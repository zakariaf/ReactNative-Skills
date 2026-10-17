// src/services/secure-storage/secure-key-names.ts
// Every key the app keeps in the secure store, in one closed list. Sign-out and the fresh-install
// wipe remove exactly these keys, so a secret stored under a key that is not listed here would
// survive both. expo-secure-store accepts only letters, digits, '.', '-' and '_' in a key (it throws
// "Invalid key provided to SecureStore" otherwise, on iOS and Android alike).

export const SECURE_KEYS = {
  /** The short-lived bearer token sent as Authorization. */
  accessToken: 'auth.access-token',
  /** The long-lived token that buys a new access token; written before anything else. */
  refreshToken: 'auth.refresh-token',
  /** JSON: the access token's expiry and the signed-in account's non-secret facts. */
  sessionMeta: 'auth.session-meta',
} as const;

export type SecureKey = (typeof SECURE_KEYS)[keyof typeof SECURE_KEYS];

/** Every declared key, in declaration order: what a wipe removes. */
export const ALL_SECURE_KEYS: readonly SecureKey[] = Object.values(SECURE_KEYS);

/** The key format expo-secure-store accepts (its own isValidKey check). */
export const SECURE_KEY_PATTERN = /^[\w.-]+$/;
