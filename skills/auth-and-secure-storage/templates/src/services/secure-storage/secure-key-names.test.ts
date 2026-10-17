// src/services/secure-storage/secure-key-names.test.ts
import { ALL_SECURE_KEYS, SECURE_KEY_PATTERN, SECURE_KEYS } from './secure-key-names';

describe('SECURE_KEYS', () => {
  it('uses only the characters expo-secure-store accepts in a key', () => {
    const invalid = ALL_SECURE_KEYS.filter((key) => !SECURE_KEY_PATTERN.test(key));

    expect(invalid).toStrictEqual([]);
  });

  it('declares every key once, so a wipe removes each of them', () => {
    expect(new Set(ALL_SECURE_KEYS).size).toBe(ALL_SECURE_KEYS.length);
    expect(ALL_SECURE_KEYS).toStrictEqual([
      SECURE_KEYS.accessToken,
      SECURE_KEYS.refreshToken,
      SECURE_KEYS.sessionMeta,
    ]);
  });

  it('rejects the keys expo-secure-store would throw on', () => {
    expect(
      ['auth token', 'auth/token', '', 'tök'].map((key) => SECURE_KEY_PATTERN.test(key)),
    ).toStrictEqual([false, false, false, false]);
  });
});
