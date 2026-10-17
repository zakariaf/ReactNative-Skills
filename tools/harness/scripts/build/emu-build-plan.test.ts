// scripts/build/emu-build-plan.test.ts
import { join } from 'node:path';

import {
  buildScriptProblems,
  builtApkPath,
  deepLinkArgs,
  deviceShellQuote,
  gradleReleaseArgs,
  keptApkPath,
  linkScreenshotPath,
  mergedManifestPath,
  onlyScriptsRewritten,
  PREBUILD_ARGS,
  schemeOf,
  screenshotPath,
  scriptTargetsOf,
} from './emu-build-plan.ts';

const AUDIT = 'node scripts/audit/audit-android.ts';

describe('buildScriptProblems (the preflight before the clean prebuild)', () => {
  it('passes when every post-prebuild script and its file exist', () => {
    const exists = (path: string): boolean => path === 'scripts/audit/audit-android.ts';
    expect(
      buildScriptProblems({ 'audit:android': AUDIT }, ['audit:android'], exists),
    ).toStrictEqual([]);
  });

  it('names a missing file and a missing script', () => {
    expect(
      buildScriptProblems({ 'audit:android': AUDIT }, ['audit:android'], () => false),
    ).toStrictEqual(['"audit:android" runs scripts/audit/audit-android.ts, which does not exist']);
    expect(buildScriptProblems({}, ['audit:android'], () => true)).toStrictEqual([
      'package.json has no "audit:android" script, and the build runs it after every prebuild',
    ]);
  });

  it('reads only the file arguments of a command', () => {
    expect(scriptTargetsOf(`${AUDIT} --strict`)).toStrictEqual(['scripts/audit/audit-android.ts']);
    expect(scriptTargetsOf('npx expo prebuild --clean')).toStrictEqual([]);
  });
});

describe('the build commands', () => {
  it('prebuilds android from clean', () => {
    expect(PREBUILD_ARGS).toStrictEqual(['expo', 'prebuild', '--platform', 'android', '--clean']);
  });

  it('assembles Release for one ABI with no daemon left behind', () => {
    expect(gradleReleaseArgs('arm64-v8a')).toStrictEqual([
      '--no-daemon',
      '--console=plain',
      ':app:assembleRelease',
      '-PreactNativeArchitectures=arm64-v8a',
      '-Pkotlin.compiler.execution.strategy=out-of-process',
    ]);
    expect(gradleReleaseArgs('x86_64').join(' ')).not.toMatch(/Debug|signing/);
  });
});

describe('paths', () => {
  it('finds the APK and the merged manifest Gradle writes', () => {
    expect(builtApkPath('.')).toBe(
      join('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    );
    expect(mergedManifestPath('apps/mobile')).toContain(join('merged_manifests', 'release'));
  });

  it('keeps one APK per variant and one screenshot per purpose and variant', () => {
    expect(keptApkPath('.', 'production')).toBe(join('build', 'android-emu', 'app-production.apk'));
    const options = { purpose: 'smoke', variant: 'preview' } as const;
    expect(screenshotPath(options)).toBe(join('reports', 'android-emu', 'smoke-preview.png'));
    expect(linkScreenshotPath(options)).toBe(
      join('reports', 'android-emu', 'smoke-preview-link.png'),
    );
  });
});

describe('deep links', () => {
  it('reads the app scheme, never a web scheme', () => {
    const manifest = '<data android:scheme="https"/><data android:scheme="tasks-preview"/>';
    expect(schemeOf(manifest)).toBe('tasks-preview');
    expect(schemeOf('<data android:scheme="https"/>')).toBeNull();
  });

  it('addresses the VIEW intent to the serial and the package', () => {
    expect(
      deepLinkArgs('emulator-5556', 'tasks-preview://tasks/42', 'com.acme.tasks.preview'),
    ).toStrictEqual([
      '-s',
      'emulator-5556',
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      "'tasks-preview://tasks/42'",
      'com.acme.tasks.preview',
    ]);
  });

  it('quotes the URL for the device shell, so a second query parameter stays in the link', () => {
    const args = deepLinkArgs('emulator-5556', 'tasks-preview://tasks?id=1&tab=notes', 'p');
    expect(args).toContain("'tasks-preview://tasks?id=1&tab=notes'");
    expect(deviceShellQuote("it's")).toBe(String.raw`'it'\''s'`);
  });
});

describe('onlyScriptsRewritten', () => {
  const before = JSON.stringify({
    name: 'tasks',
    scripts: { android: 'expo start --android', test: 'jest' },
  });

  it('is true when the prebuild only rewrote the ios and android scripts', () => {
    const after = JSON.stringify({
      name: 'tasks',
      scripts: { android: 'expo run:android', test: 'jest' },
    });
    expect(onlyScriptsRewritten(before, after)).toBe(true);
  });

  it('is false for no change and for any other change', () => {
    const other = JSON.stringify({
      name: 'tasks',
      main: 'index.ts',
      scripts: { android: 'expo run:android', test: 'jest' },
    });
    expect([
      onlyScriptsRewritten(before, before),
      onlyScriptsRewritten(before, other),
    ]).toStrictEqual([false, false]);
  });
});
