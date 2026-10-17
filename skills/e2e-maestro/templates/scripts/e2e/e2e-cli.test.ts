// scripts/e2e/e2e-cli.test.ts
import { driverPortOf, E2E_USAGE, parseE2eCli } from './e2e-cli.ts';

describe('parseE2eCli', () => {
  describe('when asked for help', () => {
    it('returns help, whatever else is on the line', () => {
      expect(parseE2eCli(['--platform', 'nope', '-h'])).toStrictEqual({ kind: 'help' });
      expect(E2E_USAGE).toContain('--platform');
    });
  });

  describe('when the line is complete', () => {
    it('reads the full evidence run with every default', () => {
      expect(parseE2eCli(['--platform', 'ios'])).toStrictEqual({
        kind: 'run',
        options: {
          platform: 'ios',
          sim: undefined,
          driverPort: undefined,
          appPath: undefined,
          includeTags: null,
          isSkippingLargeText: false,
        },
      });
    });

    it("reads this session's devices, port, build and filters", () => {
      const parsed = parseE2eCli([
        ...['--platform', 'android', '--sim', 'my-e2e', '--driver-port', '61234'],
        ...['--app-path', 'app.apk', '--include-tags', 'smoke', '--skip-large-text'],
      ]);
      expect(parsed).toStrictEqual({
        kind: 'run',
        options: {
          platform: 'android',
          sim: 'my-e2e',
          driverPort: 61_234,
          appPath: 'app.apk',
          includeTags: 'smoke',
          isSkippingLargeText: true,
        },
      });
    });
  });

  describe('when the line is wrong', () => {
    it.each([
      [['--platform', 'web'], 'pass --platform ios or --platform android'],
      [[], 'pass --platform ios or --platform android'],
      [['--platform', 'ios', '--flows'], 'unknown option --flows'],
      [['--platform', 'ios', 'extra'], 'unexpected argument extra'],
      [['--platform', 'ios', '--sim'], '--sim needs a value'],
      [['--platform', 'ios', '--sim', 'My Sim'], 'kebab-case purpose'],
      [['--platform', 'ios', '--driver-port', '7'], 'is not a port number'],
    ])('reports %j as a usage error', (argv, message) => {
      const parsed = parseE2eCli(argv);
      expect(parsed.kind).toBe('error');
      expect(parsed.kind === 'error' ? parsed.message : '').toContain(message);
    });
  });
});

describe('driverPortOf', () => {
  it('accepts a port from 1024 to 65535 and nothing else', () => {
    expect(driverPortOf('1024')).toBe(1024);
    expect(driverPortOf(undefined)).toBeUndefined();
    expect(driverPortOf('70000')).toContain('is not a port number');
  });
});
