// scripts/build/sim-build-args.test.ts
import { isHelpRequest, parseSimBuildArgs, SIM_BUILD_USAGE } from './sim-build-args.ts';

describe('parseSimBuildArgs', () => {
  it('defaults to a preview build on the smoke simulator of the single app', () => {
    expect(parseSimBuildArgs([])).toStrictEqual({
      variant: 'preview',
      purpose: 'smoke',
      appDir: '.',
      link: null,
      driverPort: null,
    });
  });

  it('takes the variant, the simulator purpose and the app folder', () => {
    const options = parseSimBuildArgs([
      '--variant',
      'production',
      '--sim',
      'e2e',
      '--app-dir',
      'apps/mobile',
    ]);
    expect(options).toMatchObject({ variant: 'production', purpose: 'e2e', appDir: 'apps/mobile' });
  });

  it('rejects a variant the app resolver does not know', () => {
    expect(() => parseSimBuildArgs(['--variant', 'staging'])).toThrow('APP_VARIANT=staging');
  });

  it('rejects an unknown flag and a purpose that is not kebab-case', () => {
    expect(() => parseSimBuildArgs(['--fast', 'yes'])).toThrow('unexpected argument "--fast"');
    expect(() => parseSimBuildArgs(['--sim', 'My Phone'])).toThrow('kebab-case purpose');
  });

  it('takes a deep link path with the testID that proves its screen', () => {
    const options = parseSimBuildArgs(['--link', 'tasks/42', '--wait-for', 'task-detail.screen']);
    expect(options.link).toStrictEqual({ path: 'tasks/42', waitFor: 'task-detail.screen' });
    expect(() => parseSimBuildArgs(['--link', 'tasks/42'])).toThrow('needs --wait-for');
    expect(() => parseSimBuildArgs(['--link', 'tasks://42', '--wait-for', 'x'])).toThrow(
      'pass the path after <scheme>://',
    );
  });

  it("takes the session's own --driver-port, else none (a free one per run)", () => {
    expect(parseSimBuildArgs(['--driver-port', '61234']).driverPort).toBe(61_234);
    expect(() => parseSimBuildArgs(['--driver-port', '80'])).toThrow(
      '--driver-port 80: pass a port from 1024 to 65535',
    );
  });
});

describe('isHelpRequest', () => {
  it('answers --help and -h with the usage instead of an argument error', () => {
    expect([isHelpRequest(['--help']), isHelpRequest(['-h'])]).toStrictEqual([true, true]);
    expect(isHelpRequest(['--variant', 'preview'])).toBe(false);
    expect(SIM_BUILD_USAGE).toContain('--link <path> --wait-for <testID>');
  });
});
