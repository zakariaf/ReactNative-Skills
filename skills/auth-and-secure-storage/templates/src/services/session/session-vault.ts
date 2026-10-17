// src/services/session/session-vault.ts
// How a session is laid out in the secure store: the refresh token, the access token and a small
// JSON meta value (expiry and account facts) under three declared keys, each value small enough for
// every platform (some iOS releases refused values above about 2 KB). The refresh token is written
// first: after a crash between two writes the newest refresh token is always on disk, and a server
// that rotates refresh tokens has already invalidated the old one.
import * as v from 'valibot';

import { attempt, err, ok } from '@/core/result';
import { SESSION_META_SCHEMA } from '@/core/session/token-set';
import { ALL_SECURE_KEYS, SECURE_KEYS } from '@/services/secure-storage/secure-key-names';

import type { Result } from '@/core/result';
import type { Account, SessionMeta, TokenSet } from '@/core/session/token-set';
import type {
  SecureStorageFailure,
  SecureStoragePort,
} from '@/services/secure-storage/secure-storage-port';

export type StoredSession = { readonly tokens: TokenSet; readonly account: Account };

/** What the secure store held: nothing, something unusable, or a session. */
export type VaultContents =
  | { readonly kind: 'empty' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'found'; readonly session: StoredSession };

function parseMeta(text: string | null): SessionMeta | null {
  if (text === null) return null;
  const json = attempt(
    (): unknown => JSON.parse(text),
    () => null,
  );
  if (!json.ok) return null;
  const parsed = v.safeParse(SESSION_META_SCHEMA, json.value);
  return parsed.success ? parsed.output : null;
}

/** Reads the three values. A failed read is a failure, never "empty": the caller must not wipe. */
export async function readSession(
  store: SecureStoragePort,
): Promise<Result<VaultContents, SecureStorageFailure>> {
  const access = await store.read(SECURE_KEYS.accessToken);
  if (!access.ok) return access;
  const refresh = await store.read(SECURE_KEYS.refreshToken);
  if (!refresh.ok) return refresh;
  const metaText = await store.read(SECURE_KEYS.sessionMeta);
  if (!metaText.ok) return metaText;
  if (access.value === null && refresh.value === null && metaText.value === null) {
    return ok({ kind: 'empty' });
  }
  const meta = parseMeta(metaText.value);
  if (access.value === null || meta === null) return ok({ kind: 'corrupt' });
  const tokens = {
    accessToken: access.value,
    refreshToken: refresh.value,
    expiresAtMs: meta.expiresAtMs,
  };
  return ok({ kind: 'found', session: { tokens, account: meta.account } });
}

/** Writes a session, refresh token first; stops at the first failure and returns it. */
export async function writeSession(
  store: SecureStoragePort,
  { tokens, account }: StoredSession,
): Promise<Result<void, SecureStorageFailure>> {
  const refresh =
    tokens.refreshToken === null
      ? await store.remove(SECURE_KEYS.refreshToken)
      : await store.write(SECURE_KEYS.refreshToken, tokens.refreshToken);
  if (!refresh.ok) return refresh;
  const access = await store.write(SECURE_KEYS.accessToken, tokens.accessToken);
  if (!access.ok) return access;
  const meta: SessionMeta = { version: 1, expiresAtMs: tokens.expiresAtMs, account };
  return store.write(SECURE_KEYS.sessionMeta, JSON.stringify(meta));
}

/** Removes every declared key, even after one removal failed; returns the first failure. */
export async function wipeSession(
  store: SecureStoragePort,
): Promise<Result<void, SecureStorageFailure>> {
  let firstFailure: SecureStorageFailure | null = null;
  for (const key of ALL_SECURE_KEYS) {
    const removed = await store.remove(key);
    if (!removed.ok) firstFailure ??= removed.error;
  }
  return firstFailure === null ? ok(undefined) : err(firstFailure);
}
