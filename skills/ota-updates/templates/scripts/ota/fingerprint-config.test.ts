// scripts/ota/fingerprint-config.test.ts
// @expo/fingerprint loads fingerprint.config.js with require() and silently falls back to its
// defaults when the file throws, so this test is the only alarm for a broken config.
import type { Config } from 'expo/fingerprint';

const config = jest.requireActual<Config>('../../fingerprint.config.js');

const PATCH = 'patch-package';
const SCRIPTS_SOURCE = { type: 'contents', id: 'packageJson:scripts' } as const;

const SCRIPTS = {
  start: 'expo start',
  lint: 'eslint . --max-warnings 0',
  postinstall: PATCH,
  preinstall: 'node scripts/check-node.ts',
  prepare: 'node scripts/hooks/install-git-hooks.ts',
  preprepare: 'node scripts/check-toolchain.ts',
  postprepare: PATCH,
  'eas-build-pre-install': 'npm install -g npm@11.17.0',
};

function transform(source: Parameters<NonNullable<Config['fileHookTransform']>>[0], chunk: string) {
  const hook = config.fileHookTransform;
  if (hook === undefined) throw new Error('fingerprint.config.js lost its fileHookTransform');
  return hook(source, chunk, true, 'utf8');
}

describe('fingerprint.config.js', () => {
  it('skips the app version fields and keeps every other source of the Expo config', () => {
    expect(config.sourceSkips).toStrictEqual([
      'ExpoConfigVersions',
      'ExpoConfigRuntimeVersionIfString',
      'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    ]);
  });

  it('keeps only the scripts npm or EAS run while installing or building', () => {
    const hashed = transform(SCRIPTS_SOURCE, JSON.stringify(SCRIPTS));
    expect(JSON.parse(String(hashed))).toStrictEqual({
      postinstall: PATCH,
      preinstall: 'node scripts/check-node.ts',
      prepare: 'node scripts/hooks/install-git-hooks.ts',
      preprepare: 'node scripts/check-toolchain.ts',
      postprepare: PATCH,
      'eas-build-pre-install': 'npm install -g npm@11.17.0',
    });
  });

  it('reads the scripts from a Buffer too', () => {
    const hook = config.fileHookTransform;
    const chunk = Buffer.from(JSON.stringify({ lint: 'eslint .', postinstall: PATCH }));
    const hashed = hook?.(SCRIPTS_SOURCE, chunk, true, 'utf8');
    expect(JSON.parse(String(hashed))).toStrictEqual({ postinstall: PATCH });
  });

  it('passes every other source through unchanged', () => {
    const contents = transform({ type: 'contents', id: 'expoConfig' }, '{"name":"Tasks"}');
    expect(contents).toBe('{"name":"Tasks"}');
    const file = transform({ type: 'file', filePath: 'app.config.ts' }, 'export default {}');
    expect(file).toBe('export default {}');
    expect(
      config.fileHookTransform?.({ type: 'file', filePath: 'a' }, null, true, 'utf8'),
    ).toBeNull();
  });
});
