// scripts/e2e/maestro-run.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appEnv,
  DEBUG_SETUP_FLOW,
  debugSetupArgs,
  devicePorts,
  javaHome,
  javaMajorOf,
  MAESTRO_QUIET_ENV,
  maestroEnv,
  reportArgs,
} from './maestro-run.ts';

const APP = { id: 'com.example.tasks.preview', scheme: 'tasks-preview' };

describe('maestroEnv', () => {
  it('sets Java and turns off analytics, the analysis prompt and the update check', () => {
    const env = maestroEnv({ ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'false' }, '/jdk-17');
    expect(env).toMatchObject({ JAVA_HOME: '/jdk-17', ...MAESTRO_QUIET_ENV });
    expect(env['MAESTRO_DRIVER_STARTUP_TIMEOUT']).toBe('120000');
    expect(env['PATH']).toBe(process.env['PATH']);
    expect(Object.values(MAESTRO_QUIET_ENV)).toStrictEqual(['true', 'true', 'true']);
  });
});

describe('javaHome', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jdk-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the caller's JAVA_HOME", () => {
    expect(javaHome({ JAVA_HOME: '/opt/jdk-17' })).toBe('/opt/jdk-17');
    writeFileSync(join(dir, 'release'), 'IMPLEMENTOR="Eclipse Adoptium"\nJAVA_VERSION="17.0.12"\n');
    expect(javaMajorOf(dir)).toBe(17);
    expect(javaHome({ JAVA_HOME: dir })).toBe(dir);
  });

  it("looks further when the caller's JDK is another major", () => {
    writeFileSync(join(dir, 'release'), 'JAVA_VERSION="21.0.4"\n');
    expect(javaMajorOf(dir)).toBe(21);
    expect(javaHome({ JAVA_HOME: dir })).not.toBe(dir);
  });
});

describe('appEnv', () => {
  it('passes the app id and scheme with -e', () => {
    expect(appEnv(APP)).toStrictEqual([
      '-e',
      'APP_ID=com.example.tasks.preview',
      '-e',
      'APP_SCHEME=tasks-preview',
    ]);
  });
});

describe('reportArgs', () => {
  it('writes a JUnit report and the per-flow output into one folder', () => {
    expect(reportArgs('reports/e2e/ios')).toStrictEqual([
      ...['--format', 'JUNIT', '--output', 'reports/e2e/ios/junit.xml'],
      ...['--test-output-dir', 'reports/e2e/ios'],
    ]);
  });
});

describe('debugSetupArgs', () => {
  it('runs the setup sub-flow with the query and the screen to wait for', () => {
    const args = debugSetupArgs({
      app: APP,
      query: 'open=tasks',
      waitFor: 'tasks.list',
      outDir: 'out',
    });
    expect(args.slice(0, 2)).toStrictEqual(['test', DEBUG_SETUP_FLOW]);
    expect(args).toContain('QUERY=open=tasks');
    expect(args).toContain('WAIT_FOR=tasks.list');
    expect(args).not.toContain('--udid');
  });
});

describe('devicePorts', () => {
  it("keeps the session's port for every device", async () => {
    const portOf = devicePorts(61_234);
    await expect(portOf('emulator-5554')).resolves.toBe(61_234);
  });

  it('picks one free port per device and keeps it for the run', async () => {
    const portOf = devicePorts(undefined);
    const first = await portOf('emulator-5554');
    await expect(portOf('emulator-5554')).resolves.toBe(first);
    expect(first).toBeGreaterThanOrEqual(1024);
  });
});
