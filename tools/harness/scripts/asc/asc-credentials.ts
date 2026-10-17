// scripts/asc/asc-credentials.ts
// The only module that reads the App Store Connect API key (.p8), into memory, to sign one token.
// Every other tool receives ASC_KEY_ID, ASC_ISSUER_ID and APPLE_TEAM_ID only; xcodebuild gets the
// key's path and altool finds AuthKey_<id>.p8 by itself. Never log, print, copy or commit the key.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AscCredentials } from './asc-jwt.ts';

/** An environment snapshot: process.env, or an object in tests. */
export type ToolEnv = Readonly<Record<string, string | undefined>>;

export function requireEnv(env: ToolEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. Human step (API key): the developer exports it in their shell profile (never in the repo), then starts a new shell.`,
    );
  }
  return value;
}

/** ~/.appstoreconnect/private_keys/AuthKey_<id>.p8, where altool also finds the key by itself. */
export function ascKeyPath(keyId: string, home: string = homedir()): string {
  return join(home, '.appstoreconnect', 'private_keys', `AuthKey_${keyId}.p8`);
}

/** Loads the key into memory only, to sign one token; never pass it on, print it or write it. */
export function loadAscCredentials(env: ToolEnv): AscCredentials {
  const keyId = requireEnv(env, 'ASC_KEY_ID');
  return {
    keyId,
    issuerId: requireEnv(env, 'ASC_ISSUER_ID'),
    privateKeyPem: readFileSync(ascKeyPath(keyId), 'utf8'),
  };
}
