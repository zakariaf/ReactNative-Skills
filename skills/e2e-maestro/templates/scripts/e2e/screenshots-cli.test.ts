// scripts/e2e/screenshots-cli.test.ts
import { parseScreenshotsCli, SCREENSHOTS_USAGE } from './screenshots-cli.ts';

describe('parseScreenshotsCli', () => {
  it('returns help for -h', () => {
    expect(parseScreenshotsCli(['-h'])).toStrictEqual({ kind: 'help' });
    expect(SCREENSHOTS_USAGE).toContain('--update');
  });

  it('leaves devices and locales to the contract when not given', () => {
    expect(parseScreenshotsCli(['--platform', 'ios'])).toStrictEqual({
      kind: 'run',
      options: {
        platform: 'ios',
        isUpdate: false,
        devices: undefined,
        locales: undefined,
        textSize: 'default',
        sim: undefined,
        appPath: undefined,
        driverPort: undefined,
      },
    });
  });

  it("reads a narrowed update on this session's devices", () => {
    const parsed = parseScreenshotsCli([
      ...['--platform', 'android', '--update', '--devices', 'tablet', '--locales', 'ar'],
      ...['--text-size', 'largest', '--sim', 'my-shots', '--driver-port', '61000'],
    ]);
    expect(parsed).toMatchObject({
      kind: 'run',
      options: { platform: 'android', isUpdate: true, devices: ['tablet'], locales: ['ar'] },
    });
  });

  it.each([
    [['--update'], 'pass --platform ios or --platform android'],
    [['--platform', 'ios', '--devices', 'watch'], 'unknown device watch'],
    [['--platform', 'ios', '--text-size', 'huge'], 'default or largest'],
    [['--platform', 'ios', '--driver-port', 'x'], 'is not a port number'],
    [['--platform', 'ios', '--colour'], "Unknown option '--colour'"],
  ])('reports %j as a usage error', (argv, message) => {
    const parsed = parseScreenshotsCli(argv);
    expect(parsed.kind === 'error' ? parsed.message : '').toContain(message);
  });
});
