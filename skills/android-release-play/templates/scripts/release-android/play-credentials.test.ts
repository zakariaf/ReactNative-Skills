// scripts/release-android/play-credentials.test.ts
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadServiceAccount,
  parseServiceAccount,
  serviceAccountPathOf,
} from './play-credentials.ts';

/** A throwaway key made for this test run; never a real account. */
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
/** The key file's type field (a Google constant, not one of this app's kinds). */
const SERVICE_ACCOUNT = 'service_account';
const EMAIL = 'release@tasks-test.iam.gserviceaccount.com';
const KEY_FILE = JSON.stringify({ type: SERVICE_ACCOUNT, client_email: EMAIL, private_key: PEM });

describe('parseServiceAccount', () => {
  it('exposes the e-mail and a signer, never the key', () => {
    const account = parseServiceAccount(KEY_FILE);
    const signature = account.signRs256('header.payload');
    const verifier = createVerify('RSA-SHA256');
    verifier.update('header.payload');

    expect(account.clientEmail).toBe(EMAIL);
    expect(verifier.verify(createPublicKey(privateKey), signature, 'base64url')).toBe(true);
    expect(JSON.stringify(account)).not.toContain('PRIVATE KEY');
    expect(Object.keys(account)).toStrictEqual(['clientEmail', 'signRs256']);
  });

  it('answers bad input with its own sentence, never the file text', () => {
    expect(() => parseServiceAccount(`{${PEM}`)).toThrow(
      'the service-account file is not valid JSON',
    );
    expect(() => parseServiceAccount('{"type":"authorized_user"}')).toThrow(
      'not a Google service-account key',
    );
    expect(() =>
      parseServiceAccount(
        JSON.stringify({ type: SERVICE_ACCOUNT, client_email: EMAIL, private_key: 'x' }),
      ),
    ).toThrow('private_key is not a PEM key');
  });
});

describe('loadServiceAccount', () => {
  const home = mkdtempSync(join(tmpdir(), 'play-credentials-'));
  const path = serviceAccountPathOf('com.acme.tasks', home);

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('keeps the key in ~/.android-keys, named after the app', () => {
    expect(path).toBe(join(home, '.android-keys', 'com.acme.tasks-play-service-account.json'));
  });

  it('reads a key with mode 600 outside the repo and refuses one others can read', () => {
    const file = join(home, 'key.json');
    writeFileSync(file, KEY_FILE);
    chmodSync(file, 0o644);

    expect(() => loadServiceAccount(file, '/work/tasks')).toThrow('expected 600');

    chmodSync(file, 0o600);

    expect(loadServiceAccount(file, '/work/tasks').clientEmail).toBe(EMAIL);
  });

  it('refuses a missing key and a key inside the repo', () => {
    expect(() => loadServiceAccount(path, '/work/tasks')).toThrow('no service-account key at');
    expect(() => loadServiceAccount(join(home, 'key.json'), home)).toThrow('is inside the repo');
  });
});
