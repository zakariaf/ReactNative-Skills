// scripts/release-android/upload-key.ts
// The upload key of Play App Signing (local lane). Google holds the app-signing key; this key only
// proves an upload is ours. It lives outside the repo at ~/.android-keys/<applicationId>-upload.jks
// with mode 600, and its passwords live in ~/.gradle/gradle.properties under names of this app only,
// which Gradle reads by itself: no tool ever opens, prints, copies or logs the key or a password.
// Here only the paths, the property names and a file's stat are handled.
import { join, relative } from 'node:path';

export const UPLOAD_KEY_ALIAS = 'upload';

/** The four Gradle properties the release signing config reads. */
export type UploadSigningProperties = {
  readonly storeFile: string;
  readonly storePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
};

/** The parts of fs.statSync the checks need; null when the file does not exist. */
export type KeyStat = { readonly isFile: boolean; readonly mode: number };

/** A secret file judged from its stat, never by opening it. */
export type SecretFile = {
  readonly path: string;
  readonly repoRoot: string;
  readonly stat: KeyStat | null;
};

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** Throws unless the id is an Android package (com.acme.tasks). */
export function assertApplicationId(applicationId: string): string {
  if (!PACKAGE.test(applicationId)) {
    throw new Error(`"${applicationId}" is not an Android package (com.acme.tasks)`);
  }
  return applicationId;
}

/** com.acme.tasks -> COM_ACME_TASKS_UPLOAD_: no other project on the machine signs with them. */
export function uploadPropertyPrefix(applicationId: string): string {
  return `${assertApplicationId(applicationId).toUpperCase().replaceAll('.', '_')}_UPLOAD_`;
}

export function uploadSigningProperties(applicationId: string): UploadSigningProperties {
  const prefix = uploadPropertyPrefix(applicationId);
  return {
    storeFile: `${prefix}STORE_FILE`,
    storePassword: `${prefix}STORE_PASSWORD`,
    keyAlias: `${prefix}KEY_ALIAS`,
    keyPassword: `${prefix}KEY_PASSWORD`,
  };
}

export function uploadKeyPathOf(applicationId: string, home: string): string {
  return join(home, '.android-keys', `${assertApplicationId(applicationId)}-upload.jks`);
}

/** Outside the repo, a file, readable by its user only; judged from its stat alone. */
export function secretFileProblems(
  file: SecretFile,
  words: { readonly what: string; readonly missing: string },
): string[] {
  const inside = relative(file.repoRoot, file.path);
  if (!inside.startsWith('..') && !inside.startsWith('/')) {
    return [`the ${words.what} is inside the repo (${file.path}): move it to ~/.android-keys/`];
  }
  if (file.stat?.isFile !== true) {
    return [`no ${words.what} at ${file.path} (${words.missing})`];
  }
  const mode = file.stat.mode & 0o777;
  return mode === 0o600
    ? []
    : [`${file.path} has mode ${mode.toString(8)}, expected 600: chmod 600 it (never open it)`];
}

export function uploadKeyProblems(file: SecretFile): string[] {
  return secretFileProblems(file, {
    what: 'upload key',
    missing: 'generate it with keytool after the developer says go, or put their key there',
  });
}

/** The one environment variable keytool reads the password from, in that one process only. */
export const UPLOAD_PASSWORD_ENV = 'UPLOAD_STORE_PASSWORD';

/**
 * keytool arguments for a new upload key. The keystore is PKCS12 (JDK 17's default, named so a
 * JKS default never applies), and PKCS12 has one password: keytool ignores a different -keypass
 * ("Different store and key passwords not supported for PKCS12 KeyStores") and Gradle then fails
 * to sign with the key password. So both come from the one environment variable of that process
 * (-storepass:env), never the command line or the process list, and gradle.properties gets the same
 * value under both the store and the key password names.
 */
export function keytoolGenerateArgs(input: {
  readonly keyPath: string;
  readonly organization: string;
}): string[] {
  return [
    ...['-genkeypair', '-keystore', input.keyPath, '-storetype', 'PKCS12'],
    ...['-alias', UPLOAD_KEY_ALIAS, '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000'],
    ...['-dname', `CN=${input.organization} Upload, O=${input.organization}`],
    ...['-storepass:env', UPLOAD_PASSWORD_ENV, '-keypass:env', UPLOAD_PASSWORD_ENV],
  ];
}
