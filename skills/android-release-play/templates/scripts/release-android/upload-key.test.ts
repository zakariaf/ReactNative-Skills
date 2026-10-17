// scripts/release-android/upload-key.test.ts
import {
  keytoolGenerateArgs,
  secretFileProblems,
  UPLOAD_PASSWORD_ENV,
  uploadKeyPathOf,
  uploadKeyProblems,
  uploadPropertyPrefix,
  uploadSigningProperties,
} from './upload-key.ts';

const REPO = '/work/tasks';
const KEY = '/work/dev-home/.android-keys/com.acme.tasks-upload.jks';

describe('uploadSigningProperties', () => {
  it('names the four properties after the application id', () => {
    expect(uploadSigningProperties('com.acme.tasks')).toStrictEqual({
      storeFile: 'COM_ACME_TASKS_UPLOAD_STORE_FILE',
      storePassword: 'COM_ACME_TASKS_UPLOAD_STORE_PASSWORD',
      keyAlias: 'COM_ACME_TASKS_UPLOAD_KEY_ALIAS',
      keyPassword: 'COM_ACME_TASKS_UPLOAD_KEY_PASSWORD',
    });
  });

  it('refuses an id that is not an Android package', () => {
    expect(() => uploadPropertyPrefix('tasks')).toThrow('is not an Android package');
    expect(() => uploadPropertyPrefix('com.acme.my-tasks')).toThrow('is not an Android package');
  });
});

describe('uploadKeyPathOf', () => {
  it('keeps the key in ~/.android-keys, one per app', () => {
    expect(uploadKeyPathOf('com.acme.tasks', '/work/dev-home')).toBe(KEY);
  });
});

describe('secretFileProblems', () => {
  const words = { what: 'upload key', missing: 'generate it' };

  it('accepts a file outside the repo with mode 600', () => {
    expect(
      secretFileProblems(
        { path: KEY, repoRoot: REPO, stat: { isFile: true, mode: 0o100600 } },
        words,
      ),
    ).toStrictEqual([]);
  });

  it('refuses a key inside the repo before looking at it', () => {
    const problems = secretFileProblems(
      { path: `${REPO}/android/upload.jks`, repoRoot: REPO, stat: { isFile: true, mode: 0o600 } },
      words,
    );

    expect(problems).toStrictEqual([
      `the upload key is inside the repo (${REPO}/android/upload.jks): move it to ~/.android-keys/`,
    ]);
  });

  it('reports a missing key and a key others can read', () => {
    expect(uploadKeyProblems({ path: KEY, repoRoot: REPO, stat: null })[0]).toContain(
      'no upload key at',
    );
    expect(
      uploadKeyProblems({ path: KEY, repoRoot: REPO, stat: { isFile: true, mode: 0o100644 } }),
    ).toStrictEqual([`${KEY} has mode 644, expected 600: chmod 600 it (never open it)`]);
  });
});

describe('keytoolGenerateArgs', () => {
  const args = keytoolGenerateArgs({ keyPath: KEY, organization: 'Acme' });
  const valueOf = (flag: string): string | undefined => args[args.indexOf(flag) + 1];

  it('passes the password through an environment variable only', () => {
    expect(valueOf('-storepass:env')).toBe(UPLOAD_PASSWORD_ENV);
    expect(args.join(' ')).not.toMatch(/-(?:store|key)pass (?!:env)/u);
  });

  it('uses one password for store and key, because PKCS12 keeps only one', () => {
    expect(valueOf('-storetype')).toBe('PKCS12');
    expect(valueOf('-keypass:env')).toBe(valueOf('-storepass:env'));
  });

  it('makes a long-lived RSA 4096 key under the upload alias', () => {
    expect(valueOf('-alias')).toBe('upload');
    expect(args.slice(args.indexOf('-keysize'), args.indexOf('-keysize') + 4)).toStrictEqual([
      '-keysize',
      '4096',
      '-validity',
      '10000',
    ]);
  });
});
