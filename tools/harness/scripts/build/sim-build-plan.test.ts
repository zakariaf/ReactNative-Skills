// scripts/build/sim-build-plan.test.ts
import {
  buildScriptProblems,
  builtAppPath,
  linkProblems,
  linkScreenshotPath,
  linkSetupArgs,
  maestroEnvOf,
  onlyScriptsRewritten,
  PREBUILD_ARGS,
  schemeOf,
  screenshotPath,
  scriptTargetsOf,
  xcodebuildSimArgs,
} from './sim-build-plan.ts';

const UDID = '0C9E3F8A-51D2-4B7E-9A61-2F4D8C7B1E03';
const AUDIT = 'node scripts/audit/audit-privacy.ts';

describe('buildScriptProblems (the preflight before the clean prebuild)', () => {
  it('passes when every post-prebuild script and its file exist', () => {
    const exists = (path: string): boolean => path === 'scripts/audit/audit-privacy.ts';
    expect(
      buildScriptProblems({ 'audit:privacy': AUDIT }, ['audit:privacy'], exists),
    ).toStrictEqual([]);
  });

  it('names a missing file and a missing script', () => {
    expect(
      buildScriptProblems({ 'audit:privacy': AUDIT }, ['audit:privacy'], () => false),
    ).toStrictEqual(['"audit:privacy" runs scripts/audit/audit-privacy.ts, which does not exist']);
    expect(buildScriptProblems({}, ['audit:privacy'], () => true)).toStrictEqual([
      'package.json has no "audit:privacy" script, and the build runs it after every prebuild',
    ]);
  });

  it('reads only the file arguments of a command', () => {
    expect(scriptTargetsOf(`${AUDIT} --strict`)).toStrictEqual(['scripts/audit/audit-privacy.ts']);
    expect(scriptTargetsOf('npx expo prebuild --clean')).toStrictEqual([]);
  });
});

describe('xcodebuild', () => {
  it('starts every build from a clean prebuild', () => {
    expect(PREBUILD_ARGS).toStrictEqual(['expo', 'prebuild', '--platform', 'ios', '--clean']);
  });

  it('derives the scheme from the workspace name', () => {
    expect(schemeOf('ios/Tasks.xcworkspace')).toBe('Tasks');
    expect(() => schemeOf('ios/Tasks.xcodeproj')).toThrow('is not an .xcworkspace');
  });

  it('builds Release for the named simulator without signing, arm64 only', () => {
    const args = xcodebuildSimArgs({
      workspace: 'ios/Tasks.xcworkspace',
      scheme: 'Tasks',
      udid: UDID,
    });
    expect(args).toStrictEqual(
      expect.arrayContaining([
        'Release',
        'iphonesimulator',
        `id=${UDID}`,
        'CODE_SIGNING_ALLOWED=NO',
      ]),
    );
    expect(args.at(-1)).toBe('build');
  });

  it('finds the built app and names the screenshots after purpose and variant', () => {
    expect(builtAppPath('.', 'Tasks')).toBe(
      'build/ios-sim/dd/Build/Products/Release-iphonesimulator/Tasks.app',
    );
    const options = { purpose: 'smoke', variant: 'preview' as const };
    expect([screenshotPath(options), linkScreenshotPath(options)]).toStrictEqual([
      'reports/ios-sim/smoke-preview.png',
      'reports/ios-sim/smoke-preview-link.png',
    ]);
  });
});

describe('--link', () => {
  const link = { path: 'tasks/42', waitFor: 'task-detail.screen' };
  const flow = '.maestro/subflows/open-link.yaml';

  it('needs the sub-flow only when a link is asked for', () => {
    expect(linkProblems({ link }, { linkFlow: flow }, () => false)).toStrictEqual([
      '--link runs .maestro/subflows/open-link.yaml, which does not exist (e2e-maestro creates it)',
    ]);
    expect(linkProblems({ link: null }, { linkFlow: flow }, () => false)).toStrictEqual([]);
  });

  it('names the device and its own driver port before the command, never --udid', () => {
    const run = {
      udid: UDID,
      driverPort: 53_117,
      bundleId: 'com.acme.tasks.preview',
      scheme: 'tasks-preview',
    };
    const args = linkSetupArgs({ ...run, link, flow, outDir: 'out' });
    expect(args).toStrictEqual([
      ...['--device', UDID, '--driver-host-port', '53117'],
      ...['test', flow, '--test-output-dir', 'out'],
      ...['-e', 'APP_ID=com.acme.tasks.preview', '-e', 'LINK=tasks-preview://tasks/42'],
      ...['-e', 'WAIT_FOR=task-detail.screen'],
    ]);
    expect(args).not.toContain('--udid');
  });

  it('turns off analytics, the analysis prompt and the update check, with Java 17', () => {
    expect(maestroEnvOf({ NODE_ENV: 'test', PATH: '/bin' }, () => '/jdk17')).toMatchObject({
      JAVA_HOME: '/jdk17',
      MAESTRO_CLI_NO_ANALYTICS: 'true',
      MAESTRO_DISABLE_UPDATE_CHECK: 'true',
    });
    expect(
      maestroEnvOf({ NODE_ENV: 'test', JAVA_HOME: '/mine' }, () => '/jdk17')['JAVA_HOME'],
    ).toBe('/mine');
  });
});

describe('onlyScriptsRewritten', () => {
  const before = JSON.stringify({
    name: 'tasks',
    scripts: { ios: 'expo start --ios', test: 'jest' },
  });

  it('accepts the ios and android rewrite expo prebuild makes', () => {
    const after = JSON.stringify({ name: 'tasks', scripts: { ios: 'expo run:ios', test: 'jest' } });
    expect(onlyScriptsRewritten(before, after)).toBe(true);
  });

  it('keeps any other change, and an unchanged file, for the developer', () => {
    const deps = JSON.stringify({
      name: 'tasks',
      scripts: { ios: 'expo run:ios', test: 'jest' },
      dependencies: { a: '1' },
    });
    expect([
      onlyScriptsRewritten(before, deps),
      onlyScriptsRewritten(before, before),
    ]).toStrictEqual([false, false]);
  });
});
