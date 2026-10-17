// scripts/android/toolchain.test.ts
import { join } from 'node:path';

import {
  ANDROID_API,
  androidHomeOf,
  BUILD_TOOLS_VERSION,
  hostAbi,
  JDK_MAJOR,
  jdkMajorOf,
  missingSdkPackages,
  pickJavaHome,
  sdkTool,
  systemImageFor,
  toolEnv,
} from './toolchain.ts';

const JDK17 = 'JAVA_VERSION="17.0.11"\nMODULES="java.base"\n';
const JDK21 = 'JAVA_VERSION="21.0.4"\n';

describe('the pins', () => {
  it('matches the React Native 0.86 version catalog', () => {
    expect([JDK_MAJOR, ANDROID_API, BUILD_TOOLS_VERSION]).toStrictEqual([17, 36, '36.0.0']);
  });

  it('names the system image of the host ABI', () => {
    expect(systemImageFor(hostAbi('arm64'))).toBe('system-images;android-36;google_apis;arm64-v8a');
    expect(systemImageFor(hostAbi('x64'))).toBe('system-images;android-36;google_apis;x86_64');
  });
});

describe('jdkMajorOf', () => {
  it('reads the modern and the 1.x version schemes', () => {
    expect([jdkMajorOf(JDK17), jdkMajorOf('JAVA_VERSION="1.8.0_402"')]).toStrictEqual([17, 8]);
  });

  it('is null without a JAVA_VERSION line', () => {
    expect(jdkMajorOf('IMPLEMENTOR="x"')).toBeNull();
  });
});

describe('pickJavaHome', () => {
  it('takes the first JDK of the pinned major, never just the first JDK', () => {
    const candidates = [
      { path: '/jdk21', release: JDK21 },
      { path: '/missing', release: null },
      { path: '/jdk17', release: JDK17 },
    ];
    expect(pickJavaHome(candidates, 17)).toBe('/jdk17');
  });

  it('names what it found and the human step when no JDK matches', () => {
    expect(() => pickJavaHome([{ path: '/jdk21', release: JDK21 }], 17)).toThrow(
      'JDK 17 not found (looked at: /jdk21 (21)). Human step',
    );
  });
});

describe('androidHomeOf', () => {
  it('prefers ANDROID_HOME, then ANDROID_SDK_ROOT', () => {
    expect(
      androidHomeOf(
        { NODE_ENV: 'test', ANDROID_HOME: '/sdk', ANDROID_SDK_ROOT: '/old' },
        'linux',
        '/h',
      ),
    ).toBe('/sdk');
    expect(androidHomeOf({ NODE_ENV: 'test', ANDROID_SDK_ROOT: '/old' }, 'linux', '/h')).toBe(
      '/old',
    );
  });

  it('falls back to the SDK manager default of the platform', () => {
    expect(androidHomeOf({ NODE_ENV: 'test' }, 'darwin', '/h')).toBe(
      join('/h', 'Library', 'Android', 'sdk'),
    );
    expect(androidHomeOf({ NODE_ENV: 'test' }, 'linux', '/h')).toBe(join('/h', 'Android', 'Sdk'));
  });
});

describe('missingSdkPackages', () => {
  it('lists every required folder that is absent', () => {
    const image = systemImageFor('arm64-v8a');
    const present = new Set(['platform-tools', 'emulator', join('build-tools', '36.0.0')]);
    expect(missingSdkPackages(image, (relative) => present.has(relative))).toStrictEqual([
      join('cmdline-tools', 'latest'),
      join('platforms', 'android-36'),
      join('system-images', 'android-36', 'google_apis', 'arm64-v8a'),
    ]);
  });
});

describe('toolEnv and sdkTool', () => {
  it('sets the JDK, the SDK, no telemetry and no prompts on top of the base env', () => {
    const env = toolEnv(
      { NODE_ENV: 'test', PATH: '/bin', CI: '0' },
      { javaHome: '/jdk17', androidHome: '/sdk' },
    );
    expect(env).toStrictEqual({
      NODE_ENV: 'test',
      PATH: '/bin',
      CI: '1',
      JAVA_HOME: '/jdk17',
      ANDROID_HOME: '/sdk',
      EXPO_NO_TELEMETRY: '1',
    });
  });

  it('resolves the SDK tools inside ANDROID_HOME', () => {
    expect(sdkTool('/sdk', 'adb')).toBe(join('/sdk', 'platform-tools', 'adb'));
    expect(sdkTool('/sdk', 'avdmanager')).toBe(
      join('/sdk', 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
    );
  });
});
